import type { SellCandidate, SellFinderResult } from "@api/wf_inventory";
import { progressOf, type Buyer, type GoalSnapshot } from "../engine/logic";

/**
 * Everything the station needs from the Tauri backend, wrapped so the page
 * still works in a plain browser (or when a command fails): calls fall back to
 * demo data and event subscriptions become no-ops.
 */

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

const demo = { platinum: 76, floor: 0, goal: 150, daily_target: 40, profit_today: 12, avg_daily_profit: 18 };

export function demoGoal(): GoalSnapshot {
  return { ...demo, progress: progressOf(demo.platinum, demo.floor, demo.goal), balance_is_live: false };
}

/** Pretend a sale happened (debug key G in demo mode). */
export function demoSale(gain: number) {
  demo.platinum += gain;
  demo.profit_today += gain;
  // roll over to a bigger goal so the demo never just sits full
  if (demo.platinum >= demo.goal) {
    demo.floor = demo.goal;
    demo.goal *= 2;
  }
}

const DEMO_NAMES = ["Ordis_Prime", "VoidRunner77", "xX_Nezha_Xx", "Clem2Grakata", "TennoKat", "PlatBaron", "MesaMain", "Loid.Necraloid"];
const DEMO_OFFERS = [
  "Hi! I want to buy: \"Glaive Prime Set\" for 95 platinum. (warframe.market)",
  "Hi! I want to buy: \"Primed Continuity\" (rank 10) for 60 platinum. (warframe.market)",
  "WTB your Arcane Energize r5, 4 offers?",
  "Hi! I want to buy: \"Nova Prime Set\" for 70 platinum. (warframe.market)",
  "still selling the riven? can do 250p",
];
let demoCounter = 0;

export function demoBuyer(): Omit<Buyer, "pings"> {
  const n = demoCounter++;
  const name = DEMO_NAMES[n % DEMO_NAMES.length];
  return {
    id: `debug-${n}-${Date.now()}`,
    name,
    commandName: name,
    source: "debug",
    message: DEMO_OFFERS[n % DEMO_OFFERS.length],
    receivedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Backend access
// ---------------------------------------------------------------------------

type ApiModule = typeof import("@api/index");
let apiModule: Promise<ApiModule | null> | null = null;

/** The app's Tauri client, or null outside Tauri. Never throws. */
function loadApi(): Promise<ApiModule | null> {
  if (!isTauri()) return Promise.resolve(null);
  apiModule ??= import("@api/index").catch((e) => {
    console.warn("[station] api unavailable", e);
    return null;
  });
  return apiModule;
}

export interface GoalResult {
  goal: GoalSnapshot;
  /** True when the numbers are demo data, not the real vault. */
  demo: boolean;
}

function isGoal(v: unknown): v is GoalSnapshot {
  if (!v || typeof v !== "object") return false;
  const g = v as Record<string, unknown>;
  return typeof g.platinum === "number" && typeof g.goal === "number" && typeof g.progress === "number";
}

export async function fetchGoal(): Promise<GoalResult> {
  try {
    const mod = await loadApi();
    if (mod) {
      const g: unknown = await mod.default.wf_inventory.platGoal();
      if (isGoal(g)) {
        return {
          goal: {
            ...g,
            floor: Number(g.floor) || 0,
            daily_target: Number(g.daily_target) || 0,
            profit_today: Number(g.profit_today) || 0,
            balance_is_live: Boolean(g.balance_is_live),
          },
          demo: false,
        };
      }
    }
  } catch (e) {
    console.warn("[station] vt_plat_goal failed, using demo data", e);
  }
  return { goal: demoGoal(), demo: true };
}

// ---------------------------------------------------------------------------
// Warehouse (sell finder)
// ---------------------------------------------------------------------------

/** Same floor the Sell Finder tab starts with: rows under this price each are noise. */
const SELL_MIN_PRICE = 5;

type DemoRow = [name: string, category: string, quantity: number, unit: number, volume: number, basis?: SellCandidate["basis"], inStock?: boolean];
const DEMO_ROWS: DemoRow[] = [
  ["Glaive Prime Blade", "prime", 2, 38, 61],
  ["Nova Prime Neuroptics Blueprint", "prime", 3, 14, 44],
  ["Rhino Prime Chassis Blueprint", "prime", 1, 22, 37],
  ["Akstiletto Prime Barrel", "prime", 6, 9, 52],
  ["Paris Prime Lower Limb", "prime", 12, 4, 20],
  ["Soma Prime Stock", "prime", 2, 6, 31],
  ["Mesa Prime Systems Blueprint", "prime", 1, 55, 28, "exact", true],
  ["Glaive Prime Set", "set", 1, 165, 48],
  ["Nova Prime Set", "set", 2, 78, 35],
  ["Kronen Prime Set", "set", 1, 92, 40],
  ["Burston Prime Set", "set", 1, 24, 12],
  ["Primed Continuity", "mod", 1, 62, 55, "max_rank"],
  ["Blind Rage", "mod", 4, 12, 70],
  ["Narrow Minded", "mod", 2, 18, 66],
  ["Condition Overload", "mod", 1, 26, 80, "max_rank"],
  ["Maiming Strike", "mod", 1, 48, 33],
  ["Vigilante Armaments", "mod", 27, 5, 90],
  ["Arcane Energize", "arcane", 3, 34, 140, "arcane_estimate"],
  ["Arcane Grace", "arcane", 6, 11, 95, "arcane_estimate"],
  ["Arcane Guardian", "arcane", 11, 6, 110, "arcane_estimate"],
  ["Molt Augmented", "arcane", 2, 9, 60, "arcane_estimate"],
  ["Axi L4 Relic", "relic", 14, 6, 120],
  ["Neo N11 Relic", "relic", 5, 5, 74],
  ["Lith G1 Relic", "relic", 30, 5, 88],
  ["Ayatan Anasa Sculpture", "other", 4, 9, 45],
  ["Legendary Fusion Core", "other", 1, 210, 3],
  ["Scimitar Avionics", "other", 2, 16, 8],
];

const demoStocked = new Set(DEMO_ROWS.filter((r) => r[6]).map((r) => r[0]));
let demoListFails = false;

/** Dev helper: make the next demo listing fail, to see the error state. */
export function demoFailNextListing() {
  demoListFails = true;
}

/** Dev switches for the standalone page: `?offline` shows the not-connected state, `?many` overfills the mods bay. */
const demoFlag = (name: string): boolean => {
  try {
    return new URLSearchParams(window.location.search).has(name);
  } catch {
    return false;
  }
};

function demoSellFinder(): SellFinderResult {
  if (demoFlag("offline")) return EMPTY_SELL;
  const rows = demoFlag("many") ? [...DEMO_ROWS, ...Array.from({ length: 9 }, (_, i): DemoRow => [`Demo Mod ${i + 1}`, "mod", 1 + (i % 4), 5 + i * 3, 10 + i])] : DEMO_ROWS;
  const items: SellCandidate[] = rows.map(([name, category, quantity, unit_price, volume, basis = "exact"]) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    return {
      name,
      wfm_url: slug,
      unique_name: `/Demo/${slug}`,
      icon: "",
      category,
      quantity,
      unit_price,
      total: quantity * unit_price,
      volume,
      week_price_shift: 0,
      basis,
      in_stock: demoStocked.has(name),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    connected: true,
    platinum: demo.platinum,
    trades_remaining: 14,
    mastery_rank: 16,
    owned_tradable: items.length + 9,
    unpriced: 9,
    total_value: items.filter((i) => i.basis !== "max_rank").reduce((sum, i) => sum + i.total, 0),
    items,
  };
}

const EMPTY_SELL: SellFinderResult = { connected: false, platinum: 0, trades_remaining: 0, mastery_rank: 0, owned_tradable: 0, unpriced: 0, total_value: 0, items: [] };

export const errorText = (e: unknown): string => {
  if (typeof e === "string") return e;
  const o = e as { message?: unknown; cause?: unknown } | null;
  if (o && typeof o.message === "string" && o.message) return o.message;
  if (o && typeof o.cause === "string" && o.cause) return o.cause;
  try {
    return JSON.stringify(e) ?? "Unknown error";
  } catch {
    return "Unknown error";
  }
};

export interface SellResult {
  result: SellFinderResult;
  /** True when the rows are demo data (no Tauri backend). */
  demo: boolean;
  /** Set when the real backend refused: the result is then empty and not connected. */
  error?: string;
}

function isSellResult(v: unknown): v is SellFinderResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.connected === "boolean" && Array.isArray(r.items);
}

/**
 * Read the sell finder. `rescan` first asks the backend to re-read the inventory
 * file. Outside Tauri this is demo stock; inside Tauri a failure is reported,
 * never papered over with fake items.
 */
export async function fetchSellFinder(rescan = false): Promise<SellResult> {
  const mod = await loadApi();
  if (!mod) {
    await new Promise((r) => setTimeout(r, rescan ? 350 : 60));
    return { result: demoSellFinder(), demo: true };
  }
  try {
    if (rescan) await mod.default.wf_inventory.refresh();
    const res: unknown = await mod.default.wf_inventory.sellFinder(SELL_MIN_PRICE);
    if (isSellResult(res)) return { result: res, demo: false };
    return { result: EMPTY_SELL, demo: false, error: "The sell finder returned something unexpected." };
  } catch (e) {
    console.warn("[station] vt_sell_finder failed", e);
    return { result: EMPTY_SELL, demo: false, error: errorText(e) };
  }
}

/** Add an owned item to stock at 0p cost, exactly like "Add to stock" in Cargo > Sell Finder. Throws on failure. */
export async function listForSale(item: SellCandidate, quantity: number): Promise<void> {
  const qty = Math.max(1, Math.min(item.quantity, Math.floor(quantity) || 1));
  const mod = await loadApi();
  if (!mod) {
    if (isTauri()) throw new Error("The app backend is not available.");
    await new Promise((r) => setTimeout(r, 450));
    if (demoListFails) {
      demoListFails = false;
      throw new Error("Demo failure: the listing was rejected.");
    }
    demoStocked.add(item.name);
    return;
  }
  await mod.default.stock_item.create({ raw: item.wfm_url, quantity: qty, bought: 0, sub_type: item.sub_type });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Event names as emitted by the backend (see src/types/tauri.type.ts Events). */
const EV_CHAT_MESSAGE = "Wfm:OnChatMessage";
const EV_REFRESH_TRANSACTIONS = "Transaction:RefreshTransactions";
const EV_REFRESH_STOCK_ITEMS = "LiveScraper:RefreshStockItems";
const EV_REFRESH_STOCK_RIVENS = "LiveScraper:RefreshStockRivens";
/** Raw Tauri event the log parser emits when it sees a finished in-game trade. */
const EV_ADD_TRADE = "add_trade";

interface ChatMessagePayload {
  id?: string;
  chat_id?: string;
  message?: string;
  raw_message?: string;
  message_from?: string;
  send_date?: string;
  requirer_refresh?: boolean;
}

interface TradePayload {
  playerName?: string;
  platinum?: number;
  type?: string;
}

export interface StationEvents {
  onBuyer(buyer: Omit<Buyer, "pings">): void;
  /** A finished in-game sale seen by the log parser. */
  onSale(gain: number, playerName: string): void;
  /** Something changed that may have moved the balance: re-poll now. */
  onRefresh(): void;
}

async function buyerFromChat(mod: ApiModule, msg: ChatMessagePayload): Promise<Omit<Buyer, "pings"> | null> {
  if (!msg.chat_id || !msg.message_from) return null;
  let name: string | undefined;
  let chatName: string | undefined;
  let reputation: number | undefined;
  let status: string | undefined;
  try {
    const page = await mod.default.chat.getPagination({ page: 1, limit: 50, sort_by: "last_update", sort_direction: "desc" });
    const chat = page.results?.find((c) => c.id === msg.chat_id);
    if (chat) {
      chatName = chat.chat_name;
      const from = chat.chat_with.find((u) => u.id === msg.message_from);
      // the sender is not one of the people we are chatting with: it is our own message
      if (!from && chat.chat_with.length > 0) return null;
      name = from?.ingame_name;
      reputation = from?.reputation;
      status = from?.status;
    }
  } catch (e) {
    console.warn("[station] could not resolve chat sender", e);
  }
  const display = name || chatName || "Unknown buyer";
  return {
    id: `wfm-${msg.chat_id}`,
    name: display,
    commandName: name,
    source: "wfm_chat",
    message: msg.raw_message || msg.message,
    chatName,
    reputation,
    status,
    receivedAt: Date.now(),
  };
}

/** Subscribe to the real buyer/sale events. Returns an unsubscribe function; safe outside Tauri. */
export function subscribeStationEvents(handlers: StationEvents): () => void {
  let cancelled = false;
  const cleanups: Array<() => void> = [];

  void (async () => {
    const mod = await loadApi();
    if (!mod || cancelled) return;
    try {
      const onChat = (msg: ChatMessagePayload) => {
        if (!msg || msg.requirer_refresh) return;
        void buyerFromChat(mod, msg).then((b) => {
          if (b && !cancelled) handlers.onBuyer(b);
        });
      };
      const onRefresh = () => handlers.onRefresh();
      mod.OnTauriEvent(EV_CHAT_MESSAGE, onChat);
      cleanups.push(() => mod.OffTauriEvent(EV_CHAT_MESSAGE, onChat));
      for (const ev of [EV_REFRESH_TRANSACTIONS, EV_REFRESH_STOCK_ITEMS, EV_REFRESH_STOCK_RIVENS]) {
        mod.OnTauriEvent(ev, onRefresh);
        cleanups.push(() => mod.OffTauriEvent(ev, onRefresh));
      }
    } catch (e) {
      console.warn("[station] event subscription failed", e);
    }
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<TradePayload>(EV_ADD_TRADE, ({ payload }) => {
        const plat = Number(payload?.platinum) || 0;
        if (String(payload?.type ?? "").toLowerCase() === "sale" && plat > 0) handlers.onSale(plat, payload.playerName ?? "");
        handlers.onRefresh();
      });
      if (cancelled) unlisten();
      else cleanups.push(unlisten);
      // In-game whisper opened (from the Warframe log): only the player's name is known.
      const unlistenWhisper = await listen<{ playerName?: string }>("vt_whisper", ({ payload }) => {
        const name = String(payload?.playerName ?? "").trim();
        if (!name) return;
        handlers.onBuyer({
          id: `whisper-${name}`,
          name,
          commandName: name,
          source: "whisper",
          message: "Opened a whisper with you in Warframe.",
          receivedAt: Date.now(),
        });
      });
      if (cancelled) unlistenWhisper();
      else cleanups.push(unlistenWhisper);
    } catch (e) {
      console.warn("[station] trade listener unavailable", e);
    }
  })();

  return () => {
    cancelled = true;
    for (const c of cleanups.splice(0)) {
      try {
        c();
      } catch {
        /* listener already gone */
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export async function copyText(text: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      /* fall through to the browser APIs */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
