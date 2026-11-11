import { FIXTURES, ROOMS, ROW_H, TANK_USE, WH_OX, type FixtureId, type RoomId } from "../engine/constants";

/** The real app features a terminal opens inside the station, and the places fast travel knows. Pure data. */

export type PanelId = "overview" | "live" | "market" | "comms" | "ledger" | "scanner" | "tradechat" | "engineering" | "about" | "debug" | "captain";

export interface PanelInfo {
  title: string;
  /** The terminal it belongs to. */
  fixture: FixtureId;
  /** Route of the same feature in the classic view. */
  classic: string;
  /** What the panel holds, for the palette and for the placeholder outside the app. */
  what: string;
  keywords: string;
}

export const PANELS: Record<PanelId, PanelInfo> = {
  overview: { title: "Overview", fixture: "overview", classic: "/", what: "Home dashboard: plat goal, total / today / best seller, profit charts, latest transactions, best categories.", keywords: "home dashboard summary profit chart" },
  live: {
    title: "Stock desk",
    fixture: "stockconsole",
    classic: "/live_scraper",
    what: "The whole Live Trading page: trader start/stop, strategy, and the Items, Rivens, Wish list and Syndicates tables with add, bulk edit, export, info and trade-message tools.",
    keywords: "live trading scraper stock items rivens wish list syndicate add create export wts wtb bulk",
  },
  market: { title: "Market terminal", fixture: "market", classic: "/warframe-market", what: "Your warframe.market orders and riven auctions: refresh, delete, bought / sold, import into stock.", keywords: "warframe market wfm orders auctions" },
  comms: { title: "Comms terminal", fixture: "comms", classic: "/chat", what: "warframe.market chats: read, reply, delete.", keywords: "chat messages inbox reply" },
  ledger: {
    title: "Ledger terminal",
    fixture: "ledger",
    classic: "/trading_analytics",
    what: "Trading analytics: transactions (list and charts, edit, delete, export), item prices, syndicates, riven market scan, trading partners, Warframe GDPR import.",
    keywords: "trading analytics transactions prices riven market scan users gdpr statistics",
  },
  scanner: { title: "Cargo scanner", fixture: "scanner", classic: "/wf_inventory", what: "Cargo: the Sell Finder with the AlecaFrame connect button, rescan and add to stock, and your inventory rivens.", keywords: "cargo inventory sell finder alecaframe connect rivens" },
  tradechat: { title: "Trade chat terminal", fixture: "tradechat", classic: "/trade_messages", what: "Trade messages: build WTS / WTB lines for items, custom templates and rivens, and copy them for trade chat.", keywords: "trade messages wts wtb template copy" },
  engineering: { title: "Engineering terminal", fixture: "engineering", classic: "", what: "All app settings: general, live trading, appearance and themes, notifications, advanced.", keywords: "settings options preferences theme notifications language" },
  about: { title: "Info plaque", fixture: "about", classic: "/about", what: "About: guide, Discord and support links, version, check for updates.", keywords: "about version update discord guide patreon" },
  debug: { title: "Maintenance hatch", fixture: "hatch", classic: "/debug", what: "Debug tools: command logging, backend states, debugging helpers, EE.log reader.", keywords: "debug logs states ee log developer" },
  captain: { title: "Captain's console", fixture: "captain", classic: "", what: "Your warframe.market account: status (online / in game / invisible), log out, classic view.", keywords: "user account profile status online ingame invisible logout log out sign out" },
};
export const PANEL_IDS = Object.keys(PANELS) as PanelId[];
export const panelOfFixture = (id: FixtureId): PanelId | null => PANEL_IDS.find((p) => PANELS[p].fixture === id) ?? null;

export interface Place {
  room: RoomId;
  label: string;
  detail: string;
  x: number;
  y: number;
  face: number;
}

const N = -Math.PI / 2;
const FIXTURE_DETAIL: Record<FixtureId, string> = {
  ledger: "Trading analytics and transactions",
  scanner: "Cargo: Sell Finder, AlecaFrame, rivens",
  lever: "Start and stop the live trader",
  manager: "Strategy presets and smart trader",
  about: "About and updates",
  overview: "Home dashboard",
  docks: "Trades left today",
  comms: "warframe.market chat",
  tradechat: "WTS / WTB message builder",
  engineering: "Settings",
  captain: "Account, status, log out",
  hatch: "Debug tools",
  stockconsole: "Full Live Trading tables",
  market: "warframe.market orders and auctions",
};
const fixturePlaces = (room: RoomId): Place[] =>
  FIXTURES.filter((f) => f.room === room).map((f) => ({ room, label: f.id === "lever" ? "Trader lever" : f.prompt.replace(/^Talk to the m/, "M"), detail: FIXTURE_DETAIL[f.id], x: f.use.x, y: f.use.y, face: f.face }));

export const PLACES: Place[] = [
  { room: "vault", label: "Plat tank", detail: "Balance against your goal", x: TANK_USE.x, y: TANK_USE.y, face: N },
  { room: "vault", label: "Trade desk", detail: "Serve buyers, record sales", x: 356, y: 114, face: -N },
  ...fixturePlaces("vault"),
  { room: "warehouse", label: "Inventory bays", detail: "Owned items, list for sale", x: WH_OX + 96, y: 150, face: Math.PI },
  ...fixturePlaces("warehouse"),
  ...fixturePlaces("bridge"),
  { room: "shop", label: "Stock shelves", detail: "Your sell orders", x: WH_OX + 96, y: ROW_H + 150, face: Math.PI },
  { room: "shop", label: "Riven case", detail: "Rivens in stock", x: WH_OX + 350, y: ROW_H + 132, face: Math.PI },
  { room: "shop", label: "Wanted wall", detail: "Wish list buy orders", x: WH_OX + 366, y: ROW_H + 84, face: N },
  ...fixturePlaces("shop"),
];
export const ROOM_ORDER: RoomId[] = ["vault", "warehouse", "bridge", "shop"];
export const roomName = (room: RoomId) => ROOMS[room].name;
