import type { MarketOverview, MarketStar, OrderBook, PriceHistory } from "@api/market";
import type { SellCandidate } from "@api/wf_inventory";
import { errorText, fetchSellFinder, loadApi } from "../../station/data/bridge";
import type { ShopData } from "../../station/engine/shop";
import { demoBook, demoHistory, demoOverview, demoStars } from "./demo";

/**
 * The observatory's data, through the app's Tauri client (src/api/market) and the station bridge.
 * Outside Tauri everything is demo data (demo.ts); inside Tauri a failure is reported, never
 * papered over with invented numbers.
 */

export interface MarketResult {
  overview: MarketOverview;
  demo: boolean;
  error?: string;
}

const EMPTY: MarketOverview = { items: [], generated_at: "", trend_basis: "", price_rows: 0, rivens: 0, history_days: 0 };

/** Shop-derived flags (stock, live order, wish list) for one item. */
function shopFlags(shop: ShopData | null, url: string) {
  const items = shop?.items.filter((i) => i.wfm_url === url) ?? [];
  const rivens = shop?.rivens.filter((r) => r.wfm_weapon_url === url) ?? [];
  return {
    stock: items.length > 0 || rivens.length > 0,
    live_order: items.some((i) => i.status === "live" && !i.is_hidden) || rivens.some((r) => r.status === "live" && !r.is_hidden),
    wish: shop?.wishes.some((w) => w.wfm_url === url) ?? false,
  };
}

export async function fetchMarket(shop: ShopData | null): Promise<MarketResult> {
  const mod = await loadApi();
  if (!mod) {
    const sell = await fetchSellFinder(false);
    const owned = new Map(sell.result.items.map((i) => [i.wfm_url, i.quantity]));
    const riven = (s: MarketStar) => s.wfm_url.replace(/_riven$/, "");
    return {
      overview: demoOverview((s) => {
        const f = shopFlags(shop, s.flags.riven ? riven(s) : s.wfm_url);
        return { ...f, inventory: owned.has(s.wfm_url), owned: owned.get(s.wfm_url) ?? 0 };
      }),
      demo: true,
    };
  }
  try {
    const overview = await mod.default.market.overview();
    return { overview, demo: false };
  } catch (e) {
    console.warn("[game] vt_market_overview failed", e);
    return { overview: EMPTY, demo: false, error: errorText(e) };
  }
}

/** The user's own sell price for an item in the demo (the stock row's list price when it is live). */
function demoOwn(shop: ShopData | null, s: MarketStar) {
  const url = s.flags.riven ? s.wfm_url.replace(/_riven$/, "") : s.wfm_url;
  const item = shop?.items.find((i) => i.wfm_url === url && i.status === "live" && !i.is_hidden);
  const riven = shop?.rivens.find((r) => r.wfm_weapon_url === url && r.status === "live" && !r.is_hidden);
  return { sell: item?.list_price ?? riven?.list_price ?? undefined };
}

export async function fetchBook(s: MarketStar, shop: ShopData | null, opts: { variant?: string; force?: boolean } = {}): Promise<OrderBook> {
  const mod = await loadApi();
  if (!mod) {
    await new Promise((r) => setTimeout(r, 120));
    return demoBook(s, demoOwn(shop, s));
  }
  return await mod.default.market.orderBook(s.wfm_url, opts.variant, opts.force);
}

export async function fetchHistory(s: MarketStar, variant?: string): Promise<PriceHistory> {
  const mod = await loadApi();
  if (!mod) {
    await new Promise((r) => setTimeout(r, 80));
    return demoHistory(s);
  }
  return await mod.default.market.priceHistory(s.wfm_url, variant, s.flags.riven || undefined);
}

/** The Sell Finder row for an owned item (to list it exactly like Cargo > Sell Finder does). */
export async function sellCandidate(url: string): Promise<SellCandidate | null> {
  const res = await fetchSellFinder(false);
  return res.result.items.find((i) => i.wfm_url === url) ?? null;
}

export const demoStarCount = () => demoStars().length;
