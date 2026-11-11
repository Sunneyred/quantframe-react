use serde::{Deserialize, Serialize};

/// Void Trader: a named bundle of buy/sell values for the auto-trader.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TradingPreset {
    /// Under 300p: almost no buying, sell what you have.
    Scavenger,
    /// 300p to 1,500p: cheap, fast flips.
    Flipper,
    /// 1,500p+: expensive items, patient pricing.
    HighRoller,
    /// 1,000p+: rivens first.
    RivenHunter,
    /// Stop buying and turn stock back into plat.
    Liquidate,
}

impl TradingPreset {
    pub const ALL: [TradingPreset; 5] = [
        TradingPreset::Scavenger,
        TradingPreset::Flipper,
        TradingPreset::HighRoller,
        TradingPreset::RivenHunter,
        TradingPreset::Liquidate,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            TradingPreset::Scavenger => "scavenger",
            TradingPreset::Flipper => "flipper",
            TradingPreset::HighRoller => "high_roller",
            TradingPreset::RivenHunter => "riven_hunter",
            TradingPreset::Liquidate => "liquidate",
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            TradingPreset::Scavenger => "Scavenger",
            TradingPreset::Flipper => "Flipper",
            TradingPreset::HighRoller => "High Roller",
            TradingPreset::RivenHunter => "Riven Hunter",
            TradingPreset::Liquidate => "Liquidate",
        }
    }
}

/// Void Trader: strategy block of the live scraper settings.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VoidTraderSettings {
    #[serde(default = "vt_default_preset")]
    pub preset: TradingPreset,
    /// Let the smart trader adjust the preset values from live signals.
    #[serde(default = "vt_default_true")]
    pub smart_enabled: bool,
    /// Refuse presets above the net worth tier.
    #[serde(default = "vt_default_true")]
    pub strict_tiers: bool,
    /// Setting paths (e.g. `items.wts.min_profit`) that presets and the smart trader never touch.
    #[serde(default)]
    pub locked_fields: Vec<String>,
}

impl VoidTraderSettings {
    pub fn is_locked(&self, field: &str) -> bool {
        self.locked_fields.iter().any(|f| f == field)
    }
}

impl Default for VoidTraderSettings {
    fn default() -> Self {
        Self {
            preset: vt_default_preset(),
            smart_enabled: true,
            strict_tiers: true,
            locked_fields: Vec::new(),
        }
    }
}

fn vt_default_preset() -> TradingPreset {
    TradingPreset::Scavenger
}
fn vt_default_true() -> bool {
    true
}
