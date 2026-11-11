//! Void Trader: sell finder + plat goal.
//!
//! Reads the Warframe inventory (via the AlecaFrame data file the app already supports),
//! matches every tradable item you own against cached market prices, and ranks what is
//! worth listing. Also computes the plat goal shown on the vault.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::Utc;
use entity::{
    stock_item::StockItemPaginationQueryDto, transaction::TransactionPaginationQueryDto,
};
use serde::{Deserialize, Serialize};
use service::{StockItemQuery, TransactionQuery};
use utils::{Error, SubType};

use crate::{
    utils::modules::states,
    wf_inventory::{WFInvItemRaw, WFInventoryState},
    DATABASE,
};

/// How the unit price was worked out.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PriceBasis {
    /// Market price for exactly this item.
    Exact,
    /// Market price is for the max-rank version; an unranked copy sells for less.
    MaxRank,
    /// Arcane: max-rank price divided by the copies needed to build one.
    ArcaneEstimate,
}

#[derive(Clone, Debug, Serialize)]
pub struct SellCandidate {
    pub name: String,
    pub wfm_url: String,
    pub unique_name: String,
    pub icon: String,
    pub category: String,
    pub quantity: i64,
    pub unit_price: i64,
    pub total: i64,
    /// Average trades per day on warframe.market.
    pub volume: f64,
    pub week_price_shift: f64,
    pub basis: PriceBasis,
    /// Sub type to list with (rank 0 for mods and arcanes, intact for relics).
    pub sub_type: Option<SubType>,
    pub in_stock: bool,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct SellFinderResult {
    pub connected: bool,
    pub platinum: i64,
    pub trades_remaining: i64,
    pub mastery_rank: i64,
    pub owned_tradable: usize,
    /// Tradable items owned that have no recent market data (not counted in totals).
    pub unpriced: usize,
    /// Sum of `total` for exact and arcane-estimate rows.
    pub total_value: i64,
    pub items: Vec<SellCandidate>,
}

/// Copies of an arcane needed to reach `rank` (rank 5 needs 21).
pub fn arcane_copies_for_rank(rank: i64) -> i64 {
    let r = rank.max(0);
    (r + 1) * (r + 2) / 2
}

pub fn category_of(tags: &[String]) -> &'static str {
    let has = |t: &str| tags.iter().any(|x| x == t);
    if has("arcane_enhancement") {
        "arcane"
    } else if has("mod") {
        "mod"
    } else if has("relic") {
        "relic"
    } else if has("set") {
        "set"
    } else if has("prime") {
        "prime"
    } else {
        "other"
    }
}

/// Work out the unit price and listing sub type for one owned item.
pub fn price_item(
    category: &str,
    market_price: f64,
    market_sub_type: &Option<SubType>,
) -> (i64, PriceBasis, Option<SubType>) {
    let market_rank = market_sub_type.as_ref().and_then(|s| s.rank).unwrap_or(0);
    match category {
        "arcane" if market_rank > 0 => (
            (market_price / arcane_copies_for_rank(market_rank) as f64).floor() as i64,
            PriceBasis::ArcaneEstimate,
            Some(SubType::rank(0)),
        ),
        "mod" if market_rank > 0 => (
            market_price.round() as i64,
            PriceBasis::MaxRank,
            Some(SubType::rank(0)),
        ),
        "mod" | "arcane" => (
            market_price.round() as i64,
            PriceBasis::Exact,
            Some(SubType::rank(0)),
        ),
        _ => (
            market_price.round() as i64,
            PriceBasis::Exact,
            market_sub_type.clone(),
        ),
    }
}

fn merge_owned(lists: &[&Vec<WFInvItemRaw>]) -> HashMap<String, i64> {
    let mut owned: HashMap<String, i64> = HashMap::new();
    for list in lists {
        for item in list.iter() {
            if item.unique_name.is_empty() || item.is_riven() {
                continue;
            }
            *owned.entry(item.unique_name.clone()).or_insert(0) += item.quantity.max(1);
        }
    }
    owned
}

#[tauri::command]
pub async fn vt_sell_finder(
    min_price: Option<i64>,
    wf_inventory: tauri::State<'_, Mutex<Arc<WFInventoryState>>>,
) -> Result<SellFinderResult, Error> {
    let min_price = min_price.unwrap_or(5);
    let root = wf_inventory.lock()?.clone().get_root();
    let cache = states::cache_client()?;
    let conn = DATABASE.get().unwrap();

    let stock = StockItemQuery::get_all(conn, StockItemPaginationQueryDto::new(1, -1)).await?;
    let stocked: Vec<String> = stock.results.iter().map(|s| s.wfm_url.clone()).collect();

    let owned = merge_owned(&[&root.misc_items, &root.recipes, &root.raw_upgrades]);
    let connected = root.mastery_rank > 0 || root.platinum > 0 || !owned.is_empty();

    let mut result = SellFinderResult {
        connected,
        platinum: root.platinum,
        trades_remaining: root.trades_remaining,
        mastery_rank: root.mastery_rank,
        ..Default::default()
    };

    let prices = cache.item_price().get_items()?;
    for (unique_name, quantity) in owned {
        let Ok(tradable) = cache.tradable_item().get_by(&unique_name) else {
            continue;
        };
        result.owned_tradable += 1;
        let category = category_of(&tradable.tags);

        // Prefer the intact relic row; otherwise the first row for this item.
        let mut rows = prices.iter().filter(|p| p.wfm_url == tradable.wfm_url);
        let row = if category == "relic" {
            prices
                .iter()
                .find(|p| {
                    p.wfm_url == tradable.wfm_url
                        && p.sub_type.as_ref().and_then(|s| s.variant.as_deref()) == Some("intact")
                })
                .or_else(|| rows.next())
        } else {
            rows.next()
        };
        let Some(row) = row else {
            result.unpriced += 1;
            continue;
        };

        let market_price = if row.median > 0.0 { row.median } else { row.avg_price };
        let (unit_price, basis, sub_type) = price_item(category, market_price, &row.sub_type);
        if unit_price < min_price {
            continue;
        }
        let total = unit_price * quantity;
        if basis != PriceBasis::MaxRank {
            result.total_value += total;
        }
        result.items.push(SellCandidate {
            name: tradable.name.clone(),
            wfm_url: tradable.wfm_url.clone(),
            unique_name,
            icon: tradable.icon.clone(),
            category: category.to_string(),
            quantity,
            unit_price,
            total,
            volume: (row.volume * 10.0).round() / 10.0,
            week_price_shift: row.week_price_shift,
            basis,
            sub_type,
            in_stock: stocked.contains(&tradable.wfm_url),
        });
    }
    result.items.sort_by(|a, b| b.total.cmp(&a.total).then(a.name.cmp(&b.name)));
    Ok(result)
}

/* ------------------------------ Plat goal ------------------------------ */

const GOAL_LADDER: [i64; 14] = [
    150, 300, 600, 1_200, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
    750_000, 1_000_000,
];

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PlatGoal {
    pub platinum: i64,
    /// Goal rung you already passed (the bottom of the tank).
    pub floor: i64,
    pub goal: i64,
    /// 0.0 to 1.0 between floor and goal.
    pub progress: f64,
    pub daily_target: i64,
    pub avg_daily_profit: f64,
    pub profit_today: i64,
    /// False when the balance comes from tracked profit only (no inventory data).
    pub balance_is_live: bool,
    /// False when there is no inventory data and no typed-in balance.
    pub balance_known: bool,
}

/// Pick the goal: the first ladder rung that is at least ~3 days of profit away.
pub fn pick_goal(platinum: i64, avg_daily_profit: f64) -> (i64, i64) {
    let reach = platinum + (avg_daily_profit.max(0.0) * 3.0) as i64;
    let goal = GOAL_LADDER
        .iter()
        .copied()
        .find(|g| *g > platinum && *g >= reach)
        .unwrap_or_else(|| ((platinum / 1_000_000) + 1) * 1_000_000);
    let floor = GOAL_LADDER
        .iter()
        .copied()
        .filter(|g| *g <= platinum)
        .max()
        .unwrap_or(0);
    (floor, goal)
}

pub fn daily_target(platinum: i64, goal: i64, avg_daily_profit: f64) -> i64 {
    let stretch = (avg_daily_profit.max(0.0) * 1.25).ceil() as i64;
    let pace = ((goal - platinum).max(0) as f64 / 4.0).ceil() as i64;
    stretch.max(pace.min(stretch.max(10) * 3)).max(10)
}

#[tauri::command]
pub async fn vt_plat_goal(
    wf_inventory: tauri::State<'_, Mutex<Arc<WFInventoryState>>>,
) -> Result<PlatGoal, Error> {
    let root = wf_inventory.lock()?.clone().get_root();
    let conn = DATABASE.get().unwrap();
    let transactions =
        TransactionQuery::get_all(conn, TransactionPaginationQueryDto::new(1, -1)).await?;

    let now = Utc::now();
    let week_ago = now - chrono::Duration::days(7);
    let today = now.date_naive();
    let mut week_profit = 0i64;
    let mut profit_today = 0i64;
    for t in transactions.results.iter() {
        let profit = t.profit.unwrap_or(0);
        if t.created_at >= week_ago {
            week_profit += profit;
        }
        if t.created_at.date_naive() == today {
            profit_today += profit;
        }
    }
    let avg_daily_profit = week_profit as f64 / 7.0;
    let balance_is_live = root.mastery_rank > 0 || root.platinum > 0;
    let manual = states::get_settings()?.live_scraper.void_trader.manual_platinum;
    let platinum = if balance_is_live { root.platinum } else { manual.unwrap_or(0).max(0) };
    let (floor, goal) = pick_goal(platinum, avg_daily_profit);
    let progress = if goal > floor {
        ((platinum - floor) as f64 / (goal - floor) as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };
    Ok(PlatGoal {
        platinum,
        floor,
        goal,
        progress,
        daily_target: daily_target(platinum, goal, avg_daily_profit),
        avg_daily_profit: (avg_daily_profit * 10.0).round() / 10.0,
        profit_today,
        balance_is_live,
        balance_known: balance_is_live || manual.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arcane_copies() {
        assert_eq!(arcane_copies_for_rank(0), 1);
        assert_eq!(arcane_copies_for_rank(3), 10);
        assert_eq!(arcane_copies_for_rank(5), 21);
    }

    #[test]
    fn pricing() {
        // Arcane Fury r5 at 140p -> ~6p per unranked copy.
        let (p, b, s) = price_item("arcane", 140.0, &Some(SubType::rank(5)));
        assert_eq!((p, b, s), (6, PriceBasis::ArcaneEstimate, Some(SubType::rank(0))));
        let (p, b, _) = price_item("mod", 39.4, &Some(SubType::rank(3)));
        assert_eq!((p, b), (39, PriceBasis::MaxRank));
        let (p, b, s) = price_item("prime", 8.9, &None);
        assert_eq!((p, b, s), (9, PriceBasis::Exact, None));
    }

    #[test]
    fn categories() {
        let t = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(category_of(&t(&["rare", "arcane_enhancement"])), "arcane");
        assert_eq!(category_of(&t(&["mod", "rare"])), "mod");
        assert_eq!(category_of(&t(&["set", "prime"])), "set");
        assert_eq!(category_of(&t(&["component", "prime"])), "prime");
    }

    #[test]
    fn goals() {
        assert_eq!(pick_goal(76, 0.0), (0, 150));
        assert_eq!(pick_goal(150, 0.0), (150, 300));
        // Earning 100p/day from 76p: 150 is under 3 days away, so aim at 600.
        assert_eq!(pick_goal(76, 100.0), (0, 600));
        assert_eq!(pick_goal(1_200_000, 0.0), (1_000_000, 2_000_000));
    }

    #[test]
    fn daily() {
        assert_eq!(daily_target(76, 150, 0.0), 19);
        assert_eq!(daily_target(140, 150, 0.0), 10);
        assert_eq!(daily_target(76, 600, 100.0), 131);
    }
}
