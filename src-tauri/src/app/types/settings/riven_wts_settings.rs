use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RivenWtsSettings {
    pub min_profit: i64,
    pub threshold_percentage: f64,
    pub max_results: i64,
    /// Use the riven price prediction model instead of the live auction average.
    pub use_predict: bool,
    /// Void Trader: when no manual filter is set, compare against rivens sharing this riven's positive stats.
    #[serde(default = "vt_true")]
    pub auto_match_stats: bool,
    /// Void Trader: comparable auctions needed before trusting a stat-matched price.
    #[serde(default = "vt_riven_min_comparables")]
    pub min_comparables: i64,
    /// Void Trader: plat to undercut the cheapest comparable riven by.
    #[serde(default = "vt_riven_undercut")]
    pub undercut_step: i64,
}

impl Default for RivenWtsSettings {
    fn default() -> Self {
        Self {
            min_profit: 25,
            threshold_percentage: 15.0,
            max_results: 5,
            use_predict: false,
            auto_match_stats: vt_true(),
            min_comparables: vt_riven_min_comparables(),
            undercut_step: vt_riven_undercut(),
        }
    }
}

fn vt_true() -> bool { true }
fn vt_riven_min_comparables() -> i64 { 3 }
fn vt_riven_undercut() -> i64 { 1 }
