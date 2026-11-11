import type { TauriTypes } from "$types";
import { RIVEN_CASE, RIVEN_SLOTS, SHOP_RACK, SHOP_SLOTS_PER_RACK, WANTED, wantedPlate, type Rect } from "./constants";
import { crateShape, type CrateShape } from "./warehouse";

/** Pure Shop Floor rules: what goes on which shelf, and how a stock status looks. No Pixi, no DOM. */

export type StockItem = TauriTypes.StockItem;
export type StockRiven = TauriTypes.StockRiven;
export type WishItem = TauriTypes.WishListItem;

export interface ShopData {
  items: StockItem[];
  rivens: StockRiven[];
  wishes: WishItem[];
  /** Totals in the database; more than the lists when a read was capped. */
  totalItems: number;
  totalRivens: number;
  totalWishes: number;
  /** True when the rows are demo data (no Tauri backend). */
  demo: boolean;
  error?: string;
}

/** Same colours the stock tables use (theme `stockStatus`). */
export const STATUS_HEX: Record<string, number> = {
  pending: 0x845ef7,
  live: 0x3ddcb0,
  to_low_profit: 0xefca62,
  no_sellers: 0xf76707,
  no_buyers: 0xcc5de8,
  inactive: 0xff4d6d,
  sma_limit: 0x5c7cfa,
  order_limit: 0x2ad4e6,
  overpriced: 0xe64980,
  underpriced: 0xff922b,
  max_price_drop: 0xf06595,
  insufficient_standing: 0xefca62,
};
const STATUS_TEXT: Record<string, string> = {
  pending: "Pending",
  live: "Live",
  to_low_profit: "Low profit",
  no_sellers: "No sellers",
  no_buyers: "No buyers",
  inactive: "Inactive",
  sma_limit: "SMA limit",
  order_limit: "Order limit",
  overpriced: "Overpriced",
  underpriced: "Underpriced",
  max_price_drop: "Max price drop",
  insufficient_standing: "Low standing",
};
const STATUS_DETAIL: Record<string, string> = {
  pending: "Waiting to be processed",
  live: "Live on warframe.market",
  to_low_profit: "Not listed: the profit is below your settings",
  no_sellers: "No sellers found for this item",
  no_buyers: "No buyers found for this item",
  inactive: "Inactive, will not be processed",
  sma_limit: "Held back by the moving-average limit",
  order_limit: "Held back by the order limit",
  overpriced: "Overpriced",
  underpriced: "Underpriced",
  max_price_drop: "Hit the maximum price drop",
  insufficient_standing: "Not enough standing to buy this",
};
export const statusHex = (status: string): number => STATUS_HEX[status] ?? 0x8d89b8;
export const statusCss = (status: string): string => `#${statusHex(status).toString(16).padStart(6, "0")}`;
export const statusText = (status: string): string => STATUS_TEXT[status] ?? status;
export const statusDetail = (status: string): string => STATUS_DETAIL[status] ?? "";

/** Live orders first, then the ones waiting, then the ones that are stuck. */
const STATUS_RANK: Record<string, number> = { live: 0, pending: 1, underpriced: 2, overpriced: 2, order_limit: 3, sma_limit: 3, to_low_profit: 4, max_price_drop: 4, no_buyers: 5, no_sellers: 5, insufficient_standing: 5, inactive: 6 };
const rank = (status: string) => STATUS_RANK[status] ?? 5;

export type ShelfKind = "stock" | "riven";

export interface ShopCrate {
  kind: ShelfKind;
  id: number;
  name: string;
  quantity: number;
  status: string;
  hidden: boolean;
  listPrice: number | null;
  slot: number;
  col: 0 | 1;
  rect: Rect;
  shape: CrateShape;
}

export interface WantedBoard {
  id: number;
  index: number;
  name: string;
  quantity: number;
  status: string;
  hidden: boolean;
  maxPrice: number | null;
  listPrice: number | null;
  /** Room-local plate on the back wall. */
  plate: Rect;
}

export interface ShopSummary {
  loaded: boolean;
  items: number;
  rivens: number;
  wishes: number;
  live: number;
  /** Sum of list price x owned over everything with a list price. */
  listedValue: number;
  /** Entries that have no shelf (see the stock desk). */
  moreItems: number;
  moreRivens: number;
  moreWishes: number;
}

export interface ShopLayout {
  crates: ShopCrate[];
  boards: WantedBoard[];
  summary: ShopSummary;
}

export const subTypeText = (sub?: TauriTypes.SubType | null): string => {
  if (!sub) return "";
  const parts: string[] = [];
  if (sub.variant) parts.push(sub.variant);
  if (sub.rank !== undefined && sub.rank !== null) parts.push(`R${sub.rank}`);
  if (sub.amber_stars) parts.push(`${sub.amber_stars} amber`);
  if (sub.cyan_stars) parts.push(`${sub.cyan_stars} cyan`);
  return parts.join(" ");
};
export const rivenName = (r: StockRiven): string => `${r.weapon_name} ${r.mod_name}`.trim();

function slotAt(rx: number, ry: number, w: number, rowPitch: number, slot: number, shape: CrateShape): { rect: Rect; col: 0 | 1 } {
  const col = (slot % 2) as 0 | 1;
  const row = Math.floor(slot / 2);
  const x = col === 0 ? rx : rx + w - shape.w;
  const y = ry + row * rowPitch + 24 - shape.d;
  return { rect: { x, y, w: shape.w, h: shape.d }, col };
}

export const byShelfOrder = <T extends { status: string; list_price?: number; is_hidden: boolean }>(a: T, b: T) =>
  Number(a.is_hidden) - Number(b.is_hidden) || rank(a.status) - rank(b.status) || (b.list_price ?? 0) - (a.list_price ?? 0);

export const EMPTY_SHOP: ShopLayout = { crates: [], boards: [], summary: { loaded: false, items: 0, rivens: 0, wishes: 0, live: 0, listedValue: 0, moreItems: 0, moreRivens: 0, moreWishes: 0 } };

/** Put stock on the shelves: items over three units, rivens in the case, wishes on the wanted wall. */
export function layoutShop(data: ShopData | null): ShopLayout {
  if (!data) return EMPTY_SHOP;
  const crates: ShopCrate[] = [];
  const itemSlots = SHOP_RACK.count * SHOP_SLOTS_PER_RACK;
  const items = [...data.items].sort(byShelfOrder);
  items.slice(0, itemSlots).forEach((it, i) => {
    const unit = Math.floor(i / SHOP_SLOTS_PER_RACK);
    const slot = i % SHOP_SLOTS_PER_RACK;
    const shape = crateShape(it.owned);
    const { rect, col } = slotAt(SHOP_RACK.x0 + unit * SHOP_RACK.pitch, SHOP_RACK.y, SHOP_RACK.w, SHOP_RACK.rowPitch, slot, shape);
    const sub = subTypeText(it.sub_type);
    crates.push({ kind: "stock", id: it.id, name: sub ? `${it.item_name} (${sub})` : it.item_name, quantity: it.owned, status: it.status, hidden: it.is_hidden, listPrice: it.list_price ?? null, slot: i, col, rect, shape });
  });
  const rivens = [...data.rivens].sort(byShelfOrder);
  rivens.slice(0, RIVEN_SLOTS).forEach((r, i) => {
    const shape: CrateShape = { w: 12, d: 12, stack: 1, h: 12 };
    const { rect, col } = slotAt(RIVEN_CASE.x, RIVEN_CASE.y, RIVEN_CASE.w, RIVEN_CASE.rowPitch, i, shape);
    crates.push({ kind: "riven", id: r.id, name: rivenName(r), quantity: 1, status: r.status, hidden: r.is_hidden, listPrice: r.list_price ?? null, slot: i, col, rect, shape });
  });
  const wishes = [...data.wishes].sort(byShelfOrder);
  const boards: WantedBoard[] = wishes.slice(0, WANTED.count).map((w, index) => ({
    id: w.id,
    index,
    name: w.item_name,
    quantity: w.quantity,
    status: w.status,
    hidden: w.is_hidden,
    maxPrice: typeof w.properties?.max_price === "number" ? w.properties.max_price : null,
    listPrice: w.list_price ?? null,
    plate: wantedPlate(index),
  }));
  let listedValue = 0;
  let live = 0;
  for (const it of data.items) {
    if (it.list_price) listedValue += it.list_price * it.owned;
    if (it.status === "live") live++;
  }
  for (const r of data.rivens) {
    if (r.list_price) listedValue += r.list_price;
    if (r.status === "live") live++;
  }
  return {
    crates,
    boards,
    summary: {
      loaded: true,
      items: Math.max(data.totalItems, data.items.length),
      rivens: Math.max(data.totalRivens, data.rivens.length),
      wishes: Math.max(data.totalWishes, data.wishes.length),
      live,
      listedValue,
      moreItems: Math.max(0, Math.max(data.totalItems, data.items.length) - Math.min(items.length, itemSlots)),
      moreRivens: Math.max(0, Math.max(data.totalRivens, data.rivens.length) - Math.min(rivens.length, RIVEN_SLOTS)),
      moreWishes: Math.max(0, Math.max(data.totalWishes, data.wishes.length) - boards.length),
    },
  };
}

/** Best guess at which stock item a buyer's message is about, and the price they named. */
export function matchOffer(message: string | undefined, items: StockItem[]): { item: StockItem | null; price: number | null } {
  if (!message) return { item: null, price: null };
  const text = message.toLowerCase();
  let item: StockItem | null = null;
  for (const it of items) {
    const name = it.item_name.toLowerCase();
    if (name && text.includes(name) && (!item || name.length > item.item_name.length)) item = it;
  }
  const m = /(\d{1,6})\s*(?:p\b|plat)/i.exec(message);
  return { item, price: m ? Number(m[1]) : null };
}
