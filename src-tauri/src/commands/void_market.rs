//! Void Trader: data for the Market Observatory (the game's second room).
//!
//! Three commands:
//! - `vt_order_book`: the live warframe.market order book of one item (every sell and buy order
//!   from users seen in the last 7 days), with a summary. Books are cached per item for
//!   `BOOK_TTL`, requests to warframe.market are serialized and spaced by at least `REQUEST_GAP`,
//!   and a forced refresh never fetches a book younger than `FORCE_MIN_AGE`.
//! - `vt_price_history`: price history of one item for the chart ribbon. Tries warframe.market's
//!   closed-trade statistics (90 days, v1 endpoint, cached `STATS_TTL`, a failure is remembered for
//!   `STATS_FAIL_TTL` so a missing endpoint is not hammered), then the daily snapshots Void Trader
//!   records itself from the price cache, and always returns the current cached price row.
//!   Rivens use the local riven market scans.
//! - `vt_market_overview`: every item with cached price data (and every scanned riven family),
//!   with category, prices, volume, a trend signal and the user's own flags, for the star map.
//!
//! Trend: `week_price_shift` is not used (real data shows it is never negative). The trend is the
//! relative gap between the cached average price and its moving average,
//! `(avg_price - moving_avg) / moving_avg`; rivens compare their two latest scans a day or more apart.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use chrono::Utc;
use entity::{
    stock_item::StockItemPaginationQueryDto, stock_riven::StockRivenPaginationQueryDto,
    wish_list::WishListPaginationQueryDto,
};
use serde::{Deserialize, Serialize};
use service::{StockItemQuery, StockRivenQuery, WishListQuery};
use utils::{get_location, warning, Error, LoggerOptions};
use wf_market::{
    enums::{ApiVersion, OrderType, StatusType},
    types::OrderWithUser,
};

use crate::{
    commands::{void_riven_market, void_sell_finder},
    helper,
    utils::{modules::states, ErrorFromExt},
    wf_inventory::WFInventoryState,
    DATABASE,
};

const COMPONENT: &str = "VoidTrader:Market";
/// How long one item's order book is served from memory.
pub const BOOK_TTL: Duration = Duration::from_secs(40);
/// A forced refresh still serves a book younger than this.
pub const FORCE_MIN_AGE: Duration = Duration::from_secs(10);
/// Minimum pause between two warframe.market requests made by this module.
pub const REQUEST_GAP: Duration = Duration::from_millis(1200);
const STATS_TTL: Duration = Duration::from_secs(15 * 60);
const STATS_FAIL_TTL: Duration = Duration::from_secs(10 * 60);
const BOOK_CACHE_MAX: usize = 48;
const HISTORY_FILE: &str = "void_trader_market_history.json";
const HISTORY_KEEP_DAYS: i64 = 90;
/// Relative gap (avg vs moving average) under which an item counts as flat.
pub const TREND_FLAT: f64 = 0.05;

/* ------------------------------------------------------------------------- */
/* A small TTL cache (pure: the caller passes the clock)                      */
/* ------------------------------------------------------------------------- */

#[derive(Debug)]
pub struct TtlCache<V> {
    ttl: Duration,
    max: usize,
    map: HashMap<String, (Instant, V)>,
}

impl<V: Clone> TtlCache<V> {
    pub fn new(ttl: Duration, max: usize) -> Self {
        Self { ttl, max, map: HashMap::new() }
    }

    /// The value and its age, when younger than the TTL.
    pub fn get(&self, key: &str, now: Instant) -> Option<(V, Duration)> {
        let (at, v) = self.map.get(key)?;
        let age = now.saturating_duration_since(*at);
        (age < self.ttl).then(|| (v.clone(), age))
    }

    /// Like `get`, but ignores the TTL (used for "younger than x" checks).
    pub fn get_any(&self, key: &str, now: Instant) -> Option<(V, Duration)> {
        self.map.get(key).map(|(at, v)| (v.clone(), now.saturating_duration_since(*at)))
    }

    pub fn insert(&mut self, key: impl Into<String>, value: V, now: Instant) {
        self.map.insert(key.into(), (now, value));
        if self.map.len() > self.max {
            // drop everything expired first, then the oldest entries
            let ttl = self.ttl;
            self.map.retain(|_, (at, _)| now.saturating_duration_since(*at) < ttl);
            while self.map.len() > self.max {
                let oldest = self.map.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone());
                match oldest {
                    Some(k) => {
                        self.map.remove(&k);
                    }
                    None => break,
                }
            }
        }
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.map.len()
    }
}

/* ------------------------------------------------------------------------- */
/* Order book                                                                 */
/* ------------------------------------------------------------------------- */

/// One order, reduced to what the observatory shows (and what the pure logic needs).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BookOrder {
    pub id: String,
    /// "sell" or "buy".
    pub side: String,
    pub platinum: i64,
    pub quantity: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtype: Option<String>,
    /// Variant key ("" when the item has none): "r10", "intact", "a1c2".
    pub variant: String,
    pub user: String,
    /// "ingame", "online" or "offline".
    pub status: String,
    pub reputation: f64,
    pub own: bool,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct BookVariant {
    pub key: String,
    pub label: String,
    pub sells: usize,
    pub buys: usize,
    pub sells_ingame: usize,
}

#[derive(Clone, Debug, Serialize, Default, PartialEq)]
pub struct BookSummary {
    /// Lowest sell price among sellers who are in game right now.
    pub best_sell_ingame: Option<i64>,
    /// Lowest sell price among online or in-game sellers.
    pub best_sell_online: Option<i64>,
    pub best_sell_any: Option<i64>,
    /// Highest buy price among buyers who are in game right now.
    pub best_buy_ingame: Option<i64>,
    pub best_buy_any: Option<i64>,
    /// best_sell_ingame - best_buy_ingame.
    pub spread: Option<i64>,
    pub sellers_ingame: usize,
    pub buyers_ingame: usize,
    pub sell_count: usize,
    pub buy_count: usize,
    pub own_sell: Option<i64>,
    pub own_buy: Option<i64>,
    /// How many platinum the cheapest in-game seller (not you) is under your sell order.
    pub undercut_by: Option<i64>,
    /// Your sell order is the cheapest among in-game sellers (ties count).
    pub own_is_best: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct OrderBook {
    pub wfm_url: String,
    pub name: String,
    /// The variant the orders and the summary are for ("" = no variants).
    pub variant: String,
    pub variants: Vec<BookVariant>,
    /// Sell orders, cheapest first.
    pub sells: Vec<BookOrder>,
    /// Buy orders, highest first.
    pub buys: Vec<BookOrder>,
    pub summary: BookSummary,
    pub fetched_at: String,
    pub age_secs: u64,
    pub from_cache: bool,
    pub ttl_secs: u64,
}

pub fn status_key(s: &StatusType) -> &'static str {
    match s {
        StatusType::InGame => "ingame",
        StatusType::Online => "online",
        StatusType::Offline => "offline",
    }
}

pub fn variant_key(rank: Option<i64>, subtype: Option<&str>, amber: Option<i64>, cyan: Option<i64>) -> String {
    if let Some(s) = subtype.filter(|s| !s.is_empty()) {
        return s.to_string();
    }
    if amber.is_some() || cyan.is_some() {
        return format!("a{}c{}", amber.unwrap_or(0), cyan.unwrap_or(0));
    }
    rank.map(|r| format!("r{r}")).unwrap_or_default()
}

pub fn variant_label(key: &str) -> String {
    if key.is_empty() {
        return "Any".into();
    }
    if let Some(r) = key.strip_prefix('r').and_then(|r| r.parse::<i64>().ok()) {
        return format!("Rank {r}");
    }
    if key.starts_with('a') && key.contains('c') {
        let parts: Vec<&str> = key[1..].split('c').collect();
        if parts.len() == 2 {
            return format!("{} amber, {} cyan", parts[0], parts[1]);
        }
    }
    let mut c = key.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

pub fn to_book_order(o: &OrderWithUser, my_id: &str, my_name: &str) -> BookOrder {
    let st = &o.order.subtype;
    let own = (!my_id.is_empty() && o.user.id == my_id)
        || (!my_name.is_empty() && o.user.name.eq_ignore_ascii_case(my_name));
    BookOrder {
        id: o.order.id.clone(),
        side: if o.order.order_type == OrderType::Sell { "sell".into() } else { "buy".into() },
        platinum: o.order.platinum as i64,
        quantity: o.order.quantity as i64,
        rank: st.rank,
        subtype: st.subtype.clone(),
        variant: variant_key(st.rank, st.subtype.as_deref(), st.amber_stars, st.cyan_stars),
        user: o.user.name.clone(),
        status: status_key(&o.user.status).into(),
        reputation: o.user.reputation,
        own,
        updated_at: o.order.updated_at.clone(),
    }
}

/// Distinct variants, sorted by key (ranks numerically).
pub fn list_variants(orders: &[BookOrder]) -> Vec<BookVariant> {
    let mut map: BTreeMap<(i64, String), BookVariant> = BTreeMap::new();
    for o in orders {
        let sort = o.variant.strip_prefix('r').and_then(|r| r.parse::<i64>().ok()).unwrap_or(i64::MAX);
        let v = map.entry((sort, o.variant.clone())).or_insert_with(|| BookVariant {
            key: o.variant.clone(),
            label: variant_label(&o.variant),
            sells: 0,
            buys: 0,
            sells_ingame: 0,
        });
        if o.side == "sell" {
            v.sells += 1;
            if o.status == "ingame" {
                v.sells_ingame += 1;
            }
        } else {
            v.buys += 1;
        }
    }
    map.into_values().collect()
}

/// The requested variant when it exists, else the one with your own order, else the busiest.
pub fn pick_variant(variants: &[BookVariant], requested: Option<&str>, own_variant: Option<&str>) -> String {
    if let Some(r) = requested {
        if variants.iter().any(|v| v.key == r) {
            return r.to_string();
        }
    }
    if let Some(r) = own_variant {
        if variants.iter().any(|v| v.key == r) {
            return r.to_string();
        }
    }
    variants
        .iter()
        .max_by(|a, b| {
            a.sells_ingame
                .cmp(&b.sells_ingame)
                .then((a.sells + a.buys).cmp(&(b.sells + b.buys)))
                // prefer the lower key on a tie (max_by keeps the last max)
                .then(b.key.cmp(&a.key))
        })
        .map(|v| v.key.clone())
        .unwrap_or_default()
}

/// Summary of one variant's book. `sells` cheapest first, `buys` highest first is not required.
pub fn summarize(sells: &[BookOrder], buys: &[BookOrder]) -> BookSummary {
    let min = |it: &mut dyn Iterator<Item = i64>| it.min();
    let max = |it: &mut dyn Iterator<Item = i64>| it.max();
    let others_ingame = || sells.iter().filter(|o| !o.own && o.status == "ingame");
    let best_sell_ingame = min(&mut sells.iter().filter(|o| o.status == "ingame").map(|o| o.platinum));
    let best_buy_ingame = max(&mut buys.iter().filter(|o| o.status == "ingame").map(|o| o.platinum));
    let own_sell = min(&mut sells.iter().filter(|o| o.own).map(|o| o.platinum));
    let own_buy = max(&mut buys.iter().filter(|o| o.own).map(|o| o.platinum));
    let cheapest_other = min(&mut others_ingame().map(|o| o.platinum));
    let undercut_by = match (own_sell, cheapest_other) {
        (Some(mine), Some(other)) if other < mine => Some(mine - other),
        _ => None,
    };
    BookSummary {
        best_sell_ingame,
        best_sell_online: min(&mut sells.iter().filter(|o| o.status != "offline").map(|o| o.platinum)),
        best_sell_any: min(&mut sells.iter().map(|o| o.platinum)),
        best_buy_ingame,
        best_buy_any: max(&mut buys.iter().map(|o| o.platinum)),
        spread: match (best_sell_ingame, best_buy_ingame) {
            (Some(s), Some(b)) => Some(s - b),
            _ => None,
        },
        sellers_ingame: sells.iter().filter(|o| o.status == "ingame").count(),
        buyers_ingame: buys.iter().filter(|o| o.status == "ingame").count(),
        sell_count: sells.len(),
        buy_count: buys.len(),
        own_sell,
        own_buy,
        undercut_by,
        own_is_best: own_sell.is_some() && undercut_by.is_none(),
    }
}

/// Build the book for one variant from all orders of the item.
pub fn build_book(all: &[BookOrder], requested: Option<&str>) -> (String, Vec<BookVariant>, Vec<BookOrder>, Vec<BookOrder>, BookSummary) {
    let variants = list_variants(all);
    let own_variant = all.iter().find(|o| o.own && o.side == "sell").map(|o| o.variant.as_str());
    let variant = pick_variant(&variants, requested, own_variant);
    let mut sells: Vec<BookOrder> = all.iter().filter(|o| o.side == "sell" && o.variant == variant).cloned().collect();
    let mut buys: Vec<BookOrder> = all.iter().filter(|o| o.side == "buy" && o.variant == variant).cloned().collect();
    let rank = |s: &str| match s {
        "ingame" => 0,
        "online" => 1,
        _ => 2,
    };
    sells.sort_by(|a, b| a.platinum.cmp(&b.platinum).then(rank(&a.status).cmp(&rank(&b.status))));
    buys.sort_by(|a, b| b.platinum.cmp(&a.platinum).then(rank(&a.status).cmp(&rank(&b.status))));
    let summary = summarize(&sells, &buys);
    (variant, variants, sells, buys, summary)
}

struct CachedBook {
    orders: Arc<Vec<BookOrder>>,
    fetched_at: String,
}

impl Clone for CachedBook {
    fn clone(&self) -> Self {
        Self { orders: self.orders.clone(), fetched_at: self.fetched_at.clone() }
    }
}

static BOOKS: Mutex<Option<TtlCache<CachedBook>>> = Mutex::new(None);
/// Serializes every warframe.market request of this module; holds the time of the last one.
static FETCH_GATE: tokio::sync::Mutex<Option<Instant>> = tokio::sync::Mutex::const_new(None);

fn book_cache_get(url: &str, min_fresh: Option<Duration>) -> Option<(CachedBook, Duration)> {
    let guard = BOOKS.lock().ok()?;
    let cache = guard.as_ref()?;
    let now = Instant::now();
    match min_fresh {
        None => cache.get(url, now),
        Some(age) => cache.get_any(url, now).filter(|(_, a)| *a < age),
    }
}

fn book_cache_put(url: &str, book: CachedBook) {
    if let Ok(mut guard) = BOOKS.lock() {
        guard.get_or_insert_with(|| TtlCache::new(BOOK_TTL, BOOK_CACHE_MAX)).insert(url, book, Instant::now());
    }
}

/// Wait for our turn and keep the gap between requests.
async fn gate() -> tokio::sync::MutexGuard<'static, Option<Instant>> {
    let guard = FETCH_GATE.lock().await;
    if let Some(last) = *guard {
        let since = last.elapsed();
        if since < REQUEST_GAP {
            tokio::time::sleep(REQUEST_GAP - since).await;
        }
    }
    guard
}

fn item_name(url: &str) -> String {
    states::cache_client()
        .ok()
        .and_then(|c| c.tradable_item().get_by(url).ok())
        .map(|t| t.name)
        .unwrap_or_else(|| url.replace('_', " "))
}

#[tauri::command]
pub async fn vt_order_book(wfm_url: String, variant: Option<String>, force: Option<bool>) -> Result<OrderBook, Error> {
    let url = wfm_url.trim().to_string();
    if url.is_empty() {
        return Err(Error::new(COMPONENT, "No item given", get_location!()));
    }
    let force = force.unwrap_or(false);
    let lookup = |url: &str| if force { book_cache_get(url, Some(FORCE_MIN_AGE)) } else { book_cache_get(url, None) };
    let mut hit = lookup(&url);
    let mut from_cache = hit.is_some();

    if hit.is_none() {
        let mut last = gate().await;
        // another call may have fetched it while we waited
        hit = lookup(&url);
        from_cache = hit.is_some();
        if hit.is_none() {
            let app = states::app_state()?;
            let (my_id, my_name) = (app.user.wfm_id.clone(), app.user.wfm_username.clone());
            let result = app.wfm_client.order().get_orders_by_item(&url).await;
            *last = Some(Instant::now());
            drop(last);
            let list = result.map_err(|e| {
                Error::from_wfm(COMPONENT, &format!("Failed to read the order book of {url}"), e, get_location!())
            })?;
            let orders: Vec<BookOrder> = list
                .sell_orders
                .iter()
                .chain(list.buy_orders.iter())
                .filter(|o| o.order.visible)
                .map(|o| to_book_order(o, &my_id, &my_name))
                .collect();
            let book = CachedBook { orders: Arc::new(orders), fetched_at: Utc::now().to_rfc3339() };
            book_cache_put(&url, book.clone());
            hit = Some((book, Duration::ZERO));
        }
    }

    let (book, age) = hit.expect("book present");
    let (variant, variants, sells, buys, summary) = build_book(&book.orders, variant.as_deref());
    Ok(OrderBook {
        name: item_name(&url),
        wfm_url: url,
        variant,
        variants,
        sells,
        buys,
        summary,
        fetched_at: book.fetched_at,
        age_secs: age.as_secs(),
        from_cache,
        ttl_secs: BOOK_TTL.as_secs(),
    })
}

/* ------------------------------------------------------------------------- */
/* Price history                                                              */
/* ------------------------------------------------------------------------- */

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HistoryPoint {
    /// ISO date or date-time.
    pub date: String,
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub median: f64,
    pub volume: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moving_avg: Option<f64>,
}

/// The current cached price row (always present when the item has price data).
#[derive(Clone, Debug, Serialize, Default, PartialEq)]
pub struct PriceSnapshot {
    pub avg: f64,
    pub min: f64,
    pub max: f64,
    pub median: f64,
    pub volume: f64,
    pub moving_avg: Option<f64>,
    pub variant: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct PriceHistory {
    pub wfm_url: String,
    /// "wfm_statistics_90d", "local_daily_snapshots", "riven_scans" or "cache_snapshot" (no history).
    pub source: String,
    /// One sentence for the player on where the numbers come from and how deep they go.
    pub note: String,
    /// Oldest first.
    pub points: Vec<HistoryPoint>,
    pub snapshot: Option<PriceSnapshot>,
    pub variant: String,
}

#[derive(Debug, Deserialize)]
struct V1Stats {
    payload: V1Payload,
}
#[derive(Debug, Deserialize)]
struct V1Payload {
    statistics_closed: V1Closed,
}
#[derive(Debug, Deserialize, Default)]
struct V1Closed {
    #[serde(rename = "90days", default)]
    days90: Vec<V1Row>,
}
#[derive(Clone, Debug, Deserialize, Default)]
pub struct V1Row {
    pub datetime: String,
    #[serde(default)]
    pub volume: f64,
    #[serde(default)]
    pub min_price: f64,
    #[serde(default)]
    pub max_price: f64,
    #[serde(default)]
    pub avg_price: f64,
    #[serde(default)]
    pub median: f64,
    #[serde(default)]
    pub moving_avg: Option<f64>,
    #[serde(default)]
    pub mod_rank: Option<i64>,
    #[serde(default)]
    pub subtype: Option<String>,
}

/// One series from warframe.market's per-variant statistics rows: the requested variant when it
/// has rows, else the variant with the most traded volume. Returns (variant, points oldest first).
pub fn collapse_stats(rows: &[V1Row], requested: Option<&str>) -> (String, Vec<HistoryPoint>) {
    let key = |r: &V1Row| variant_key(r.mod_rank, r.subtype.as_deref(), None, None);
    let mut volume: HashMap<String, f64> = HashMap::new();
    for r in rows {
        *volume.entry(key(r)).or_insert(0.0) += r.volume;
    }
    let chosen = match requested {
        Some(v) if volume.contains_key(v) => v.to_string(),
        _ => volume
            .iter()
            .max_by(|a, b| a.1.total_cmp(b.1).then(b.0.cmp(a.0)))
            .map(|(k, _)| k.clone())
            .unwrap_or_default(),
    };
    let mut points: Vec<HistoryPoint> = rows
        .iter()
        .filter(|r| key(r) == chosen)
        .map(|r| HistoryPoint {
            date: r.datetime.clone(),
            avg: r.avg_price,
            min: r.min_price,
            max: r.max_price,
            median: r.median,
            volume: r.volume,
            moving_avg: r.moving_avg,
        })
        .collect();
    points.sort_by(|a, b| a.date.cmp(&b.date));
    (chosen, points)
}

static STATS: Mutex<Option<TtlCache<Arc<Vec<V1Row>>>>> = Mutex::new(None);
static STATS_FAILED: Mutex<Option<TtlCache<()>>> = Mutex::new(None);

async fn wfm_statistics(url: &str) -> Option<Arc<Vec<V1Row>>> {
    let now = Instant::now();
    if let Some((rows, _)) = STATS.lock().ok()?.as_ref().and_then(|c| c.get(url, now)) {
        return Some(rows);
    }
    if STATS_FAILED.lock().ok()?.as_ref().and_then(|c| c.get(url, now)).is_some() {
        return None;
    }
    let mut last = gate().await;
    let app = states::app_state().ok()?;
    let result = app
        .wfm_client
        .call_api::<V1Stats>(
            ApiVersion::V1,
            reqwest::Method::GET,
            &format!("/items/{url}/statistics"),
            "GET:items:slug:statistics",
            None,
            None,
        )
        .await;
    *last = Some(Instant::now());
    drop(last);
    match result {
        Ok((stats, _, _)) => {
            let rows = Arc::new(stats.payload.statistics_closed.days90);
            STATS.lock().ok()?.get_or_insert_with(|| TtlCache::new(STATS_TTL, 64)).insert(url, rows.clone(), Instant::now());
            Some(rows)
        }
        Err(e) => {
            warning(COMPONENT, &format!("No warframe.market statistics for {url}: {e:?}"), &LoggerOptions::default().set_file("void_trader_market.log"));
            if let Ok(mut g) = STATS_FAILED.lock() {
                g.get_or_insert_with(|| TtlCache::new(STATS_FAIL_TTL, 256)).insert(url, (), Instant::now());
            }
            None
        }
    }
}

/// Daily snapshots recorded from the price cache: url -> [[day, avg, min, max, median, volume]].
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct LocalHistory {
    #[serde(default)]
    pub items: HashMap<String, Vec<(String, f64, f64, f64, f64, f64)>>,
}

fn history_path() -> PathBuf {
    helper::get_app_storage_path().join(HISTORY_FILE)
}

fn load_history() -> LocalHistory {
    std::fs::read_to_string(history_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Record today's snapshot of every item (replacing an earlier one from today) and drop old days.
pub fn record_day(history: &mut LocalHistory, day: &str, cutoff: &str, rows: &[(String, f64, f64, f64, f64, f64)]) {
    for (url, avg, min, max, median, volume) in rows {
        let list = history.items.entry(url.clone()).or_default();
        list.retain(|p| p.0 != day && p.0.as_str() >= cutoff);
        list.push((day.to_string(), *avg, *min, *max, *median, *volume));
        list.sort_by(|a, b| a.0.cmp(&b.0));
    }
    history.items.retain(|_, list| {
        list.retain(|p| p.0.as_str() >= cutoff);
        !list.is_empty()
    });
}

static RECORDED_DAY: Mutex<Option<String>> = Mutex::new(None);

fn price_row_for(url: &str) -> Option<crate::cache::types::item_price_info::ItemPriceInfo> {
    let cache = states::cache_client().ok()?;
    let rows = cache.item_price().get_by_filter(|p| p.wfm_url == url);
    best_row(&rows).cloned()
}

fn snapshot_of(row: &crate::cache::types::item_price_info::ItemPriceInfo) -> PriceSnapshot {
    let st = row.sub_type.as_ref();
    PriceSnapshot {
        avg: row.avg_price,
        min: row.min_price,
        max: row.max_price,
        median: row.median,
        volume: row.volume,
        moving_avg: row.moving_avg.filter(|m| *m > 0.0),
        variant: variant_key(st.and_then(|s| s.rank), st.and_then(|s| s.variant.as_deref()), None, None),
    }
}

#[tauri::command]
pub async fn vt_price_history(wfm_url: String, variant: Option<String>, riven: Option<bool>) -> Result<PriceHistory, Error> {
    let url = wfm_url.trim().to_string();
    if riven.unwrap_or(false) {
        let rows = tauri::async_runtime::spawn_blocking({
            let url = url.clone();
            move || void_riven_market::rows_for(&url)
        })
        .await
        .unwrap_or_default();
        let points: Vec<HistoryPoint> = rows
            .iter()
            .map(|r| HistoryPoint {
                date: r.datetime.clone(),
                avg: r.avg_price,
                min: r.min_price,
                max: r.max_price,
                median: r.median_price,
                volume: r.volume,
                moving_avg: None,
            })
            .collect();
        let snapshot = points.last().map(|p| PriceSnapshot { avg: p.avg, min: p.min, max: p.max, median: p.median, volume: p.volume, moving_avg: None, variant: String::new() });
        let note = if points.is_empty() {
            "No riven market scan yet: run one from the Rivens page.".to_string()
        } else {
            format!("{} riven market scans of live buyout auctions (Void Trader's own scans).", points.len())
        };
        return Ok(PriceHistory { wfm_url: url, source: "riven_scans".into(), note, points, snapshot, variant: String::new() });
    }

    let snapshot = price_row_for(&url).map(|r| snapshot_of(&r));
    let wanted = variant.clone().or_else(|| snapshot.as_ref().map(|s| s.variant.clone()));

    if let Some(rows) = wfm_statistics(&url).await {
        let (chosen, points) = collapse_stats(&rows, wanted.as_deref());
        if !points.is_empty() {
            let note = format!("warframe.market closed trades, last {} days.", points.len());
            return Ok(PriceHistory { wfm_url: url, source: "wfm_statistics_90d".into(), note, points, snapshot, variant: chosen });
        }
    }

    let local = tauri::async_runtime::spawn_blocking(load_history).await.unwrap_or_default();
    let points: Vec<HistoryPoint> = local
        .items
        .get(&url)
        .map(|list| {
            list.iter()
                .map(|(d, avg, min, max, median, volume)| HistoryPoint { date: d.clone(), avg: *avg, min: *min, max: *max, median: *median, volume: *volume, moving_avg: None })
                .collect()
        })
        .unwrap_or_default();
    let variant_key = snapshot.as_ref().map(|s| s.variant.clone()).unwrap_or_default();
    if points.len() >= 2 {
        let note = format!(
            "Daily snapshots of the price cache recorded by Void Trader ({} days so far); warframe.market statistics were not reachable.",
            points.len()
        );
        return Ok(PriceHistory { wfm_url: url, source: "local_daily_snapshots".into(), note, points, snapshot, variant: variant_key });
    }
    let note = "No price history reachable yet: showing the cached price row only. Void Trader records one snapshot a day while you use the observatory.".to_string();
    Ok(PriceHistory { wfm_url: url, source: "cache_snapshot".into(), note, points, snapshot, variant: variant_key })
}

/* ------------------------------------------------------------------------- */
/* Market overview                                                            */
/* ------------------------------------------------------------------------- */

#[derive(Clone, Debug, Serialize, Default, PartialEq)]
pub struct StarFlags {
    /// In the user's stock (stock items or stock rivens).
    pub stock: bool,
    /// The user has a live sell order for it on warframe.market.
    pub live_order: bool,
    pub wish: bool,
    /// Owned in the Warframe inventory (the sell finder's source).
    pub inventory: bool,
    pub riven: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct MarketStar {
    pub wfm_url: String,
    pub wfm_id: String,
    pub name: String,
    /// prime, set, mod, arcane, relic, riven or other.
    pub category: String,
    pub avg_price: f64,
    pub median: f64,
    pub min_price: f64,
    pub max_price: f64,
    /// Trades per day (rivens: live buyout auctions in the latest scan).
    pub volume: f64,
    pub moving_avg: Option<f64>,
    /// Relative trend, -1..1 (0.12 = 12 % above the moving average).
    pub trend: f64,
    /// "rising", "falling", "flat" or "unknown".
    pub trend_dir: String,
    pub profit_margin: f64,
    pub variant: String,
    pub flags: StarFlags,
    pub owned: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct MarketOverview {
    pub items: Vec<MarketStar>,
    pub generated_at: String,
    pub trend_basis: String,
    pub price_rows: usize,
    pub rivens: usize,
    pub history_days: usize,
}

/// Relative trend of an average against its moving average, clamped to -1..1, and its direction.
pub fn trend_of(avg: f64, moving_avg: Option<f64>) -> (f64, &'static str) {
    match moving_avg {
        Some(m) if m > 0.0 && avg > 0.0 => {
            let t = ((avg - m) / m).clamp(-1.0, 1.0);
            let dir = if t > TREND_FLAT {
                "rising"
            } else if t < -TREND_FLAT {
                "falling"
            } else {
                "flat"
            };
            ((t * 1000.0).round() / 1000.0, dir)
        }
        _ => (0.0, "unknown"),
    }
}

/// The row that stands for an item: intact relics, else the busiest row.
pub fn best_row(rows: &[crate::cache::types::item_price_info::ItemPriceInfo]) -> Option<&crate::cache::types::item_price_info::ItemPriceInfo> {
    rows.iter()
        .find(|r| r.sub_type.as_ref().and_then(|s| s.variant.as_deref()) == Some("intact"))
        .or_else(|| rows.iter().max_by(|a, b| a.volume.total_cmp(&b.volume)))
}

/// Riven trend: the latest scan's median against a scan at least a day older.
pub fn riven_trend(history: &[(String, f64)]) -> Option<f64> {
    let (last_day, last) = history.last()?;
    let last_day = last_day.get(..10)?;
    let prev = history.iter().rev().find(|(d, _)| d.get(..10).map_or(false, |x| x < last_day))?;
    (prev.1 > 0.0).then(|| ((last - prev.1) / prev.1).clamp(-1.0, 1.0))
}

#[tauri::command]
pub async fn vt_market_overview(
    wf_inventory: tauri::State<'_, Mutex<Arc<WFInventoryState>>>,
) -> Result<MarketOverview, Error> {
    let root = wf_inventory.lock()?.clone().get_root();
    let cache = states::cache_client()?;
    let conn = DATABASE.get().unwrap();

    let stock = StockItemQuery::get_all(conn, StockItemPaginationQueryDto::new(1, -1)).await?;
    let rivens = StockRivenQuery::get_all(conn, StockRivenPaginationQueryDto::new(1, -1)).await?;
    let wishes = WishListQuery::get_all(conn, WishListPaginationQueryDto::new(1, -1)).await?;
    let stocked: HashSet<String> = stock.results.iter().map(|s| s.wfm_url.clone()).collect();
    let stocked_rivens: HashSet<String> = rivens.results.iter().map(|s| s.wfm_weapon_url.clone()).collect();
    let wished: HashSet<String> = wishes.results.iter().map(|s| s.wfm_url.clone()).collect();
    let mut live: HashSet<String> = stock
        .results
        .iter()
        .filter(|s| format!("{:?}", s.status).eq_ignore_ascii_case("live"))
        .map(|s| s.wfm_url.clone())
        .collect();
    let mut live_ids: HashSet<String> = HashSet::new();
    if let Ok(app) = states::app_state() {
        for o in app.wfm_client.order().cache_orders().sell_orders.iter() {
            live_ids.insert(o.item_id.clone());
        }
    }
    live.extend(rivens.results.iter().filter(|s| format!("{:?}", s.status).eq_ignore_ascii_case("live")).map(|s| s.wfm_weapon_url.clone()));

    let owned_by_unique = void_sell_finder::merge_owned(&[&root.misc_items, &root.recipes, &root.raw_upgrades]);
    let mut owned: HashMap<String, i64> = HashMap::new();
    for (unique, qty) in owned_by_unique {
        if let Ok(t) = cache.tradable_item().get_by(&unique) {
            *owned.entry(t.wfm_url.clone()).or_insert(0) += qty;
        }
    }

    let prices = cache.item_price().get_items()?;
    let price_rows = prices.len();
    let mut by_url: BTreeMap<String, Vec<crate::cache::types::item_price_info::ItemPriceInfo>> = BTreeMap::new();
    for p in prices.into_iter() {
        if p.wfm_url.is_empty() {
            continue;
        }
        by_url.entry(p.wfm_url.clone()).or_default().push(p);
    }

    let mut items = Vec::with_capacity(by_url.len() + 300);
    let mut day_rows = Vec::with_capacity(by_url.len());
    for (url, rows) in by_url.iter() {
        let Some(row) = best_row(rows) else { continue };
        let (name, wfm_id, category) = match cache.tradable_item().get_by(url) {
            Ok(t) => (t.name.clone(), t.wfm_id.clone(), void_sell_finder::category_of(&t.tags).to_string()),
            Err(_) => (url.replace('_', " "), row.wfm_id.clone(), "other".to_string()),
        };
        let moving = row.moving_avg.filter(|m| *m > 0.0);
        let (trend, dir) = trend_of(row.avg_price, moving);
        let snap = snapshot_of(row);
        day_rows.push((url.clone(), row.avg_price, row.min_price, row.max_price, row.median, row.volume));
        items.push(MarketStar {
            wfm_url: url.clone(),
            flags: StarFlags {
                stock: stocked.contains(url),
                live_order: live.contains(url) || live_ids.contains(&wfm_id),
                wish: wished.contains(url),
                inventory: owned.contains_key(url),
                riven: false,
            },
            owned: owned.get(url).copied().unwrap_or(0),
            wfm_id,
            name,
            category,
            avg_price: round2(row.avg_price),
            median: round2(row.median),
            min_price: round2(row.min_price),
            max_price: round2(row.max_price),
            volume: round2(row.volume),
            moving_avg: moving.map(round2),
            trend,
            trend_dir: dir.to_string(),
            profit_margin: round2(row.profit_margin),
            variant: snap.variant,
        });
    }

    // riven families from the local riven market scans
    let riven_rows = tauri::async_runtime::spawn_blocking(void_riven_market::all_rows).await.unwrap_or_default();
    let mut riven_hist: BTreeMap<String, Vec<(String, f64)>> = BTreeMap::new();
    let mut riven_latest: HashMap<String, qf_api::types::RivenPrice> = HashMap::new();
    for r in riven_rows.into_iter() {
        riven_hist.entry(r.wfm_url.clone()).or_default().push((r.datetime.clone(), r.median_price));
        match riven_latest.get(&r.wfm_url) {
            Some(e) if e.datetime >= r.datetime => {}
            _ => {
                riven_latest.insert(r.wfm_url.clone(), r);
            }
        }
    }
    let riven_count = riven_latest.len();
    for (url, r) in riven_latest.into_iter() {
        let mut hist = riven_hist.remove(&url).unwrap_or_default();
        hist.sort_by(|a, b| a.0.cmp(&b.0));
        let trend = riven_trend(&hist);
        let (trend, dir) = match trend {
            Some(t) => (
                (t * 1000.0).round() / 1000.0,
                if t > TREND_FLAT { "rising" } else if t < -TREND_FLAT { "falling" } else { "flat" },
            ),
            None => (0.0, "unknown"),
        };
        items.push(MarketStar {
            flags: StarFlags { stock: stocked_rivens.contains(&url), live_order: live.contains(&url), wish: false, inventory: false, riven: true },
            wfm_id: r.wfm_id.clone(),
            name: format!("{} Riven", r.name),
            category: "riven".into(),
            avg_price: round2(r.avg_price),
            median: round2(r.median_price),
            min_price: round2(r.min_price),
            max_price: round2(r.max_price),
            volume: r.volume,
            moving_avg: None,
            trend,
            trend_dir: dir.to_string(),
            profit_margin: 0.0,
            variant: String::new(),
            owned: 0,
            wfm_url: url,
        });
    }

    // one local snapshot per day, so the ribbon has history even without warframe.market statistics
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let already = RECORDED_DAY.lock().map(|d| d.as_deref() == Some(today.as_str())).unwrap_or(false);
    let history_days = if !already && !day_rows.is_empty() {
        let cutoff = (Utc::now() - chrono::Duration::days(HISTORY_KEEP_DAYS)).format("%Y-%m-%d").to_string();
        let day = today.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut h = load_history();
            record_day(&mut h, &day, &cutoff, &day_rows);
            let days = h.items.values().map(|l| l.len()).max().unwrap_or(0);
            match serde_json::to_string(&h) {
                Ok(json) => {
                    if let Err(e) = std::fs::write(history_path(), json) {
                        warning(COMPONENT, &format!("Could not save the price history: {e}"), &LoggerOptions::default());
                    }
                }
                Err(e) => warning(COMPONENT, &format!("Could not encode the price history: {e}"), &LoggerOptions::default()),
            }
            days
        })
        .await
        .unwrap_or(0)
    } else {
        0
    };
    if let Ok(mut d) = RECORDED_DAY.lock() {
        *d = Some(today);
    }

    Ok(MarketOverview {
        items,
        generated_at: Utc::now().to_rfc3339(),
        trend_basis: "Relative gap between the cached average price and its moving average ((avg - moving_avg) / moving_avg); flat within 5 %. Rivens: latest scan median against a scan a day or more older.".into(),
        price_rows,
        rivens: riven_count,
        history_days,
    })
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(side: &str, plat: i64, status: &str, own: bool, variant: &str) -> BookOrder {
        BookOrder {
            id: format!("{side}{plat}{status}{own}"),
            side: side.into(),
            platinum: plat,
            quantity: 1,
            rank: variant.strip_prefix('r').and_then(|r| r.parse().ok()),
            subtype: None,
            variant: variant.into(),
            user: if own { "me".into() } else { format!("u{plat}") },
            status: status.into(),
            reputation: 0.0,
            own,
            updated_at: String::new(),
        }
    }

    #[test]
    fn ttl_cache_expires_and_evicts() {
        let t0 = Instant::now();
        let mut c: TtlCache<i32> = TtlCache::new(Duration::from_secs(40), 2);
        c.insert("a", 1, t0);
        assert_eq!(c.get("a", t0 + Duration::from_secs(39)).map(|v| v.0), Some(1));
        assert!(c.get("a", t0 + Duration::from_secs(40)).is_none());
        assert!(c.get_any("a", t0 + Duration::from_secs(400)).is_some());
        c.insert("b", 2, t0 + Duration::from_secs(1));
        c.insert("c", 3, t0 + Duration::from_secs(2));
        assert_eq!(c.len(), 2);
        assert!(c.get("a", t0 + Duration::from_secs(2)).is_none(), "oldest entry evicted");
        assert!(c.get("c", t0 + Duration::from_secs(2)).is_some());
    }

    #[test]
    fn summary_spread_and_undercut() {
        let sells = vec![
            order("sell", 10, "online", false, ""),
            order("sell", 12, "ingame", false, ""),
            order("sell", 14, "ingame", true, ""),
            order("sell", 8, "offline", false, ""),
        ];
        let buys = vec![order("buy", 9, "ingame", false, ""), order("buy", 11, "offline", false, "")];
        let s = summarize(&sells, &buys);
        assert_eq!(s.best_sell_ingame, Some(12));
        assert_eq!(s.best_sell_online, Some(10));
        assert_eq!(s.best_sell_any, Some(8));
        assert_eq!(s.best_buy_ingame, Some(9));
        assert_eq!(s.best_buy_any, Some(11));
        assert_eq!(s.spread, Some(3));
        assert_eq!(s.own_sell, Some(14));
        assert_eq!(s.undercut_by, Some(2));
        assert!(!s.own_is_best);
        assert_eq!((s.sellers_ingame, s.buyers_ingame), (2, 1));
    }

    #[test]
    fn own_order_at_the_top_is_best() {
        let sells = vec![order("sell", 12, "ingame", true, ""), order("sell", 12, "ingame", false, ""), order("sell", 15, "ingame", false, "")];
        let s = summarize(&sells, &[]);
        assert_eq!(s.undercut_by, None);
        assert!(s.own_is_best);
        assert_eq!(s.spread, None);
        let empty = summarize(&[], &[]);
        assert_eq!(empty, BookSummary::default());
    }

    #[test]
    fn variants_pick_and_filter() {
        let all = vec![
            order("sell", 40, "ingame", false, "r10"),
            order("sell", 42, "ingame", false, "r10"),
            order("sell", 5, "ingame", false, "r0"),
            order("buy", 3, "ingame", false, "r0"),
            order("sell", 30, "offline", false, "r10"),
        ];
        let (v, variants, sells, buys, _) = build_book(&all, None);
        assert_eq!(variants.iter().map(|v| v.key.as_str()).collect::<Vec<_>>(), vec!["r0", "r10"]);
        assert_eq!(v, "r10", "busiest in-game variant");
        assert_eq!(sells.iter().map(|o| o.platinum).collect::<Vec<_>>(), vec![30, 40, 42]);
        assert!(buys.is_empty());
        let (v, _, sells, buys, s) = build_book(&all, Some("r0"));
        assert_eq!((v.as_str(), sells.len(), buys.len()), ("r0", 1, 1));
        assert_eq!(s.spread, Some(2));
        // unknown request falls back; your own order's variant wins over the busiest
        let mut mine = all.clone();
        mine.push(order("sell", 6, "ingame", true, "r0"));
        assert_eq!(build_book(&mine, Some("r99")).0, "r0");
    }

    #[test]
    fn variant_keys_and_labels() {
        assert_eq!(variant_key(Some(10), None, None, None), "r10");
        assert_eq!(variant_key(None, Some("intact"), None, None), "intact");
        assert_eq!(variant_key(None, None, Some(1), Some(2)), "a1c2");
        assert_eq!(variant_key(None, None, None, None), "");
        assert_eq!(variant_label("r5"), "Rank 5");
        assert_eq!(variant_label("radiant"), "Radiant");
        assert_eq!(variant_label("a1c2"), "1 amber, 2 cyan");
        assert_eq!(variant_label(""), "Any");
    }

    #[test]
    fn trend_signal() {
        assert_eq!(trend_of(110.0, Some(100.0)), (0.1, "rising"));
        assert_eq!(trend_of(90.0, Some(100.0)), (-0.1, "falling"));
        assert_eq!(trend_of(103.0, Some(100.0)), (0.03, "flat"));
        assert_eq!(trend_of(50.0, None), (0.0, "unknown"));
        assert_eq!(trend_of(50.0, Some(0.0)), (0.0, "unknown"));
        assert_eq!(trend_of(500.0, Some(100.0)).0, 1.0, "clamped");
    }

    #[test]
    fn riven_trend_needs_an_older_day() {
        let h = vec![("2026-11-10T10:00:00Z".to_string(), 100.0), ("2026-11-10T18:00:00Z".to_string(), 120.0)];
        assert_eq!(riven_trend(&h), None);
        let h = vec![("2026-11-09T10:00:00Z".to_string(), 100.0), ("2026-11-10T18:00:00Z".to_string(), 80.0)];
        assert_eq!(riven_trend(&h), Some(-0.2));
    }

    #[test]
    fn stats_collapse_to_one_variant() {
        let row = |d: &str, rank: Option<i64>, vol: f64, avg: f64| V1Row { datetime: d.into(), volume: vol, avg_price: avg, mod_rank: rank, ..Default::default() };
        let rows = vec![
            row("2026-11-02T00:00:00Z", Some(0), 30.0, 5.0),
            row("2026-11-01T00:00:00Z", Some(0), 20.0, 4.0),
            row("2026-11-01T00:00:00Z", Some(10), 8.0, 40.0),
        ];
        let (v, pts) = collapse_stats(&rows, None);
        assert_eq!(v, "r0");
        assert_eq!(pts.iter().map(|p| p.avg).collect::<Vec<_>>(), vec![4.0, 5.0], "sorted oldest first");
        let (v, pts) = collapse_stats(&rows, Some("r10"));
        assert_eq!((v.as_str(), pts.len()), ("r10", 1));
        let (v, pts) = collapse_stats(&[], None);
        assert_eq!((v.as_str(), pts.len()), ("", 0));
    }

    #[test]
    fn v1_statistics_parse() {
        let json = r#"{"payload":{"statistics_closed":{"48hours":[],"90days":[{"datetime":"2026-11-01T00:00:00.000+00:00","volume":12,"min_price":8,"max_price":12,"open_price":9,"closed_price":10,"avg_price":10.2,"wa_price":10.1,"median":10,"moving_avg":9.8,"donch_top":12,"donch_bot":8,"id":"x"}]},"statistics_live":{}}}"#;
        let s: V1Stats = serde_json::from_str(json).unwrap();
        assert_eq!(s.payload.statistics_closed.days90.len(), 1);
        assert_eq!(s.payload.statistics_closed.days90[0].moving_avg, Some(9.8));
    }

    #[test]
    fn local_history_records_one_point_per_day() {
        let mut h = LocalHistory::default();
        let row = |avg: f64| vec![("nova_prime_set".to_string(), avg, 1.0, 2.0, 1.5, 10.0)];
        record_day(&mut h, "2026-11-10", "2026-08-12", &row(50.0));
        record_day(&mut h, "2026-11-11", "2026-08-13", &row(52.0));
        record_day(&mut h, "2026-11-11", "2026-08-13", &row(53.0));
        let list = &h.items["nova_prime_set"];
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].1, 53.0, "today's point replaced");
        record_day(&mut h, "2027-02-20", "2026-11-11", &row(60.0));
        assert_eq!(h.items["nova_prime_set"].iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), vec!["2026-11-11", "2027-02-20"]);
    }

    #[test]
    fn best_row_prefers_intact_then_volume() {
        use crate::cache::types::item_price_info::ItemPriceInfo;
        let mut a = ItemPriceInfo::default();
        a.volume = 5.0;
        let mut b = ItemPriceInfo::default();
        b.volume = 9.0;
        assert_eq!(best_row(&[a.clone(), b.clone()]).unwrap().volume, 9.0);
        let mut c = ItemPriceInfo::default();
        c.volume = 1.0;
        c.sub_type = Some(utils::SubType::variant("intact"));
        assert_eq!(best_row(&[a, b, c]).unwrap().volume, 1.0);
        assert!(best_row(&[]).is_none());
    }
}
