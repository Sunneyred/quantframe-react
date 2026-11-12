//! Void Trader: local riven market.
//!
//! Replaces the server-side riven price database with data Void Trader collects itself from
//! warframe.market's public auction search. A scan walks every riven weapon family, records
//! live buyout prices (volume, min, max, average, median) and stores them as an hourly snapshot
//! in the app data folder. History builds up the more often you scan.

use std::{
    collections::{BTreeMap, HashMap},
    path::PathBuf,
    sync::Mutex,
    time::Duration,
};

use chrono::{SubsecRound, Utc};
use qf_api::types::RivenPrice;
use serde::{Deserialize, Serialize};
use utils::{get_location, info, warning, Error, LoggerOptions};
use wf_market::{enums::AuctionType, types::AuctionFilter};

use crate::{helper, utils::modules::states};

const COMPONENT: &str = "VoidTrader:RivenMarket";
const STORE_FILE: &str = "void_trader_riven_market.json";
/// Days of snapshots kept on disk.
const KEEP_DAYS: i64 = 90;
/// Pause between auction searches to stay well inside warframe.market's rate limit.
const REQUEST_GAP: Duration = Duration::from_millis(400);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct RivenMarketStatus {
    pub running: bool,
    pub done: usize,
    pub total: usize,
    pub current: String,
    pub started_at: Option<String>,
    pub last_completed: Option<String>,
    pub last_error: Option<String>,
}

static STATUS: Mutex<Option<RivenMarketStatus>> = Mutex::new(None);

fn status_get() -> RivenMarketStatus {
    STATUS.lock().unwrap().clone().unwrap_or_default()
}

fn status_update(f: impl FnOnce(&mut RivenMarketStatus)) {
    let mut guard = STATUS.lock().unwrap();
    let status = guard.get_or_insert_with(RivenMarketStatus::default);
    f(status);
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct RivenMarketStore {
    rows: Vec<RivenPrice>,
}

fn store_path() -> PathBuf {
    helper::get_app_storage_path().join(STORE_FILE)
}

fn load_store() -> RivenMarketStore {
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &RivenMarketStore) -> Result<(), Error> {
    let json = serde_json::to_string(store).map_err(|e| {
        Error::new(COMPONENT, format!("Failed to serialize store: {e}"), get_location!())
    })?;
    std::fs::write(store_path(), json).map_err(|e| {
        Error::new(COMPONENT, format!("Failed to write store: {e}"), get_location!())
    })
}

/// Every stored riven scan row (all snapshots). Blocking: call from a blocking task.
pub(crate) fn all_rows() -> Vec<RivenPrice> {
    load_store().rows
}

/// Stored scan rows of one riven family, oldest first. Blocking: call from a blocking task.
pub(crate) fn rows_for(wfm_url: &str) -> Vec<RivenPrice> {
    let mut rows: Vec<RivenPrice> = load_store().rows.into_iter().filter(|r| r.wfm_url == wfm_url).collect();
    rows.sort_by(|a, b| a.datetime.cmp(&b.datetime));
    rows
}

/// Summary statistics over a list of buyout prices.
#[derive(Clone, Debug, PartialEq)]
pub struct PriceStats {
    pub volume: usize,
    pub min: f64,
    pub max: f64,
    pub avg: f64,
    pub median: f64,
}

pub fn price_stats(prices: &[i64]) -> Option<PriceStats> {
    let mut p: Vec<i64> = prices.iter().copied().filter(|p| *p > 0).collect();
    if p.is_empty() {
        return None;
    }
    p.sort_unstable();
    let n = p.len();
    let median = if n % 2 == 1 {
        p[n / 2] as f64
    } else {
        (p[n / 2 - 1] + p[n / 2]) as f64 / 2.0
    };
    let avg = p.iter().sum::<i64>() as f64 / n as f64;
    Some(PriceStats {
        volume: n,
        min: p[0] as f64,
        max: p[n - 1] as f64,
        avg: (avg * 100.0).round() / 100.0,
        median,
    })
}

/// One entry per riven family: (riven url, riven id, display name).
fn riven_families() -> Result<Vec<(String, String, String)>, Error> {
    let cache = states::cache_client()?;
    let mut families: BTreeMap<String, (String, String)> = BTreeMap::new();
    for weapon in cache.weapon().get_all_items()? {
        if weapon.wfm_riven_url.is_empty() {
            continue;
        }
        families
            .entry(weapon.wfm_riven_url.clone())
            .and_modify(|(id, name)| {
                // Prefer the shortest name (the base weapon, e.g. "Braton" over "Braton Prime").
                if weapon.name.len() < name.len() {
                    *name = weapon.name.clone();
                }
                if id.is_empty() {
                    *id = weapon.wfm_riven_id.clone();
                }
            })
            .or_insert((weapon.wfm_riven_id.clone(), weapon.name.clone()));
    }
    Ok(families
        .into_iter()
        .map(|(url, (id, name))| (url, id, name))
        .collect())
}

async fn run_scan() -> Result<usize, Error> {
    let log = LoggerOptions::default().set_file("void_trader_riven_market.log");
    let families = riven_families()?;
    status_update(|s| {
        s.total = families.len();
        s.done = 0;
    });

    let snapshot_time = Utc::now()
        .trunc_subsecs(0)
        .format("%Y-%m-%dT%H:00:00Z")
        .to_string();
    let mut rows = Vec::with_capacity(families.len());

    for (url, id, name) in families.iter() {
        if !status_get().running {
            break;
        }
        status_update(|s| s.current = name.clone());
        let wfm_client = states::app_state()?.wfm_client;

        let mut attempt = 0;
        let auctions = loop {
            let filter = AuctionFilter::new(AuctionType::Riven, url)
                .with_buyout_policy("direct")
                .with_sort_by("price_asc");
            match wfm_client.auction().search_auctions(filter).await {
                Ok(a) => break Some(a),
                Err(wf_market::errors::ApiError::TooManyRequests(err)) if attempt == 0 => {
                    attempt += 1;
                    let wait = err.retry_after.unwrap_or(2).max(2);
                    warning(COMPONENT, &format!("Rate limited, waiting {wait}s"), &log);
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                }
                Err(e) => {
                    warning(COMPONENT, &format!("Skipping {url}: {e:?}"), &log);
                    break None;
                }
            }
        };

        if let Some(auctions) = auctions {
            if let Some(stats) = price_stats(&auctions.prices()) {
                rows.push(RivenPrice {
                    wfm_id: id.clone(),
                    uuid: url.clone(),
                    wfm_url: url.clone(),
                    name: name.clone(),
                    volume: stats.volume as f64,
                    min_price: stats.min,
                    max_price: stats.max,
                    avg_price: stats.avg,
                    median_price: stats.median,
                    datetime: snapshot_time.clone(),
                    ..Default::default()
                });
            }
        }
        status_update(|s| s.done += 1);
        tokio::time::sleep(REQUEST_GAP).await;
    }

    // Merge into the store: replace any rows from the same hour, drop old history.
    let mut store = load_store();
    let cutoff = (Utc::now() - chrono::Duration::days(KEEP_DAYS))
        .format("%Y-%m-%d")
        .to_string();
    store
        .rows
        .retain(|r| r.datetime != snapshot_time && r.datetime.as_str() >= cutoff.as_str());
    let count = rows.len();
    store.rows.extend(rows);
    save_store(&store)?;
    info(
        COMPONENT,
        &format!("Riven market scan stored {count} weapons at {snapshot_time}"),
        &log,
    );
    Ok(count)
}

#[tauri::command]
pub async fn vt_riven_market_scan() -> Result<RivenMarketStatus, Error> {
    if status_get().running {
        return Ok(status_get());
    }
    status_update(|s| {
        s.running = true;
        s.done = 0;
        s.total = 0;
        s.current = String::new();
        s.last_error = None;
        s.started_at = Some(Utc::now().to_rfc3339());
    });
    tauri::async_runtime::spawn(async move {
        let result = run_scan().await;
        status_update(|s| {
            s.running = false;
            s.current = String::new();
            match result {
                Ok(_) => s.last_completed = Some(Utc::now().to_rfc3339()),
                Err(e) => s.last_error = Some(e.message.clone()),
            }
        });
    });
    Ok(status_get())
}

#[tauri::command]
pub async fn vt_riven_market_stop() -> Result<RivenMarketStatus, Error> {
    status_update(|s| s.running = false);
    Ok(status_get())
}

#[tauri::command]
pub async fn vt_riven_market_status() -> Result<RivenMarketStatus, Error> {
    let mut status = status_get();
    if status.last_completed.is_none() {
        status.last_completed = load_store().rows.iter().map(|r| r.datetime.clone()).max();
    }
    Ok(status)
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct VtRivenQuery {
    #[serde(default)]
    pub page: Option<i64>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub sort_by: Option<String>,
    #[serde(default)]
    pub sort_direction: Option<String>,
    #[serde(default)]
    pub from_date: Option<String>,
    #[serde(default)]
    pub to_date: Option<String>,
    #[serde(default)]
    pub volume_gt: Option<f64>,
    #[serde(default)]
    pub volume_lt: Option<f64>,
    #[serde(default)]
    pub min_price_gt: Option<f64>,
    #[serde(default)]
    pub min_price_lt: Option<f64>,
    #[serde(default)]
    pub max_price_gt: Option<f64>,
    #[serde(default)]
    pub max_price_lt: Option<f64>,
    #[serde(default)]
    pub avg_price_gt: Option<f64>,
    #[serde(default)]
    pub avg_price_lt: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VtRivenPage {
    pub total: i64,
    pub limit: i64,
    pub page: i64,
    pub total_pages: i64,
    pub results: Vec<RivenPrice>,
}

fn in_range(v: f64, gt: Option<f64>, lt: Option<f64>) -> bool {
    gt.map_or(true, |g| v >= g) && lt.map_or(true, |l| v <= l)
}

/// Filter, sort and paginate stored rows. With no date range, only the latest snapshot is used.
pub fn query_rows(rows: &[RivenPrice], q: &VtRivenQuery) -> VtRivenPage {
    let from = q.from_date.as_deref().map(|d| d.get(..10).unwrap_or(d).to_string());
    let to = q.to_date.as_deref().map(|d| d.get(..10).unwrap_or(d).to_string());
    let latest = rows.iter().map(|r| r.datetime.as_str()).max().unwrap_or("").to_string();
    let needle = q.query.clone().unwrap_or_default().to_lowercase();

    let mut out: Vec<RivenPrice> = rows
        .iter()
        .filter(|r| match (&from, &to) {
            (None, None) => r.datetime == latest,
            _ => {
                let day = r.datetime.get(..10).unwrap_or("");
                from.as_deref().map_or(true, |f| day >= f) && to.as_deref().map_or(true, |t| day <= t)
            }
        })
        .filter(|r| needle.is_empty() || r.name.to_lowercase().contains(&needle) || r.wfm_url.contains(&needle))
        .filter(|r| in_range(r.volume, q.volume_gt, q.volume_lt))
        .filter(|r| in_range(r.min_price, q.min_price_gt, q.min_price_lt))
        .filter(|r| in_range(r.max_price, q.max_price_gt, q.max_price_lt))
        .filter(|r| in_range(r.avg_price, q.avg_price_gt, q.avg_price_lt))
        .cloned()
        .collect();

    // A date range spanning several snapshots: collapse to one row per weapon (latest wins).
    if from.is_some() || to.is_some() {
        let mut by_url: HashMap<String, RivenPrice> = HashMap::new();
        for r in out.into_iter() {
            match by_url.get(&r.wfm_url) {
                Some(existing) if existing.datetime >= r.datetime => {}
                _ => {
                    by_url.insert(r.wfm_url.clone(), r);
                }
            }
        }
        out = by_url.into_values().collect();
    }

    let desc = q.sort_direction.as_deref() == Some("desc");
    let key = q.sort_by.clone().unwrap_or_else(|| "name".to_string());
    out.sort_by(|a, b| {
        let ord = match key.as_str() {
            "volume" => a.volume.total_cmp(&b.volume),
            "min_price" => a.min_price.total_cmp(&b.min_price),
            "max_price" => a.max_price.total_cmp(&b.max_price),
            "avg_price" => a.avg_price.total_cmp(&b.avg_price),
            "median_price" => a.median_price.total_cmp(&b.median_price),
            "datetime" => a.datetime.cmp(&b.datetime),
            _ => a.name.cmp(&b.name),
        };
        if desc { ord.reverse() } else { ord }
    });

    let total = out.len() as i64;
    let limit = q.limit.unwrap_or(25);
    let page = q.page.unwrap_or(1).max(1);
    let results = if limit <= 0 {
        out
    } else {
        out.into_iter()
            .skip(((page - 1) * limit) as usize)
            .take(limit as usize)
            .collect()
    };
    let total_pages = if limit <= 0 { 1 } else { (total + limit - 1) / limit };
    VtRivenPage { total, limit, page, total_pages, results }
}

#[tauri::command]
pub async fn vt_riven_prices_lookup(query: VtRivenQuery) -> Result<VtRivenPage, Error> {
    let store = tauri::async_runtime::spawn_blocking(load_store)
        .await
        .unwrap_or_default();
    Ok(query_rows(&store.rows, &query))
}

/// Price history for one riven weapon, oldest first.
#[tauri::command]
pub async fn vt_riven_price_history(wfm_url: String) -> Result<Vec<RivenPrice>, Error> {
    let store = tauri::async_runtime::spawn_blocking(load_store)
        .await
        .unwrap_or_default();
    let mut rows: Vec<RivenPrice> = store.rows.into_iter().filter(|r| r.wfm_url == wfm_url).collect();
    rows.sort_by(|a, b| a.datetime.cmp(&b.datetime));
    Ok(rows)
}

#[tauri::command]
pub async fn vt_riven_prices_export(query: VtRivenQuery) -> Result<String, Error> {
    use tauri_plugin_dialog::DialogExt;
    let store = load_store();
    let mut q = query;
    q.limit = Some(-1);
    let page = query_rows(&store.rows, &q);
    let app = crate::APP.get().unwrap();
    let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("VoidTrader_RivenPrices", &["json"])
        .blocking_save_file()
    else {
        return Ok(String::new());
    };
    let json = serde_json::to_string_pretty(&page.results)
        .map_err(|e| Error::new(COMPONENT, format!("Export failed: {e}"), get_location!()))?;
    let path = file_path
        .as_path()
        .ok_or_else(|| Error::new(COMPONENT, "Invalid export path", get_location!()))?
        .to_path_buf();
    std::fs::write(&path, json)
        .map_err(|e| Error::new(COMPONENT, format!("Export failed: {e}"), get_location!()))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(url: &str, dt: &str, min: f64, vol: f64) -> RivenPrice {
        RivenPrice {
            wfm_url: url.into(),
            name: url.into(),
            datetime: dt.into(),
            min_price: min,
            volume: vol,
            ..Default::default()
        }
    }

    #[test]
    fn stats() {
        assert_eq!(price_stats(&[]), None);
        let s = price_stats(&[30, 10, 20, 0]).unwrap();
        assert_eq!((s.volume, s.min, s.max, s.avg, s.median), (3, 10.0, 30.0, 20.0, 20.0));
        let s = price_stats(&[10, 20, 30, 40]).unwrap();
        assert_eq!(s.median, 25.0);
    }

    #[test]
    fn latest_snapshot_by_default() {
        let rows = vec![
            row("braton", "2026-11-09T10:00:00Z", 50.0, 5.0),
            row("braton", "2026-11-10T10:00:00Z", 60.0, 6.0),
            row("rubico", "2026-11-10T10:00:00Z", 200.0, 30.0),
        ];
        let p = query_rows(&rows, &VtRivenQuery::default());
        assert_eq!(p.total, 2);
        let p = query_rows(
            &rows,
            &VtRivenQuery { min_price_gt: Some(100.0), ..Default::default() },
        );
        assert_eq!(p.results[0].wfm_url, "rubico");
    }

    #[test]
    fn range_collapses_to_latest_per_weapon() {
        let rows = vec![
            row("braton", "2026-11-09T10:00:00Z", 50.0, 5.0),
            row("braton", "2026-11-10T10:00:00Z", 60.0, 6.0),
        ];
        let q = VtRivenQuery {
            from_date: Some("2026-11-01".into()),
            to_date: Some("2026-11-10".into()),
            ..Default::default()
        };
        let p = query_rows(&rows, &q);
        assert_eq!(p.total, 1);
        assert_eq!(p.results[0].min_price, 60.0);
    }
}
