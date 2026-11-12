import { TauriClient } from "..";
import { TauriTypes } from "$types";
export class LiveScraperModule {
  constructor(private readonly client: TauriClient) {}

  async toggle(): Promise<void> {
    // awaited, so a refusal reaches the caller's error handling instead of the global
    // unhandled-rejection logger
    await this.client.sendInvoke("live_scraper_toggle");
  }
  async get_interesting_wtb_items(settings: TauriTypes.ItemSettings): Promise<TauriTypes.ItemPriceInfo[]> {
    return await this.client.sendInvoke("live_scraper_get_interesting_wtb_items", { settings });
  }
  async get_state(): Promise<{ is_running: boolean }> {
    return await this.client.sendInvoke("live_scraper_get_state");
  }
  // Void Trader
  async strategyStatus(): Promise<StrategyStatus> {
    return await this.client.sendInvoke<StrategyStatus>("vt_strategy_status");
  }
  async strategySet(input: StrategySetInput): Promise<StrategyStatus> {
    return await this.client.sendInvoke<StrategyStatus>("vt_strategy_set", input);
  }
}

export type TradingPreset = TauriTypes.TradingPreset;

export interface StrategySetInput {
  preset?: TradingPreset;
  smart_enabled?: boolean;
  strict_tiers?: boolean;
  locked_fields?: string[];
  /** Plat balance typed in by the user; a negative value clears it. */
  manual_platinum?: number;
}
export interface StrategyAdjustment {
  /** RFC 3339 time the adjustment was first seen. */
  time: string;
  field: string;
  from: string;
  to: string;
  /** Plain English, ready to show. */
  reason: string;
}
export interface StrategyPresetValues {
  buy_enabled: boolean;
  include_rivens: boolean;
  wtb_volume_threshold: number;
  wtb_profit_threshold: number;
  wtb_avg_price_cap: number;
  wtb_max_total_price_cap: number;
  wtb_buy_quantity: number;
  wtb_max_stock_quantity: number;
  wtb_outbid_step: number;
  wtb_min_roi_percentage: number;
  wts_min_profit: number;
  wts_min_profit_percentage?: number | null;
  wts_undercut_step: number;
  wts_stale_after_days: number;
  wts_stale_decay_percentage: number;
  wts_stale_floor_profit: number;
  riven_min_profit: number;
  riven_auto_match_stats: boolean;
  riven_min_comparables: number;
  riven_undercut_step: number;
}
export interface StrategyPresetInfo {
  id: TradingPreset;
  name: string;
  description: string;
  min_net_worth: number;
  allowed: boolean;
  values: StrategyPresetValues;
}
export interface StrategyEffectiveValues {
  buy_enabled: boolean;
  max_buy_price: number;
  max_total_buy: number;
  buy_quantity: number;
  volume_threshold: number;
  buy_profit_threshold: number;
  min_roi_percentage: number;
  sell_min_profit: number;
  sell_undercut: number;
  stale_after_days: number;
  stale_floor_profit: number;
  riven_min_profit: number;
  riven_auto_match_stats: boolean;
  riven_undercut: number;
}
export interface StrategyStatus {
  preset: TradingPreset;
  effective_preset: TradingPreset;
  tier: TradingPreset;
  net_worth: number;
  platinum: number;
  balance_is_live: boolean;
  stock_value: number;
  trades_remaining?: number | null;
  allowed_presets: TradingPreset[];
  presets: StrategyPresetInfo[];
  smart_enabled: boolean;
  strict_tiers: boolean;
  locked_fields: string[];
  lockable_fields: string[];
  effective: StrategyEffectiveValues;
  active_adjustments: StrategyAdjustment[];
  recent_adjustments: StrategyAdjustment[];
}
