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
