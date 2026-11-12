import type { MarketStar } from "@api/market";

/**
 * Pure mapping from market data to the Orrery's space. No three.js here, so it is easy to reason
 * about (and to test): positions are on the floor plane around the Orrery's centre, in metres.
 *
 *   angle   constellation (category) sector, then a stable hash of the item inside it
 *   radius  volume rank inside the constellation: the busiest items on the rim (nearest to whoever
 *           walks around it), the quiet ones towards the axis, with a little jitter
 *   height  price, log scale: 1p at Y_MIN, 3000p at Y_MAX
 *   size    trading volume (sqrt), between SIZE_MIN and SIZE_MAX
 *   colour  trend: rising warm gold, falling cool blue-violet, flat white
 */

export interface Constellation {
  key: string;
  label: string;
  /** Sector start and span, radians clockwise from north (-Z). */
  start: number;
  span: number;
  count: number;
}

export const CONSTELLATIONS: Array<{ key: string; label: string }> = [
  { key: "prime", label: "Primes" },
  { key: "set", label: "Sets" },
  { key: "mod", label: "Mods" },
  { key: "arcane", label: "Arcanes" },
  { key: "relic", label: "Relics" },
  { key: "riven", label: "Rivens" },
  { key: "other", label: "Other" },
];

export const INNER = 1.0;
export const OUTER = 6.1;
export const Y_MIN = 0.45;
export const Y_MAX = 4.5;
export const P_MIN = 1;
export const P_MAX = 3000;
export const SIZE_MIN = 0.022;
export const SIZE_MAX = 0.1;
/** Gap between sectors, radians (wide enough that constellations read as separate clusters). */
const GAP = 0.15;

export const constellationOf = (category: string) => (CONSTELLATIONS.some((c) => c.key === category) ? category : "other");

/** Sectors sized by the square root of their item count (a big category does not swallow the map), min 26 degrees. */
export function layoutConstellations(items: Array<Pick<MarketStar, "category">>): Constellation[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(constellationOf(i.category), (counts.get(constellationOf(i.category)) ?? 0) + 1);
  const present = CONSTELLATIONS.filter((c) => (counts.get(c.key) ?? 0) > 0);
  if (present.length === 0) return [];
  const minSpan = (26 * Math.PI) / 180;
  const total = Math.PI * 2 - GAP * present.length;
  const weights = present.map((c) => Math.sqrt(counts.get(c.key) ?? 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let spans = weights.map((w) => (w / wsum) * total);
  // lift tiny sectors to the minimum, take it from the others in proportion
  const small = spans.map((s) => s < minSpan);
  const need = spans.reduce((a, s, i) => a + (small[i] ? minSpan - s : 0), 0);
  const bigSum = spans.reduce((a, s, i) => a + (small[i] ? 0 : s), 0);
  if (need > 0 && bigSum > need) spans = spans.map((s, i) => (small[i] ? minSpan : s - (s / bigSum) * need));
  const out: Constellation[] = [];
  // start so the entrance (south) faces the gap between the last and the first sector
  let a = Math.PI + GAP / 2;
  present.forEach((c, i) => {
    out.push({ key: c.key, label: c.label, start: a, span: spans[i], count: counts.get(c.key) ?? 0 });
    a += spans[i] + GAP;
  });
  return out;
}

/** FNV-1a hash of a string to [0, 1). */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function priceHeight(price: number): number {
  const p = Math.min(P_MAX, Math.max(P_MIN, price || P_MIN));
  const t = Math.log10(p / P_MIN) / Math.log10(P_MAX / P_MIN);
  return Y_MIN + t * (Y_MAX - Y_MIN);
}

export function starSize(volume: number, maxVolume: number): number {
  const t = maxVolume > 0 ? Math.sqrt(Math.max(0, volume)) / Math.sqrt(maxVolume) : 0;
  return SIZE_MIN + Math.min(1, t) * (SIZE_MAX - SIZE_MIN);
}

/** Linear RGB (0..1, may exceed 1 for glow) for a trend. */
export function trendColor(dir: string, trend: number): [number, number, number] {
  const k = Math.min(1, Math.abs(trend) / 0.25);
  if (dir === "rising") return [1.15, 0.6 + 0.1 * (1 - k), 0.16 + 0.14 * (1 - k)];
  if (dir === "falling") return [0.38 + 0.1 * (1 - k), 0.36 + 0.14 * (1 - k), 1.15];
  if (dir === "unknown") return [0.42, 0.45, 0.52];
  return [0.68, 0.73, 0.84];
}

export interface StarPlace {
  x: number;
  y: number;
  z: number;
  size: number;
  angle: number;
  radius: number;
}

/**
 * Floor-plane position of a star (Orrery-local; north is -Z). `rank` is the item's volume rank in
 * its constellation, 0 = busiest .. 1 = quietest.
 */
export function placeStar(item: Pick<MarketStar, "wfm_url" | "category" | "avg_price" | "median" | "volume">, sectors: Constellation[], maxVolume: number, rank = hash01(item.wfm_url, 13)): StarPlace {
  const key = constellationOf(item.category);
  const sec = sectors.find((s) => s.key === key) ?? sectors[sectors.length - 1];
  const margin = Math.min(0.06, sec.span * 0.08);
  const angle = sec.start + margin + hash01(item.wfm_url, 7) * (sec.span - margin * 2);
  const t = 1 - Math.pow(Math.min(1, Math.max(0, rank)), 0.85);
  const jitter = (hash01(item.wfm_url, 17) - 0.5) * 0.9;
  const radius = Math.min(OUTER, Math.max(INNER, INNER + (OUTER - INNER) * (0.08 + 0.92 * t) + jitter));
  const price = item.median > 0 ? item.median : item.avg_price;
  return { x: Math.sin(angle) * radius, y: priceHeight(price), z: -Math.cos(angle) * radius, size: starSize(item.volume, maxVolume), angle, radius };
}

export interface MarketFilter {
  /** "" = every constellation. */
  category: string;
  mine: boolean;
  rising: boolean;
  /** Free text (name contains). */
  text: string;
}

export const NO_FILTER: MarketFilter = { category: "", mine: false, rising: false, text: "" };

export const isMine = (s: MarketStar) => s.flags.stock || s.flags.live_order || s.flags.wish || s.flags.inventory;

export function matchesFilter(s: MarketStar, f: MarketFilter): boolean {
  if (f.category && constellationOf(s.category) !== f.category) return false;
  if (f.mine && !isMine(s)) return false;
  if (f.rising && s.trend_dir !== "rising") return false;
  const q = f.text.trim().toLowerCase();
  if (q && !s.name.toLowerCase().includes(q)) return false;
  return true;
}

export const filterActive = (f: MarketFilter) => Boolean(f.category || f.mine || f.rising || f.text.trim());

/** Volume rank of every item inside its constellation: 0 = busiest .. 1 = quietest. */
export function volumeRanks(items: Array<Pick<MarketStar, "category" | "volume">>): number[] {
  const by = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = constellationOf(it.category);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(i);
  });
  const out = new Array<number>(items.length).fill(0.5);
  for (const idx of by.values()) {
    idx.sort((a, b) => items[b].volume - items[a].volume);
    idx.forEach((i, r) => (out[i] = idx.length > 1 ? r / (idx.length - 1) : 0));
  }
  return out;
}

/** Movers for the weather wall: biggest relative moves among items that actually trade. */
export function movers(items: MarketStar[], n = 6, minVolume = 3) {
  const traded = items.filter((i) => i.volume >= minVolume && i.trend_dir !== "unknown");
  const up = traded.filter((i) => i.trend > 0).sort((a, b) => b.trend - a.trend).slice(0, n);
  const down = traded.filter((i) => i.trend < 0).sort((a, b) => a.trend - b.trend).slice(0, n);
  const busiest = [...items].sort((a, b) => b.volume - a.volume).slice(0, n);
  return { up, down, busiest };
}

/** Short price text: 4p, 38p, 1.2k. */
export function plat(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `${Math.round(n)}p`;
  return `${Math.round(n * 10) / 10}p`.replace(".0p", "p");
}

export function trendText(s: Pick<MarketStar, "trend" | "trend_dir">): string {
  if (s.trend_dir === "unknown") return "no trend data";
  const pct = Math.round(s.trend * 100);
  if (s.trend_dir === "flat") return `flat ${pct >= 0 ? "+" : ""}${pct}%`;
  return `${s.trend_dir === "rising" ? "rising" : "falling"} ${pct > 0 ? "+" : ""}${pct}%`;
}
