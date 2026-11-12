import { TauriClient } from "..";
import { QuantframeApiTypes } from "../../types";
type ResponseType = { labels: string[]; registered_users_chart: number[]; total_users_chart: number[] };
export class MarketModule {
  constructor(private readonly client: TauriClient) {}

  async get_user_activity(query: QuantframeApiTypes.WfmControllerGetUserActiveHistoryParams): Promise<ResponseType> {
    const items = await this.client.sendInvoke<ResponseType>("get_user_activity", { query });
    return items;
  }

  // Void Trader: the Market Observatory (src-tauri/src/commands/void_market.rs)
  /** Live order book of one item (cached ~40 s per item by the backend; `force` still serves a book younger than 10 s). */
  async orderBook(wfm_url: string, variant?: string, force?: boolean): Promise<OrderBook> {
    return await this.client.sendInvoke<OrderBook>("vt_order_book", { wfmUrl: wfm_url, variant, force });
  }
  async priceHistory(wfm_url: string, variant?: string, riven?: boolean): Promise<PriceHistory> {
    return await this.client.sendInvoke<PriceHistory>("vt_price_history", { wfmUrl: wfm_url, variant, riven });
  }
  async overview(): Promise<MarketOverview> {
    return await this.client.sendInvoke<MarketOverview>("vt_market_overview");
  }
}

export type SellerStatus = "ingame" | "online" | "offline";

export interface BookOrder {
  id: string;
  side: "sell" | "buy";
  platinum: number;
  quantity: number;
  rank?: number;
  subtype?: string;
  variant: string;
  user: string;
  status: SellerStatus;
  reputation: number;
  own: boolean;
  updated_at: string;
}

export interface BookVariant {
  key: string;
  label: string;
  sells: number;
  buys: number;
  sells_ingame: number;
}

export interface BookSummary {
  best_sell_ingame: number | null;
  best_sell_online: number | null;
  best_sell_any: number | null;
  best_buy_ingame: number | null;
  best_buy_any: number | null;
  spread: number | null;
  sellers_ingame: number;
  buyers_ingame: number;
  sell_count: number;
  buy_count: number;
  own_sell: number | null;
  own_buy: number | null;
  undercut_by: number | null;
  own_is_best: boolean;
}

export interface OrderBook {
  wfm_url: string;
  name: string;
  variant: string;
  variants: BookVariant[];
  sells: BookOrder[];
  buys: BookOrder[];
  summary: BookSummary;
  fetched_at: string;
  age_secs: number;
  from_cache: boolean;
  ttl_secs: number;
}

export interface HistoryPoint {
  date: string;
  avg: number;
  min: number;
  max: number;
  median: number;
  volume: number;
  moving_avg?: number;
}

export interface PriceSnapshot {
  avg: number;
  min: number;
  max: number;
  median: number;
  volume: number;
  moving_avg: number | null;
  variant: string;
}

export type HistorySource = "wfm_statistics_90d" | "local_daily_snapshots" | "riven_scans" | "cache_snapshot";

export interface PriceHistory {
  wfm_url: string;
  source: HistorySource;
  note: string;
  points: HistoryPoint[];
  snapshot: PriceSnapshot | null;
  variant: string;
}

export interface StarFlags {
  stock: boolean;
  live_order: boolean;
  wish: boolean;
  inventory: boolean;
  riven: boolean;
}

export type TrendDir = "rising" | "falling" | "flat" | "unknown";

export interface MarketStar {
  wfm_url: string;
  wfm_id: string;
  name: string;
  category: string;
  avg_price: number;
  median: number;
  min_price: number;
  max_price: number;
  volume: number;
  moving_avg: number | null;
  trend: number;
  trend_dir: TrendDir;
  profit_margin: number;
  variant: string;
  flags: StarFlags;
  owned: number;
}

export interface MarketOverview {
  items: MarketStar[];
  generated_at: string;
  trend_basis: string;
  price_rows: number;
  rivens: number;
  history_days: number;
}
