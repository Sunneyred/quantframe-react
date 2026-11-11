//! Void Trader: trading strategy commands (presets + smart trader).

use std::sync::Mutex;

use serde::Serialize;
use utils::{get_location, Error};

use crate::{
    app::{AppState, LiveScraperSettings, TradingPreset},
    enums::TradeMode,
    live_scraper::void_smart_trader::{self as smart, Adjustment, PresetValues, Snapshot},
};

const COMPONENT: &str = "VoidStrategy";

#[derive(Clone, Debug, Serialize)]
pub struct PresetInfo {
    pub id: TradingPreset,
    pub name: String,
    pub description: String,
    /// Net worth needed to select it (0 = always available).
    pub min_net_worth: i64,
    /// False when strict tiers block it at the current net worth.
    pub allowed: bool,
    pub values: PresetValues,
}

/// The values the live scraper is trading on right now.
#[derive(Clone, Debug, Serialize)]
pub struct EffectiveValues {
    pub buy_enabled: bool,
    pub max_buy_price: i64,
    pub max_total_buy: i64,
    pub buy_quantity: i64,
    pub volume_threshold: i64,
    pub buy_profit_threshold: i64,
    pub min_roi_percentage: i64,
    pub sell_min_profit: i64,
    pub sell_undercut: i64,
    pub stale_after_days: i64,
    pub stale_floor_profit: i64,
    pub riven_min_profit: i64,
    pub riven_auto_match_stats: bool,
    pub riven_undercut: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct StrategyStatus {
    /// Preset the user picked.
    pub preset: TradingPreset,
    /// Preset in force (differs when the smart trader switched to liquidate).
    pub effective_preset: TradingPreset,
    /// Highest tier reached at the current net worth.
    pub tier: TradingPreset,
    pub net_worth: i64,
    pub platinum: i64,
    /// False when the balance is worked out from tracked trades (no inventory data).
    pub balance_is_live: bool,
    pub stock_value: i64,
    pub trades_remaining: Option<i64>,
    pub allowed_presets: Vec<TradingPreset>,
    pub presets: Vec<PresetInfo>,
    pub smart_enabled: bool,
    pub strict_tiers: bool,
    pub locked_fields: Vec<String>,
    /// Setting paths that can be put in `locked_fields`.
    pub lockable_fields: Vec<String>,
    pub effective: EffectiveValues,
    /// Smart adjustments in force right now.
    pub active_adjustments: Vec<Adjustment>,
    /// Feed of the last 100 adjustments, newest first.
    pub recent_adjustments: Vec<Adjustment>,
}

fn describe(preset: TradingPreset) -> &'static str {
    match preset {
        TradingPreset::Scavenger => {
            "Almost no buying: one cheap, fast-selling item at a time. Sells with a 1p undercut."
        }
        TradingPreset::Flipper => {
            "Quick flips up to 60p with at least 15% return. Stock that sits 5 days gets cheaper."
        }
        TradingPreset::HighRoller => {
            "Items up to 400p, at least 20p profit, and holds its price for 10 days."
        }
        TradingPreset::RivenHunter => {
            "Rivens first: higher riven profit with stat matching, small item buys on the side."
        }
        TradingPreset::Liquidate => {
            "No buying. Sells everything with a 3p undercut, break-even allowed."
        }
    }
}

fn effective_values(settings: &LiveScraperSettings) -> EffectiveValues {
    EffectiveValues {
        buy_enabled: settings.has_trade_mode(TradeMode::Buy),
        max_buy_price: settings.items.wtb.avg_price_cap,
        max_total_buy: settings.items.wtb.max_total_price_cap,
        buy_quantity: settings.items.wtb.buy_quantity,
        volume_threshold: settings.items.wtb.volume_threshold,
        buy_profit_threshold: settings.items.wtb.profit_threshold,
        min_roi_percentage: settings.items.wtb.min_roi_percentage,
        sell_min_profit: settings.items.wts.min_profit,
        sell_undercut: settings.items.wts.undercut_step,
        stale_after_days: settings.items.wts.stale_after_days,
        stale_floor_profit: settings.items.wts.stale_floor_profit,
        riven_min_profit: settings.rivens.wts.min_profit,
        riven_auto_match_stats: settings.rivens.wts.auto_match_stats,
        riven_undercut: settings.rivens.wts.undercut_step,
    }
}

fn build_status(snapshot: Snapshot) -> StrategyStatus {
    let Snapshot {
        signals,
        outcome,
        recent,
    } = snapshot;
    let vt = &outcome.settings.void_trader;
    let net_worth = signals.net_worth();
    let presets = TradingPreset::ALL
        .iter()
        .map(|p| PresetInfo {
            id: *p,
            name: p.label().to_string(),
            description: describe(*p).to_string(),
            min_net_worth: smart::required_net_worth(*p),
            allowed: smart::validate_preset(*p, net_worth, vt.strict_tiers).is_ok(),
            values: smart::preset_values(*p),
        })
        .collect::<Vec<_>>();
    StrategyStatus {
        preset: vt.preset,
        effective_preset: outcome.effective_preset,
        tier: smart::tier_for(net_worth),
        net_worth,
        platinum: signals.balance,
        balance_is_live: signals.balance_is_live,
        stock_value: signals.stock_value,
        trades_remaining: signals.trades_remaining,
        allowed_presets: if vt.strict_tiers {
            smart::allowed_presets(net_worth)
        } else {
            TradingPreset::ALL.to_vec()
        },
        presets,
        smart_enabled: vt.smart_enabled,
        strict_tiers: vt.strict_tiers,
        locked_fields: vt.locked_fields.clone(),
        lockable_fields: smart::MANAGED_FIELDS.iter().map(|f| f.to_string()).collect(),
        effective: effective_values(&outcome.settings),
        active_adjustments: outcome.adjustments,
        recent_adjustments: recent,
    }
}

#[tauri::command]
pub async fn vt_strategy_status() -> Result<StrategyStatus, Error> {
    Ok(build_status(smart::refresh().await?))
}

#[tauri::command]
pub async fn vt_strategy_set(
    preset: Option<TradingPreset>,
    smart_enabled: Option<bool>,
    strict_tiers: Option<bool>,
    locked_fields: Option<Vec<String>>,
    app: tauri::State<'_, Mutex<AppState>>,
) -> Result<StrategyStatus, Error> {
    // Net worth first (async), so the settings lock is never held across an await.
    let net_worth = smart::gather_signals().await?.net_worth();
    {
        let mut app = app.lock()?;
        let mut settings = app.settings.clone();
        let vt = &mut settings.live_scraper.void_trader;
        if let Some(preset) = preset {
            vt.preset = preset;
        }
        if let Some(smart_enabled) = smart_enabled {
            vt.smart_enabled = smart_enabled;
        }
        if let Some(strict_tiers) = strict_tiers {
            vt.strict_tiers = strict_tiers;
        }
        if let Some(locked_fields) = locked_fields {
            if let Some(unknown) = locked_fields
                .iter()
                .find(|f| !smart::MANAGED_FIELDS.contains(&f.as_str()))
            {
                return Err(Error::new(
                    COMPONENT,
                    format!("Unknown setting to lock: {}", unknown),
                    get_location!(),
                ));
            }
            vt.locked_fields = locked_fields;
        }
        // Tier gate: checked whenever the preset or the strict switch is part of the request.
        if preset.is_some() || strict_tiers.is_some() {
            smart::validate_preset(vt.preset, net_worth, vt.strict_tiers)
                .map_err(|message| Error::new(COMPONENT, message, get_location!()))?;
        }
        app.update_settings(settings)?;
    }
    Ok(build_status(smart::refresh().await?))
}
