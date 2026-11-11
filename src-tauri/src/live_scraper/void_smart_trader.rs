//! Void Trader: trading presets + smart trader.
//!
//! The live scraper never trades on the saved settings directly. Each cycle it asks this
//! module for the EFFECTIVE settings:
//!
//!   saved settings  ->  overlaid by the active preset  ->  adjusted by live signals
//!
//! Nothing here writes back to the saved settings. All decisions are pure functions
//! (`compute_effective`, `price_trend`, ...) so they can be unit tested; the small amount of
//! runtime state (last signals, liquidation latch, adjustment feed) lives in `STATE`.

use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
};

use entity::{
    stock_item::StockItemPaginationQueryDto, stock_riven::StockRivenPaginationQueryDto,
};
use serde::Serialize;
use service::{StockItemQuery, StockRivenQuery};
use tauri::Manager;
use utils::Error;

use crate::{
    app::{LiveScraperSettings, TradingPreset, VoidTraderSettings},
    enums::{StockMode, TradeMode},
    utils::modules::states,
    wf_inventory::WFInventoryState,
    APP, DATABASE,
};

/* ------------------------------- Constants ------------------------------- */

/// Net worth needed for each tier.
pub const TIER_FLIPPER: i64 = 300;
pub const TIER_RIVEN_HUNTER: i64 = 1_000;
pub const TIER_HIGH_ROLLER: i64 = 1_500;

/// No single buy above this share of the plat balance.
const MAX_SINGLE_BUY_PERCENT: i64 = 25;
/// Trades left today at which the sell minimum profit goes up by 50% / doubles.
const TRADES_LOW: i64 = 8;
const TRADES_CRITICAL: i64 = 3;
/// Share of net worth tied up in unsold stock that starts / ends forced liquidation.
const STUCK_ENTER: f64 = 0.60;
const STUCK_EXIT: f64 = 0.40;
/// A week shift counts as a trend when it is at least this share of the average price
/// AND at least this many plat.
const TREND_RATIO: f64 = 0.10;
const TREND_MIN_PLAT: f64 = 2.0;
/// Market is crowded when at least this many sellers are online and they outnumber
/// two days of trades.
const CROWDED_MIN_SELLERS: usize = 10;
const CROWDED_DAYS_OF_VOLUME: f64 = 2.0;

const FEED_SIZE: usize = 100;

/// Setting paths (relative to `live_scraper`) a preset or the smart trader may change.
/// These are the names accepted in `void_trader.locked_fields`.
pub const MANAGED_FIELDS: [&str; 20] = [
    "general.trade_modes",
    "general.stock_mode",
    "items.wtb.volume_threshold",
    "items.wtb.profit_threshold",
    "items.wtb.avg_price_cap",
    "items.wtb.max_total_price_cap",
    "items.wtb.buy_quantity",
    "items.wtb.max_stock_quantity",
    "items.wtb.outbid_step",
    "items.wtb.min_roi_percentage",
    "items.wts.min_profit",
    "items.wts.min_profit_percentage",
    "items.wts.undercut_step",
    "items.wts.stale_after_days",
    "items.wts.stale_decay_percentage",
    "items.wts.stale_floor_profit",
    "rivens.wts.min_profit",
    "rivens.wts.auto_match_stats",
    "rivens.wts.min_comparables",
    "rivens.wts.undercut_step",
];

/* -------------------------------- Presets -------------------------------- */

/// The values a preset writes over the saved settings.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PresetValues {
    /// False removes the buy trade mode.
    pub buy_enabled: bool,
    /// True forces rivens to be processed even when the stock mode is items only.
    pub include_rivens: bool,
    pub wtb_volume_threshold: i64,
    pub wtb_profit_threshold: i64,
    pub wtb_avg_price_cap: i64,
    pub wtb_max_total_price_cap: i64,
    pub wtb_buy_quantity: i64,
    pub wtb_max_stock_quantity: i64,
    pub wtb_outbid_step: i64,
    pub wtb_min_roi_percentage: i64,
    pub wts_min_profit: i64,
    /// None leaves the saved percentage alone.
    pub wts_min_profit_percentage: Option<i64>,
    pub wts_undercut_step: i64,
    pub wts_stale_after_days: i64,
    pub wts_stale_decay_percentage: i64,
    pub wts_stale_floor_profit: i64,
    pub riven_min_profit: i64,
    pub riven_auto_match_stats: bool,
    pub riven_min_comparables: i64,
    pub riven_undercut_step: i64,
}

pub fn preset_values(preset: TradingPreset) -> PresetValues {
    match preset {
        // Under 300p: one cheap, fast-moving item at a time.
        TradingPreset::Scavenger => PresetValues {
            buy_enabled: true,
            include_rivens: false,
            wtb_volume_threshold: 40,
            wtb_profit_threshold: 5,
            wtb_avg_price_cap: 15,
            wtb_max_total_price_cap: 60,
            wtb_buy_quantity: 1,
            wtb_max_stock_quantity: 1,
            wtb_outbid_step: 1,
            wtb_min_roi_percentage: 20,
            wts_min_profit: 5,
            wts_min_profit_percentage: None,
            wts_undercut_step: 1,
            wts_stale_after_days: 5,
            wts_stale_decay_percentage: 20,
            wts_stale_floor_profit: 2,
            riven_min_profit: 25,
            riven_auto_match_stats: true,
            riven_min_comparables: 3,
            riven_undercut_step: 1,
        },
        // 300p to 1,500p: quick flips up to 60p.
        TradingPreset::Flipper => PresetValues {
            buy_enabled: true,
            include_rivens: false,
            wtb_volume_threshold: 20,
            wtb_profit_threshold: 8,
            wtb_avg_price_cap: 60,
            wtb_max_total_price_cap: 600,
            wtb_buy_quantity: 2,
            wtb_max_stock_quantity: 3,
            wtb_outbid_step: 1,
            wtb_min_roi_percentage: 15,
            wts_min_profit: 10,
            wts_min_profit_percentage: None,
            wts_undercut_step: 1,
            wts_stale_after_days: 5,
            wts_stale_decay_percentage: 20,
            wts_stale_floor_profit: 2,
            riven_min_profit: 25,
            riven_auto_match_stats: true,
            riven_min_comparables: 3,
            riven_undercut_step: 1,
        },
        // 1,500p+: expensive items, bigger margins, holds price longer.
        TradingPreset::HighRoller => PresetValues {
            buy_enabled: true,
            include_rivens: false,
            wtb_volume_threshold: 10,
            wtb_profit_threshold: 20,
            wtb_avg_price_cap: 400,
            wtb_max_total_price_cap: 3_000,
            wtb_buy_quantity: 2,
            wtb_max_stock_quantity: 4,
            wtb_outbid_step: 1,
            wtb_min_roi_percentage: 10,
            wts_min_profit: 20,
            wts_min_profit_percentage: None,
            wts_undercut_step: 1,
            wts_stale_after_days: 10,
            wts_stale_decay_percentage: 10,
            wts_stale_floor_profit: 5,
            riven_min_profit: 40,
            riven_auto_match_stats: true,
            riven_min_comparables: 3,
            riven_undercut_step: 1,
        },
        // 1,000p+: rivens first; item buying kept small so plat stays free for rivens.
        TradingPreset::RivenHunter => PresetValues {
            buy_enabled: true,
            include_rivens: true,
            wtb_volume_threshold: 25,
            wtb_profit_threshold: 10,
            wtb_avg_price_cap: 60,
            wtb_max_total_price_cap: 300,
            wtb_buy_quantity: 1,
            wtb_max_stock_quantity: 2,
            wtb_outbid_step: 1,
            wtb_min_roi_percentage: 15,
            wts_min_profit: 10,
            wts_min_profit_percentage: None,
            wts_undercut_step: 1,
            wts_stale_after_days: 5,
            wts_stale_decay_percentage: 20,
            wts_stale_floor_profit: 2,
            riven_min_profit: 60,
            riven_auto_match_stats: true,
            riven_min_comparables: 5,
            riven_undercut_step: 1,
        },
        // No buying; sell everything, break-even allowed.
        TradingPreset::Liquidate => PresetValues {
            buy_enabled: false,
            include_rivens: false,
            wtb_volume_threshold: 40,
            wtb_profit_threshold: 10,
            wtb_avg_price_cap: 0,
            wtb_max_total_price_cap: 0,
            wtb_buy_quantity: 1,
            wtb_max_stock_quantity: 1,
            wtb_outbid_step: 0,
            wtb_min_roi_percentage: 15,
            wts_min_profit: 0,
            wts_min_profit_percentage: Some(-1),
            wts_undercut_step: 3,
            wts_stale_after_days: 0,
            wts_stale_decay_percentage: 100,
            wts_stale_floor_profit: 0,
            riven_min_profit: 0,
            riven_auto_match_stats: true,
            riven_min_comparables: 3,
            riven_undercut_step: 3,
        },
    }
}

/// Net worth needed before a preset may be selected (0 = always).
pub fn required_net_worth(preset: TradingPreset) -> i64 {
    match preset {
        TradingPreset::Scavenger | TradingPreset::Liquidate => 0,
        TradingPreset::Flipper => TIER_FLIPPER,
        TradingPreset::RivenHunter => TIER_RIVEN_HUNTER,
        TradingPreset::HighRoller => TIER_HIGH_ROLLER,
    }
}

/// The highest tier reached at this net worth.
pub fn tier_for(net_worth: i64) -> TradingPreset {
    if net_worth >= TIER_HIGH_ROLLER {
        TradingPreset::HighRoller
    } else if net_worth >= TIER_RIVEN_HUNTER {
        TradingPreset::RivenHunter
    } else if net_worth >= TIER_FLIPPER {
        TradingPreset::Flipper
    } else {
        TradingPreset::Scavenger
    }
}

/// Presets the tier rules allow at this net worth (liquidate always).
pub fn allowed_presets(net_worth: i64) -> Vec<TradingPreset> {
    TradingPreset::ALL
        .iter()
        .copied()
        .filter(|p| net_worth >= required_net_worth(*p))
        .collect()
}

/// Tier gate used by `vt_strategy_set`.
pub fn validate_preset(preset: TradingPreset, net_worth: i64, strict_tiers: bool) -> Result<(), String> {
    let needed = required_net_worth(preset);
    if strict_tiers && net_worth < needed {
        return Err(format!(
            "{} needs a net worth of {}p; yours is {}p. Reach that tier or turn off strict tiers.",
            preset.label(),
            needed,
            net_worth
        ));
    }
    Ok(())
}

/* -------------------------------- Signals -------------------------------- */

/// What the smart trader knows about the account right now.
#[derive(Clone, Debug, PartialEq, Serialize, Default)]
pub struct Signals {
    /// Plat balance: from the inventory when live, otherwise tracked sales minus purchases.
    pub balance: i64,
    /// True when the balance comes from the game inventory.
    pub balance_is_live: bool,
    /// Cost value (what was paid) of unsold item and riven stock.
    pub stock_value: i64,
    /// Trades left today; None when the inventory is not available.
    pub trades_remaining: Option<i64>,
}

impl Signals {
    pub fn net_worth(&self) -> i64 {
        self.balance.max(0) + self.stock_value.max(0)
    }
    /// A tracked balance of 0 just means "no data", so balance rules are skipped for it.
    pub fn balance_known(&self) -> bool {
        self.balance_is_live || self.balance > 0
    }
}

/// Plat balance with the same fallback as `vt_plat_goal`.
pub fn resolve_balance(inventory_platinum: i64, mastery_rank: i64, tracked_balance: i64) -> (i64, bool) {
    let live = mastery_rank > 0 || inventory_platinum > 0;
    if live {
        (inventory_platinum.max(0), true)
    } else {
        (tracked_balance.max(0), false)
    }
}

/* ------------------------------ Adjustments ------------------------------ */

/// One thing the smart trader changed, and why.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Adjustment {
    /// RFC 3339 time the adjustment was first seen (empty until recorded).
    pub time: String,
    pub field: String,
    pub from: String,
    pub to: String,
    pub reason: String,
}

impl Adjustment {
    fn new(field: &str, from: impl ToString, to: impl ToString, reason: String) -> Self {
        Self {
            time: String::new(),
            field: field.to_string(),
            from: from.to_string(),
            to: to.to_string(),
            reason,
        }
    }
}

/// Keep a smart adjustment within 0.5x to 2x of the preset value.
pub fn bounded(base: i64, wanted: i64) -> i64 {
    if base <= 0 {
        return base;
    }
    let low = (base + 1) / 2;
    let high = base.saturating_mul(2);
    wanted.clamp(low, high)
}

/// Multiplier (in percent) for the sell minimum profit given trades left today.
pub fn trades_left_multiplier_pct(trades_remaining: Option<i64>) -> i64 {
    match trades_remaining {
        Some(t) if t <= TRADES_CRITICAL => 200,
        Some(t) if t <= TRADES_LOW => 150,
        _ => 100,
    }
}

/// Scarce trades: raise a minimum profit (rounded up), bounded to 2x.
pub fn raise_min_profit(base: i64, trades_remaining: Option<i64>) -> i64 {
    let pct = trades_left_multiplier_pct(trades_remaining);
    if base <= 0 || pct == 100 {
        return base;
    }
    bounded(base, (base.saturating_mul(pct) + 99) / 100)
}

/// Stuck capital latch: enter above 60% of net worth in stock, leave below 40%.
pub fn stuck_capital(signals: &Signals, was_liquidating: bool) -> bool {
    let net_worth = signals.net_worth();
    if !signals.balance_known() || net_worth <= 0 {
        return false;
    }
    let ratio = signals.stock_value.max(0) as f64 / net_worth as f64;
    if was_liquidating {
        ratio >= STUCK_EXIT
    } else {
        ratio > STUCK_ENTER
    }
}

/// Largest single buy the balance allows (25%).
pub fn single_buy_limit(balance: i64) -> i64 {
    balance.max(0) * MAX_SINGLE_BUY_PERCENT / 100
}

/// Lower a cap to `limit`; a disabled cap (-1) becomes the limit. Never raises.
fn cap_to(current: i64, limit: i64) -> i64 {
    if current < 0 || current > limit {
        limit
    } else {
        current
    }
}

/* --------------------------- Effective settings --------------------------- */

#[derive(Clone, Debug)]
pub struct Outcome {
    pub settings: LiveScraperSettings,
    pub effective_preset: TradingPreset,
    /// Stuck-capital latch after this evaluation.
    pub liquidating: bool,
    /// Smart adjustments in force (not the plain preset overlay).
    pub adjustments: Vec<Adjustment>,
}

/// Write a preset over the settings, skipping locked fields.
pub fn apply_preset(settings: &mut LiveScraperSettings, preset: TradingPreset) {
    let vt = settings.void_trader.clone();
    let v = preset_values(preset);
    macro_rules! set {
        ($path:literal, $target:expr, $value:expr) => {
            if !vt.is_locked($path) {
                $target = $value;
            }
        };
    }
    if !v.buy_enabled && !vt.is_locked("general.trade_modes") {
        settings.general.trade_modes.retain(|m| *m != TradeMode::Buy);
    }
    if v.include_rivens
        && settings.general.stock_mode == StockMode::Item
        && !vt.is_locked("general.stock_mode")
    {
        settings.general.stock_mode = StockMode::All;
    }
    let wtb = &mut settings.items.wtb;
    set!("items.wtb.volume_threshold", wtb.volume_threshold, v.wtb_volume_threshold);
    set!("items.wtb.profit_threshold", wtb.profit_threshold, v.wtb_profit_threshold);
    set!("items.wtb.avg_price_cap", wtb.avg_price_cap, v.wtb_avg_price_cap);
    set!("items.wtb.max_total_price_cap", wtb.max_total_price_cap, v.wtb_max_total_price_cap);
    set!("items.wtb.buy_quantity", wtb.buy_quantity, v.wtb_buy_quantity);
    set!("items.wtb.max_stock_quantity", wtb.max_stock_quantity, v.wtb_max_stock_quantity);
    set!("items.wtb.outbid_step", wtb.outbid_step, v.wtb_outbid_step);
    set!("items.wtb.min_roi_percentage", wtb.min_roi_percentage, v.wtb_min_roi_percentage);
    let wts = &mut settings.items.wts;
    set!("items.wts.min_profit", wts.min_profit, v.wts_min_profit);
    if let Some(pct) = v.wts_min_profit_percentage {
        set!("items.wts.min_profit_percentage", wts.min_profit_percentage, pct);
    }
    set!("items.wts.undercut_step", wts.undercut_step, v.wts_undercut_step);
    set!("items.wts.stale_after_days", wts.stale_after_days, v.wts_stale_after_days);
    set!("items.wts.stale_decay_percentage", wts.stale_decay_percentage, v.wts_stale_decay_percentage);
    set!("items.wts.stale_floor_profit", wts.stale_floor_profit, v.wts_stale_floor_profit);
    let riven = &mut settings.rivens.wts;
    set!("rivens.wts.min_profit", riven.min_profit, v.riven_min_profit);
    set!("rivens.wts.auto_match_stats", riven.auto_match_stats, v.riven_auto_match_stats);
    set!("rivens.wts.min_comparables", riven.min_comparables, v.riven_min_comparables);
    set!("rivens.wts.undercut_step", riven.undercut_step, v.riven_undercut_step);
}

/// Saved settings overlaid by the preset only (smart trader off, or no signals yet).
pub fn preset_only(saved: &LiveScraperSettings) -> LiveScraperSettings {
    let mut settings = saved.clone();
    apply_preset(&mut settings, saved.void_trader.preset);
    settings
}

/// EFFECTIVE settings = saved, overlaid by the preset, adjusted by signals.
/// Pure: `saved` is never modified.
pub fn compute_effective(
    saved: &LiveScraperSettings,
    signals: &Signals,
    was_liquidating: bool,
) -> Outcome {
    let vt = &saved.void_trader;
    let active = vt.preset;
    if !vt.smart_enabled {
        return Outcome {
            settings: preset_only(saved),
            effective_preset: active,
            liquidating: false,
            adjustments: vec![],
        };
    }

    let mut adjustments = Vec::new();

    // Stuck capital: too much of the net worth is sitting in stock -> liquidate for now.
    let liquidating = active != TradingPreset::Liquidate && stuck_capital(signals, was_liquidating);
    let effective_preset = if liquidating { TradingPreset::Liquidate } else { active };
    if liquidating {
        let percent = signals.stock_value * 100 / signals.net_worth().max(1);
        adjustments.push(Adjustment::new(
            "preset",
            active.as_str(),
            TradingPreset::Liquidate.as_str(),
            format!(
                "Switched to Liquidate: {}% of your net worth ({}p) is stuck in unsold stock. Buying resumes below {}%",
                percent,
                signals.stock_value,
                (STUCK_EXIT * 100.0) as i64
            ),
        ));
    }

    let mut settings = saved.clone();
    apply_preset(&mut settings, effective_preset);

    // Plat balance: budget ceilings. They only ever lower a cap.
    if settings.has_trade_mode(TradeMode::Buy) && signals.balance_known() {
        let balance = signals.balance.max(0);
        if !vt.is_locked("items.wtb.avg_price_cap") {
            let current = settings.items.wtb.avg_price_cap;
            let capped = cap_to(current, single_buy_limit(balance));
            if capped != current {
                adjustments.push(Adjustment::new(
                    "items.wtb.avg_price_cap",
                    current,
                    capped,
                    format!(
                        "Lowered max buy price to {}p: no single buy above {}% of your {}p balance",
                        capped, MAX_SINGLE_BUY_PERCENT, balance
                    ),
                ));
                settings.items.wtb.avg_price_cap = capped;
            }
        }
        if !vt.is_locked("items.wtb.max_total_price_cap") {
            let current = settings.items.wtb.max_total_price_cap;
            let capped = cap_to(current, balance);
            if capped != current {
                adjustments.push(Adjustment::new(
                    "items.wtb.max_total_price_cap",
                    current,
                    capped,
                    format!(
                        "Lowered total buy orders to {}p: open buy orders cannot exceed your balance",
                        capped
                    ),
                ));
                settings.items.wtb.max_total_price_cap = capped;
            }
        }
    }

    // Trades left today: when they run short, each one has to earn more.
    if let Some(left) = signals.trades_remaining {
        if !vt.is_locked("items.wts.min_profit") {
            let current = settings.items.wts.min_profit;
            let raised = raise_min_profit(current, Some(left));
            if raised != current {
                adjustments.push(Adjustment::new(
                    "items.wts.min_profit",
                    current,
                    raised,
                    format!("Raised min profit to {}p: {} trades left today", raised, left),
                ));
                settings.items.wts.min_profit = raised;
            }
        }
        if !vt.is_locked("rivens.wts.min_profit") {
            let current = settings.rivens.wts.min_profit;
            let raised = raise_min_profit(current, Some(left));
            if raised != current {
                adjustments.push(Adjustment::new(
                    "rivens.wts.min_profit",
                    current,
                    raised,
                    format!("Raised riven min profit to {}p: {} trades left today", raised, left),
                ));
                settings.rivens.wts.min_profit = raised;
            }
        }
    }

    Outcome {
        settings,
        effective_preset,
        liquidating,
        adjustments,
    }
}

/// True when the strategy (not the user) turned buying off: open buy orders should come down.
pub fn buying_suspended(saved: &LiveScraperSettings, effective: &LiveScraperSettings) -> bool {
    saved.has_trade_mode(TradeMode::Buy) && !effective.has_trade_mode(TradeMode::Buy)
}

/* --------------------------- Per-item decisions --------------------------- */

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trend {
    Falling,
    Flat,
    Rising,
}

/// Price trend from the cached week shift (plat change of the average over the last week).
/// Only a clear move counts: at least 10% of the average price and at least 2p.
pub fn price_trend(week_price_shift: f64, avg_price: f64) -> Trend {
    if avg_price <= 0.0 || !week_price_shift.is_finite() {
        return Trend::Flat;
    }
    let ratio = week_price_shift / avg_price;
    if week_price_shift <= -TREND_MIN_PLAT && ratio <= -TREND_RATIO {
        Trend::Falling
    } else if week_price_shift >= TREND_MIN_PLAT && ratio >= TREND_RATIO {
        Trend::Rising
    } else {
        Trend::Flat
    }
}

/// The cached `week_price_shift` is never negative in real data (0 to 50 across 1,549 items),
/// so it is not a signed weekly price change and cannot say an item is falling. The trend
/// rules stay off until a signal with known meaning is available.
pub const TREND_SIGNAL_ENABLED: bool = false;

/// Trend for one item as the smart trader sees it (always flat when it is switched off).
pub fn item_trend(vt: &VoidTraderSettings, week_price_shift: f64, avg_price: f64) -> Trend {
    if vt.smart_enabled && TREND_SIGNAL_ENABLED {
        price_trend(week_price_shift, avg_price)
    } else {
        Trend::Flat
    }
}

/// Sell undercut for one item: falling price undercuts one extra plat, rising price just
/// matches the cheapest seller. A disabled (-1) or locked undercut is left alone.
pub fn undercut_for_trend(vt: &VoidTraderSettings, undercut_step: i64, trend: Trend) -> i64 {
    if !vt.smart_enabled || undercut_step < 0 || vt.is_locked("items.wts.undercut_step") {
        return undercut_step;
    }
    match trend {
        Trend::Falling => undercut_step + 1,
        Trend::Rising => 0,
        Trend::Flat => undercut_step,
    }
}

/// Competition: many sellers online compared with how often the item actually trades.
pub fn is_crowded(sell_orders: usize, daily_volume: f64) -> bool {
    sell_orders >= CROWDED_MIN_SELLERS
        && daily_volume > 0.0
        && sell_orders as f64 > daily_volume * CROWDED_DAYS_OF_VOLUME
}

/// Why this item should not be bought right now, if any reason applies.
pub fn skip_buy_reason(
    vt: &VoidTraderSettings,
    trend: Trend,
    sell_orders: usize,
    daily_volume: f64,
) -> Option<&'static str> {
    if !vt.smart_enabled {
        return None;
    }
    if trend == Trend::Falling {
        Some("FallingPrice")
    } else if is_crowded(sell_orders, daily_volume) {
        Some("CrowdedMarket")
    } else {
        None
    }
}

/* ------------------------------ Runtime state ------------------------------ */

#[derive(Default)]
struct SmartState {
    signals: Option<Signals>,
    liquidating: bool,
    /// Adjustments currently in force: field -> (value, time first seen).
    active: HashMap<String, (String, String)>,
    feed: VecDeque<Adjustment>,
}

static STATE: OnceLock<Mutex<SmartState>> = OnceLock::new();

fn state() -> std::sync::MutexGuard<'static, SmartState> {
    STATE
        .get_or_init(|| Mutex::new(SmartState::default()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

fn push_feed(feed: &mut VecDeque<Adjustment>, entry: Adjustment) {
    if feed.len() >= FEED_SIZE {
        feed.pop_front();
    }
    feed.push_back(entry);
}

/// Record the adjustments of one evaluation. Only changes reach the feed, so a rule that
/// stays in force for hours is logged once, plus once more when it ends.
fn record(
    active: &mut HashMap<String, (String, String)>,
    feed: &mut VecDeque<Adjustment>,
    current: &mut [Adjustment],
    scope: impl Fn(&str) -> bool,
    now: &str,
) {
    for adj in current.iter_mut() {
        match active.get(&adj.field) {
            Some((to, since)) if *to == adj.to => adj.time = since.clone(),
            _ => {
                adj.time = now.to_string();
                active.insert(adj.field.clone(), (adj.to.clone(), now.to_string()));
                push_feed(feed, adj.clone());
            }
        }
    }
    let ended: Vec<String> = active
        .keys()
        .filter(|k| scope(k) && !current.iter().any(|a| &a.field == *k))
        .cloned()
        .collect();
    for field in ended {
        if let Some((value, _)) = active.remove(&field) {
            push_feed(
                feed,
                Adjustment {
                    time: now.to_string(),
                    reason: format!("Back to the preset value for {}", plain_field(&field)),
                    field,
                    from: value,
                    to: "preset".to_string(),
                },
            );
        }
    }
}

fn plain_field(field: &str) -> String {
    match field {
        "preset" => "the trading preset".to_string(),
        "items.wtb.avg_price_cap" => "max buy price".to_string(),
        "items.wtb.max_total_price_cap" => "total buy orders".to_string(),
        "items.wts.min_profit" => "min profit".to_string(),
        "rivens.wts.min_profit" => "riven min profit".to_string(),
        other => other.to_string(),
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Record a per-item decision (trend / competition) in the feed. `decision` None clears it.
pub fn note_item_decision(kind: &str, wfm_url: &str, decision: Option<(String, String)>) {
    let key = format!("item:{}:{}", kind, wfm_url);
    let mut st = state();
    let st = &mut *st;
    match decision {
        Some((value, reason)) => {
            if st.active.get(&key).map(|(v, _)| v != &value).unwrap_or(true) {
                let time = now();
                st.active.insert(key.clone(), (value.clone(), time.clone()));
                push_feed(
                    &mut st.feed,
                    Adjustment {
                        time,
                        field: key,
                        from: String::new(),
                        to: value,
                        reason,
                    },
                );
            }
        }
        None => {
            st.active.remove(&key);
        }
    }
}

/// Read the account signals: inventory, stock and (when the inventory is not live) transactions.
pub async fn gather_signals() -> Result<Signals, Error> {
    let root = {
        let app = APP.get().expect("APP not initialized");
        let inventory = app.state::<Mutex<Arc<WFInventoryState>>>();
        let guard = inventory.lock()?;
        guard.get_root()
    };
    let conn = DATABASE.get().unwrap();

    let items = StockItemQuery::get_all(conn, StockItemPaginationQueryDto::new(1, -1)).await?;
    let rivens = StockRivenQuery::get_all(conn, StockRivenPaginationQueryDto::new(1, -1)).await?;
    let stock_value: i64 = items
        .results
        .iter()
        .map(|s| s.bought.max(0) * s.owned.max(0))
        .sum::<i64>()
        + rivens.results.iter().map(|r| r.bought.max(0)).sum::<i64>();

    let inventory_live = root.mastery_rank > 0 || root.platinum > 0;
    // Without live inventory data the balance is whatever the user typed in. Sales minus
    // purchases is NOT a balance (it ignores plat spent or earned outside the app), so it is
    // never used: an unset value means "unknown" and the balance rules are skipped.
    let _ = inventory_live;
    let tracked_balance = states::get_settings()?
        .live_scraper
        .void_trader
        .manual_platinum
        .unwrap_or(0)
        .max(0);
    let (balance, balance_is_live) =
        resolve_balance(root.platinum, root.mastery_rank, tracked_balance);

    Ok(Signals {
        balance,
        balance_is_live,
        stock_value,
        trades_remaining: inventory_live.then_some(root.trades_remaining),
    })
}

/// Everything the status command shows.
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub signals: Signals,
    pub outcome: Outcome,
    pub recent: Vec<Adjustment>,
}

/// Re-read the signals and re-evaluate. Called at the start of every live scraper cycle
/// (and by the status command); updates the liquidation latch and the adjustment feed.
pub async fn refresh() -> Result<Snapshot, Error> {
    let signals = gather_signals().await?;
    let saved = states::get_settings()?.live_scraper;
    let mut st = state();
    let st = &mut *st;
    let mut outcome = compute_effective(&saved, &signals, st.liquidating);
    st.liquidating = outcome.liquidating;
    st.signals = Some(signals.clone());
    record(
        &mut st.active,
        &mut st.feed,
        &mut outcome.adjustments,
        |field| !field.starts_with("item:"),
        &now(),
    );
    Ok(Snapshot {
        signals,
        outcome,
        recent: st.feed.iter().rev().cloned().collect(),
    })
}

/// The settings the live scraper trades on. Cheap and synchronous: it re-applies the pure
/// rules to the CURRENT saved settings using the signals read by the last `refresh()`, so a
/// settings change takes effect immediately. Never saves anything.
pub fn effective_settings() -> Result<LiveScraperSettings, Error> {
    let saved = states::get_settings()?.live_scraper;
    let st = state();
    Ok(match &st.signals {
        Some(signals) => compute_effective(&saved, signals, st.liquidating).settings,
        None => preset_only(&saved),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(preset: TradingPreset) -> LiveScraperSettings {
        let mut s = LiveScraperSettings::default();
        s.void_trader.preset = preset;
        s
    }

    /// Healthy account: nothing for the smart trader to do.
    fn calm(balance: i64) -> Signals {
        Signals {
            balance,
            balance_is_live: true,
            stock_value: 0,
            trades_remaining: Some(20),
        }
    }

    #[test]
    fn old_settings_files_load_with_defaults() {
        let mut json = serde_json::to_value(LiveScraperSettings::default()).unwrap();
        json.as_object_mut().unwrap().remove("void_trader");
        let loaded: LiveScraperSettings = serde_json::from_value(json).unwrap();
        assert_eq!(loaded.void_trader, VoidTraderSettings::default());
        assert_eq!(loaded.void_trader.preset, TradingPreset::Scavenger);
        assert!(loaded.void_trader.smart_enabled && loaded.void_trader.strict_tiers);

        let partial: VoidTraderSettings = serde_json::from_str(r#"{"preset":"high_roller"}"#).unwrap();
        assert_eq!(partial.preset, TradingPreset::HighRoller);
        assert!(partial.smart_enabled && partial.locked_fields.is_empty());
        assert_eq!(serde_json::to_string(&TradingPreset::RivenHunter).unwrap(), "\"riven_hunter\"");
    }

    #[test]
    fn preset_values_match_intent() {
        let s = preset_values(TradingPreset::Scavenger);
        assert_eq!((s.wtb_avg_price_cap, s.wtb_buy_quantity, s.wtb_volume_threshold), (15, 1, 40));
        assert_eq!(s.wts_undercut_step, 1);
        assert!(s.buy_enabled);

        let f = preset_values(TradingPreset::Flipper);
        assert_eq!((f.wtb_avg_price_cap, f.wtb_min_roi_percentage), (60, 15));
        assert_eq!((f.wts_min_profit, f.wts_stale_after_days), (10, 5));

        let h = preset_values(TradingPreset::HighRoller);
        assert_eq!((h.wtb_avg_price_cap, h.wts_min_profit, h.wts_stale_after_days), (400, 20, 10));

        let r = preset_values(TradingPreset::RivenHunter);
        assert!(r.include_rivens && r.riven_auto_match_stats);
        assert!(r.riven_min_profit > f.riven_min_profit);

        let l = preset_values(TradingPreset::Liquidate);
        assert!(!l.buy_enabled);
        assert_eq!((l.wts_undercut_step, l.wts_min_profit, l.wts_stale_floor_profit), (3, 0, 0));
    }

    #[test]
    fn preset_overlay_writes_real_fields() {
        let s = preset_only(&saved(TradingPreset::Flipper));
        assert_eq!(s.items.wtb.avg_price_cap, 60);
        assert_eq!(s.items.wtb.min_roi_percentage, 15);
        assert_eq!(s.items.wts.min_profit, 10);
        assert_eq!(s.items.wts.stale_after_days, 5);
        assert!(s.has_trade_mode(TradeMode::Buy));

        let mut items_only = saved(TradingPreset::RivenHunter);
        items_only.general.stock_mode = StockMode::Item;
        let s = preset_only(&items_only);
        assert_eq!(s.general.stock_mode, StockMode::All);
        assert_eq!(s.rivens.wts.min_profit, 60);
        assert!(s.rivens.wts.auto_match_stats);

        let s = preset_only(&saved(TradingPreset::Liquidate));
        assert!(!s.has_trade_mode(TradeMode::Buy));
        assert!(s.has_trade_mode(TradeMode::Sell) && s.has_trade_mode(TradeMode::WishList));
        assert_eq!(s.items.wts.undercut_step, 3);
        assert_eq!(s.items.wts.min_profit, 0);
        assert_eq!(s.items.wts.min_profit_percentage, -1);
        assert_eq!(s.items.wts.stale_floor_profit, 0);
    }

    #[test]
    fn saved_settings_are_never_modified() {
        let original = saved(TradingPreset::Liquidate);
        let before = serde_json::to_string(&original).unwrap();
        let signals = Signals { balance: 10, balance_is_live: true, stock_value: 500, trades_remaining: Some(1) };
        let _ = compute_effective(&original, &signals, false);
        let _ = preset_only(&original);
        assert_eq!(serde_json::to_string(&original).unwrap(), before);
    }

    #[test]
    fn tiers() {
        assert_eq!(tier_for(0), TradingPreset::Scavenger);
        assert_eq!(tier_for(299), TradingPreset::Scavenger);
        assert_eq!(tier_for(300), TradingPreset::Flipper);
        assert_eq!(tier_for(999), TradingPreset::Flipper);
        assert_eq!(tier_for(1_000), TradingPreset::RivenHunter);
        assert_eq!(tier_for(1_500), TradingPreset::HighRoller);

        assert_eq!(allowed_presets(299), vec![TradingPreset::Scavenger, TradingPreset::Liquidate]);
        assert_eq!(
            allowed_presets(300),
            vec![TradingPreset::Scavenger, TradingPreset::Flipper, TradingPreset::Liquidate]
        );
        assert!(allowed_presets(1_000).contains(&TradingPreset::RivenHunter));
        assert!(!allowed_presets(1_499).contains(&TradingPreset::HighRoller));
        assert_eq!(allowed_presets(1_500).len(), 5);
    }

    #[test]
    fn tier_gating() {
        assert!(validate_preset(TradingPreset::Scavenger, 0, true).is_ok());
        assert!(validate_preset(TradingPreset::Liquidate, 0, true).is_ok());
        let err = validate_preset(TradingPreset::Flipper, 299, true).unwrap_err();
        assert!(err.contains("300p") && err.contains("299p"), "{err}");
        assert!(validate_preset(TradingPreset::Flipper, 300, true).is_ok());
        assert!(validate_preset(TradingPreset::RivenHunter, 999, true).is_err());
        assert!(validate_preset(TradingPreset::RivenHunter, 1_000, true).is_ok());
        assert!(validate_preset(TradingPreset::HighRoller, 1_499, true).is_err());
        assert!(validate_preset(TradingPreset::HighRoller, 1_500, true).is_ok());
        // Strict tiers off: anything goes.
        assert!(validate_preset(TradingPreset::HighRoller, 0, false).is_ok());
    }

    #[test]
    fn balance_fallback() {
        assert_eq!(resolve_balance(76, 12, 999), (76, true));
        assert_eq!(resolve_balance(0, 12, 999), (0, true));
        assert_eq!(resolve_balance(0, 0, 140), (140, false));
        assert_eq!(resolve_balance(0, 0, -50), (0, false));
        let s = Signals { balance: 100, balance_is_live: false, stock_value: 250, trades_remaining: None };
        assert_eq!(s.net_worth(), 350);
    }

    #[test]
    fn calm_account_gets_the_plain_preset() {
        let out = compute_effective(&saved(TradingPreset::Flipper), &calm(1_000), false);
        assert!(out.adjustments.is_empty());
        assert_eq!(out.effective_preset, TradingPreset::Flipper);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 60);
        assert_eq!(out.settings.items.wtb.max_total_price_cap, 600);
        assert_eq!(out.settings.items.wts.min_profit, 10);
    }

    #[test]
    fn signal_plat_balance_caps_buys() {
        // 100p balance: single buy capped at 25p, open buy orders at 100p.
        let out = compute_effective(&saved(TradingPreset::Flipper), &calm(100), false);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 25);
        assert_eq!(out.settings.items.wtb.max_total_price_cap, 100);
        assert_eq!(out.adjustments.len(), 2);
        assert!(out.adjustments[0].reason.contains("25p"));

        // Caps never go up: scavenger at 76p keeps its 15p / 60p.
        let out = compute_effective(&saved(TradingPreset::Scavenger), &calm(76), false);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 15);
        assert_eq!(out.settings.items.wtb.max_total_price_cap, 60);
        assert!(out.adjustments.is_empty());

        // Empty wallet: nothing can be bought.
        let out = compute_effective(&saved(TradingPreset::Scavenger), &calm(0), false);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 0);
        assert_eq!(out.settings.items.wtb.max_total_price_cap, 0);

        // No inventory and no tracked trades: balance unknown, rule skipped.
        let unknown = Signals { balance: 0, balance_is_live: false, stock_value: 0, trades_remaining: None };
        let out = compute_effective(&saved(TradingPreset::Scavenger), &unknown, false);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 15);
        assert!(out.adjustments.is_empty());
    }

    #[test]
    fn signal_trades_remaining_raises_min_profit() {
        assert_eq!(trades_left_multiplier_pct(None), 100);
        assert_eq!(trades_left_multiplier_pct(Some(9)), 100);
        assert_eq!(trades_left_multiplier_pct(Some(8)), 150);
        assert_eq!(trades_left_multiplier_pct(Some(4)), 150);
        assert_eq!(trades_left_multiplier_pct(Some(3)), 200);
        assert_eq!(trades_left_multiplier_pct(Some(0)), 200);

        let mut signals = calm(1_000);
        signals.trades_remaining = Some(6);
        let out = compute_effective(&saved(TradingPreset::Flipper), &signals, false);
        assert_eq!(out.settings.items.wts.min_profit, 15);
        assert_eq!(out.settings.rivens.wts.min_profit, 38);
        assert_eq!(out.adjustments[0].reason, "Raised min profit to 15p: 6 trades left today");
        assert_eq!((out.adjustments[0].from.as_str(), out.adjustments[0].to.as_str()), ("10", "15"));

        signals.trades_remaining = Some(2);
        let out = compute_effective(&saved(TradingPreset::Flipper), &signals, false);
        assert_eq!(out.settings.items.wts.min_profit, 20);
        assert_eq!(out.settings.rivens.wts.min_profit, 50);

        // Unknown trades left: rule skipped.
        signals.trades_remaining = None;
        let out = compute_effective(&saved(TradingPreset::Flipper), &signals, false);
        assert_eq!(out.settings.items.wts.min_profit, 10);
        assert!(out.adjustments.is_empty());
    }

    #[test]
    fn signal_stuck_capital_switches_to_liquidate_with_hysteresis() {
        let at = |stock: i64, balance: i64| Signals {
            balance,
            balance_is_live: true,
            stock_value: stock,
            trades_remaining: Some(20),
        };
        // 60% exactly does not trigger; above it does.
        assert!(!stuck_capital(&at(600, 400), false));
        assert!(stuck_capital(&at(610, 390), false));
        // Once liquidating it holds until stock drops below 40%.
        assert!(stuck_capital(&at(500, 500), true));
        assert!(stuck_capital(&at(400, 600), true));
        assert!(!stuck_capital(&at(390, 610), true));
        // 50% without the latch is fine.
        assert!(!stuck_capital(&at(500, 500), false));
        // Unknown balance: rule skipped.
        let unknown = Signals { balance: 0, balance_is_live: false, stock_value: 500, trades_remaining: None };
        assert!(!stuck_capital(&unknown, false));

        let out = compute_effective(&saved(TradingPreset::Flipper), &at(700, 300), false);
        assert!(out.liquidating);
        assert_eq!(out.effective_preset, TradingPreset::Liquidate);
        assert!(!out.settings.has_trade_mode(TradeMode::Buy));
        assert_eq!(out.settings.items.wts.undercut_step, 3);
        assert_eq!(out.settings.items.wts.min_profit, 0);
        assert_eq!(out.adjustments[0].field, "preset");
        assert_eq!(out.adjustments[0].to, "liquidate");
        assert!(out.adjustments[0].reason.contains("70%"));
        // The saved preset is untouched.
        assert_eq!(out.settings.void_trader.preset, TradingPreset::Flipper);

        let out = compute_effective(&saved(TradingPreset::Flipper), &at(500, 500), true);
        assert_eq!(out.effective_preset, TradingPreset::Liquidate);
        let out = compute_effective(&saved(TradingPreset::Flipper), &at(390, 610), true);
        assert_eq!(out.effective_preset, TradingPreset::Flipper);
        assert!(!out.liquidating);
    }

    #[test]
    fn smart_disabled_is_preset_only() {
        let mut s = saved(TradingPreset::Flipper);
        s.void_trader.smart_enabled = false;
        let harsh = Signals { balance: 20, balance_is_live: true, stock_value: 900, trades_remaining: Some(1) };
        let out = compute_effective(&s, &harsh, true);
        assert!(out.adjustments.is_empty());
        assert!(!out.liquidating);
        assert_eq!(out.effective_preset, TradingPreset::Flipper);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 60);
        assert_eq!(out.settings.items.wts.min_profit, 10);
        assert!(out.settings.has_trade_mode(TradeMode::Buy));

        let vt = &s.void_trader;
        assert_eq!(item_trend(vt, -20.0, 50.0), Trend::Flat);
        assert_eq!(undercut_for_trend(vt, 1, Trend::Falling), 1);
        assert_eq!(skip_buy_reason(vt, Trend::Falling, 100, 1.0), None);
    }

    #[test]
    fn locked_fields_are_never_overridden() {
        let mut s = saved(TradingPreset::Flipper);
        s.items.wtb.avg_price_cap = 123;
        s.items.wts.min_profit = 7;
        s.items.wts.undercut_step = 2;
        s.void_trader.locked_fields = vec![
            "items.wtb.avg_price_cap".to_string(),
            "items.wts.min_profit".to_string(),
            "items.wts.undercut_step".to_string(),
            "general.trade_modes".to_string(),
        ];
        // Preset overlay skips them...
        let p = preset_only(&s);
        assert_eq!((p.items.wtb.avg_price_cap, p.items.wts.min_profit), (123, 7));
        assert_eq!(p.items.wtb.min_roi_percentage, 15);

        // ...and so does every signal rule, including the liquidate switch.
        let harsh = Signals { balance: 100, balance_is_live: true, stock_value: 900, trades_remaining: Some(1) };
        let out = compute_effective(&s, &harsh, false);
        assert_eq!(out.effective_preset, TradingPreset::Liquidate);
        assert_eq!(out.settings.items.wtb.avg_price_cap, 123);
        assert_eq!(out.settings.items.wts.min_profit, 7);
        assert_eq!(out.settings.items.wts.undercut_step, 2);
        assert!(out.settings.has_trade_mode(TradeMode::Buy));
        assert!(out.adjustments.iter().all(|a| a.field != "items.wtb.avg_price_cap"
            && a.field != "items.wts.min_profit"));
        // Unlocked fields still move.
        assert_eq!(out.settings.items.wts.stale_floor_profit, 0);

        assert_eq!(undercut_for_trend(&s.void_trader, 2, Trend::Falling), 2);
        assert_eq!(undercut_for_trend(&s.void_trader, 2, Trend::Rising), 2);
        for field in &s.void_trader.locked_fields {
            assert!(MANAGED_FIELDS.contains(&field.as_str()));
        }
    }

    #[test]
    fn bounds() {
        assert_eq!(bounded(10, 100), 20);
        assert_eq!(bounded(10, 1), 5);
        assert_eq!(bounded(10, 14), 14);
        assert_eq!(bounded(5, 0), 3);
        assert_eq!(bounded(0, 50), 0);
        assert_eq!(bounded(-1, 50), -1);

        // Raised profits stay within 0.5x..2x of the preset value for every preset and count.
        for preset in TradingPreset::ALL {
            let base = preset_values(preset);
            for left in 0..=30 {
                for b in [base.wts_min_profit, base.riven_min_profit] {
                    let raised = raise_min_profit(b, Some(left));
                    assert!(raised >= b && raised <= b * 2, "{preset:?} {left} {b} -> {raised}");
                }
            }
        }
        // A disabled (-1) or zero minimum is left alone.
        assert_eq!(raise_min_profit(-1, Some(1)), -1);
        assert_eq!(raise_min_profit(0, Some(1)), 0);

        // Budget ceilings only ever lower a cap; a disabled cap becomes the ceiling.
        assert_eq!(cap_to(60, 25), 25);
        assert_eq!(cap_to(15, 25), 15);
        assert_eq!(cap_to(-1, 25), 25);
        assert_eq!(single_buy_limit(100), 25);
        assert_eq!(single_buy_limit(-5), 0);
    }

    #[test]
    fn signal_price_trend() {
        assert_eq!(price_trend(-10.0, 50.0), Trend::Falling);
        assert_eq!(price_trend(10.0, 50.0), Trend::Rising);
        assert_eq!(price_trend(-4.0, 50.0), Trend::Flat); // under 10%
        assert_eq!(price_trend(-1.5, 10.0), Trend::Flat); // under 2p
        assert_eq!(price_trend(0.0, 50.0), Trend::Flat);
        assert_eq!(price_trend(-10.0, 0.0), Trend::Flat);
        assert_eq!(price_trend(f64::NAN, 50.0), Trend::Flat);

        let vt = VoidTraderSettings::default();
        assert_eq!(undercut_for_trend(&vt, 1, Trend::Falling), 2);
        assert_eq!(undercut_for_trend(&vt, 1, Trend::Rising), 0);
        assert_eq!(undercut_for_trend(&vt, 1, Trend::Flat), 1);
        assert_eq!(undercut_for_trend(&vt, -1, Trend::Falling), -1);
        assert_eq!(skip_buy_reason(&vt, Trend::Falling, 0, 50.0), Some("FallingPrice"));
        assert_eq!(skip_buy_reason(&vt, Trend::Rising, 0, 50.0), None);
    }

    #[test]
    fn signal_competition() {
        assert!(!is_crowded(9, 1.0)); // too few sellers to call it crowded
        assert!(is_crowded(30, 10.0));
        assert!(!is_crowded(20, 10.0));
        assert!(!is_crowded(30, 0.0)); // no volume data
        let vt = VoidTraderSettings::default();
        assert_eq!(skip_buy_reason(&vt, Trend::Flat, 30, 10.0), Some("CrowdedMarket"));
        assert_eq!(skip_buy_reason(&vt, Trend::Flat, 30, 40.0), None);
    }

    #[test]
    fn buying_suspended_only_when_the_strategy_turned_it_off() {
        let s = saved(TradingPreset::Liquidate);
        assert!(buying_suspended(&s, &preset_only(&s)));
        let f = saved(TradingPreset::Flipper);
        assert!(!buying_suspended(&f, &preset_only(&f)));
        let mut user_off = saved(TradingPreset::Liquidate);
        user_off.general.trade_modes = vec![TradeMode::Sell];
        assert!(!buying_suspended(&user_off, &preset_only(&user_off)));
    }

    #[test]
    fn feed_records_changes_once_and_keeps_the_last_100() {
        let mut active = HashMap::new();
        let mut feed = VecDeque::new();
        let global = |f: &str| !f.starts_with("item:");
        let adj = |to: i64| Adjustment::new("items.wts.min_profit", 10, to, format!("to {to}"));

        let mut current = vec![adj(15)];
        record(&mut active, &mut feed, &mut current, global, "t1");
        assert_eq!(feed.len(), 1);
        assert_eq!(current[0].time, "t1");
        // Same adjustment next cycle: not logged again, keeps its first time.
        let mut current = vec![adj(15)];
        record(&mut active, &mut feed, &mut current, global, "t2");
        assert_eq!(feed.len(), 1);
        assert_eq!(current[0].time, "t1");
        // Value changes: logged.
        let mut current = vec![adj(20)];
        record(&mut active, &mut feed, &mut current, global, "t3");
        assert_eq!(feed.len(), 2);
        // Rule ends: one "back to preset" entry; per-item keys are not touched.
        active.insert("item:trend:x".to_string(), ("falling".to_string(), "t0".to_string()));
        record(&mut active, &mut feed, &mut [], global, "t4");
        assert_eq!(feed.len(), 3);
        assert_eq!(feed.back().unwrap().to, "preset");
        assert!(active.contains_key("item:trend:x"));
        assert!(!active.contains_key("items.wts.min_profit"));

        for i in 0..250 {
            push_feed(&mut feed, adj(i));
        }
        assert_eq!(feed.len(), FEED_SIZE);
        assert_eq!(feed.back().unwrap().to, "249");
    }
}
