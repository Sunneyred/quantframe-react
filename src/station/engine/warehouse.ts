import type { SellCandidate, SellFinderResult } from "@api/wf_inventory";
import { RACK, SLOTS_PER_BAY, type Rect } from "./constants";

/** Pure warehouse rules: which bay an item goes to, how big its crate is, what it is worth. No Pixi, no DOM. */

export type { SellCandidate, SellFinderResult };

export const BAYS = [
  { key: "prime", label: "Primes" },
  { key: "set", label: "Sets" },
  { key: "mod", label: "Mods" },
  { key: "arcane", label: "Arcanes" },
  { key: "relic", label: "Relics" },
  { key: "other", label: "Other" },
] as const;

export type BayKey = (typeof BAYS)[number]["key"];

export const bayIndexOf = (category: string): number => {
  const i = BAYS.findIndex((b) => b.key === category);
  return i >= 0 ? i : BAYS.length - 1;
};
export const bayLabel = (category: string) => BAYS[bayIndexOf(category)].label;

/** 0 dim (<10p), 1 cyan (10-49p), 2 gold (50-149p), 3 bright pulsing gold (150p+). By total value of the stack. */
export type Tier = 0 | 1 | 2 | 3;
export const tierOf = (total: number): Tier => (total >= 150 ? 3 : total >= 50 ? 2 : total >= 10 ? 1 : 0);
export const TIER_CSS = ["#8d89b8", "#2ad4e6", "#e8c15a", "#fff1b8"] as const;
export const LISTED_CSS = "#35e0b4";

export interface CrateShape {
  /** Footprint width and depth in world pixels (multiples of 4). */
  w: number;
  d: number;
  /** Crates stacked on top of each other. */
  stack: number;
  /** Height of the whole stack above the rack, in world units. */
  h: number;
}

/** Quantity decides the size: one small box up to a triple stack of big ones. */
export function crateShape(quantity: number): CrateShape {
  if (quantity >= 25) return { w: 16, d: 12, stack: 3, h: 24 };
  if (quantity >= 10) return { w: 16, d: 12, stack: 2, h: 18 };
  if (quantity >= 5) return { w: 16, d: 12, stack: 1, h: 12 };
  if (quantity >= 2) return { w: 12, d: 12, stack: 1, h: 10 };
  return { w: 8, d: 8, stack: 1, h: 8 };
}

export interface Crate {
  item: SellCandidate;
  bay: number;
  slot: number;
  /** 0 = column on the left aisle, 1 = column on the right aisle. */
  col: 0 | 1;
  /** Footprint in world pixels. */
  rect: Rect;
  shape: CrateShape;
  tier: Tier;
  listed: boolean;
}

export interface Bay {
  key: BayKey;
  label: string;
  /** Item types in this category, and how many of those have no crate (see the terminal). */
  count: number;
  overflow: number;
  total: number;
  crates: Crate[];
}

export interface WarehouseSummary {
  connected: boolean;
  /** Plat still on the shelves: unlisted rows with a real price (max-rank guesses are left out, like the Sell Finder total). */
  sellable: number;
  listedValue: number;
  types: number;
  listedTypes: number;
  trades: number;
  mastery: number;
  unpriced: number;
}

export interface WarehouseLayout {
  bays: Bay[];
  crates: Crate[];
  summary: WarehouseSummary;
}

export const byValue = (a: SellCandidate, b: SellCandidate) => b.total - a.total || b.unit_price - a.unit_price || a.name.localeCompare(b.name);

export function slotRect(bay: number, slot: number, shape: CrateShape): { rect: Rect; col: 0 | 1 } {
  const col = (slot % 2) as 0 | 1;
  const row = Math.floor(slot / 2);
  const rx = RACK.x0 + bay * RACK.pitch;
  // crates sit flush with the aisle they are reached from, at the front of their slot
  const x = col === 0 ? rx : rx + RACK.w - shape.w;
  const y = RACK.y + row * RACK.rowPitch + 24 - shape.d;
  return { rect: { x, y, w: shape.w, h: shape.d }, col };
}

export function summarize(result: SellFinderResult | null): WarehouseSummary {
  const s: WarehouseSummary = { connected: false, sellable: 0, listedValue: 0, types: 0, listedTypes: 0, trades: 0, mastery: 0, unpriced: 0 };
  if (!result || !result.connected) return s;
  s.connected = true;
  s.trades = result.trades_remaining;
  s.mastery = result.mastery_rank;
  s.unpriced = result.unpriced;
  for (const i of result.items) {
    s.types++;
    if (i.in_stock) {
      s.listedTypes++;
      s.listedValue += i.total;
    } else if (i.basis !== "max_rank") s.sellable += i.total;
  }
  return s;
}

/**
 * Lay the sell finder rows out as crates. Every category gets its bay; inside a
 * bay the most valuable stacks take the first slots and anything past the last
 * slot is only reachable through the bay terminal (`overflow`).
 */
export function layoutWarehouse(result: SellFinderResult | null): WarehouseLayout {
  const bays: Bay[] = BAYS.map((b) => ({ key: b.key, label: b.label, count: 0, overflow: 0, total: 0, crates: [] }));
  const crates: Crate[] = [];
  if (result?.connected) {
    const groups: SellCandidate[][] = BAYS.map(() => []);
    for (const item of result.items) groups[bayIndexOf(item.category)].push(item);
    groups.forEach((items, b) => {
      items.sort(byValue);
      const bay = bays[b];
      bay.count = items.length;
      bay.overflow = Math.max(0, items.length - SLOTS_PER_BAY);
      items.forEach((item, slot) => {
        bay.total += item.total;
        if (slot >= SLOTS_PER_BAY) return;
        const shape = crateShape(item.quantity);
        const { rect, col } = slotRect(b, slot, shape);
        const crate: Crate = { item, bay: b, slot, col, rect, shape, tier: tierOf(item.total), listed: item.in_stock };
        bay.crates.push(crate);
        crates.push(crate);
      });
    });
  }
  return { bays, crates, summary: summarize(result) };
}

/** The rows "List top N by value" would list: unlisted, with a real price. */
export function topUnlisted(items: SellCandidate[], n: number): SellCandidate[] {
  return items
    .filter((i) => !i.in_stock && i.basis !== "max_rank")
    .sort(byValue)
    .slice(0, n);
}

export const priceCaveat = (basis: SellCandidate["basis"]): string | null =>
  basis === "max_rank"
    ? "This is the max-rank price. Your unranked copy sells for less, so it is left out of the sellable total."
    : basis === "arcane_estimate"
      ? "Estimate: the max-rank price divided by the copies needed to build one."
      : null;
