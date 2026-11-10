use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemWtsSettings {
    pub min_sma: i64,
    pub min_profit: i64,
    pub min_profit_percentage: i64,
    pub max_price_drop: i64,
    pub min_listings_below: i64,
    /// Void Trader: plat to undercut the cheapest competitor by (0 = match them).
    #[serde(default = "vt_wts_undercut")]
    pub undercut_step: i64,
    /// Void Trader: days in stock before the minimum profit starts decaying (-1 = never).
    #[serde(default = "vt_wts_stale_days")]
    pub stale_after_days: i64,
    /// Void Trader: percent of the minimum profit removed per day once stale.
    #[serde(default = "vt_wts_stale_decay")]
    pub stale_decay_percentage: i64,
    /// Void Trader: lowest profit a stale item may be sold at (can be negative for a stop-loss).
    #[serde(default = "vt_wts_stale_floor")]
    pub stale_floor_profit: i64,
}

impl Default for ItemWtsSettings {
    fn default() -> Self {
        Self {
            min_sma: 3,
            min_profit: 10,
            min_profit_percentage: -1,
            max_price_drop: -1,
            min_listings_below: -1,
            undercut_step: vt_wts_undercut(),
            stale_after_days: vt_wts_stale_days(),
            stale_decay_percentage: vt_wts_stale_decay(),
            stale_floor_profit: vt_wts_stale_floor(),
        }
    }
}

fn vt_wts_undercut() -> i64 { 1 }
fn vt_wts_stale_days() -> i64 { 5 }
fn vt_wts_stale_decay() -> i64 { 20 }
fn vt_wts_stale_floor() -> i64 { 2 }
