import { Badge, Button, Switch, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { demoBuyer, demoFlag, demoSale, fetchGoal, fetchSellFinder, fetchShop, listForSale, subscribeStationEvents, type SellResult } from "./data/bridge";
import { StationGame, type InteractTarget, type ViewMode } from "./engine/StationGame";
import { ROOMS, type FixtureId, type RoomId } from "./engine/constants";
import { dialogOpen } from "./engine/input";
import type { TraderState } from "./engine/lowerRooms";
import { detectSale, type Buyer, type GoalSnapshot } from "./engine/logic";
import { layoutShop, rivenName, statusText, subTypeText, type ShopData } from "./engine/shop";
import { layoutWarehouse, type BayKey, type SellCandidate } from "./engine/warehouse";
import { markStarted, setStartInStation, startInStation } from "./startup";
import { CounterCard, CustomerCard, TankCard } from "./ui/Cards";
import { DocksCard, HelpOverlay, HoloPanel, ManagerCard, MapOverlay, Palette, PanelPlaceholder, type Command } from "./ui/Overlays";
import { RecordSale, RivenCard, StockCard, WishCard } from "./ui/Shop";
import { BayCard, ConnectCard, ItemCard, QuickPanel } from "./ui/Stock";
import { PANELS, PANEL_IDS, PLACES, ROOM_ORDER, panelOfFixture, roomName, type PanelId, type Place } from "./ui/panels";
import "./station.css";

const POLL_MS = 15000;
const DEBUG_SALE = 25;
const LOW_POWER_KEY = "vt_station_low_power";
const VIEW_KEY = "vt_station_view";

/** What the app gives the station when it runs inside it (absent on the standalone dev page). */
export interface StationHost {
  /** Live trader state, from the same context the classic start/stop button reads. */
  trader: TraderState;
  /** Starting will first ask for confirmation in a dialog. */
  startAsks: boolean;
  /** Start or stop the live trader, exactly like the classic button. */
  toggleTrader(): void;
  /** The real screen for a terminal. */
  renderPanel(id: PanelId, close: () => void): ReactNode;
  /** The strategy controls for the manager. */
  renderStrategy(): ReactNode;
  /** Leave the station for a classic page. */
  classic(path: string): void;
  /** Unread warframe.market chat messages. */
  unread: number;
}

type OpenCard =
  | { kind: "tank" }
  | { kind: "counter" }
  | { kind: "customer"; buyer: Buyer }
  | { kind: "item"; id: string }
  | { kind: "bay"; category: BayKey }
  | { kind: "connect" }
  | { kind: "stock"; id: number }
  | { kind: "riven"; id: number }
  | { kind: "wish"; id: number }
  | { kind: "manager" }
  | { kind: "docks" };

type Overlay = "map" | "palette" | "help";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

const DEMO_CHECKS = ["Glaive Prime Set", "Nova Prime Set", "Kronen Prime Set", "Primed Continuity", "Arcane Energize", "Blind Rage", "Maiming Strike"];

/** Void Trader station: the whole trading tool as a place you walk around in, top-down or first person. */
export default function StationCore({ host }: { host?: StationHost }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<StationGame | null>(null);
  const goalRef = useRef<GoalSnapshot | null>(null);
  const demoRef = useRef(false);
  /** Platinum already celebrated from a trade event, so the next poll does not surge twice. */
  const creditRef = useRef({ amount: 0, at: 0 });
  const reloadRef = useRef<() => void>(() => {});
  const sellSeq = useRef(0);
  const shopSeq = useRef(0);
  const aliveRef = useRef(true);

  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [demo, setDemo] = useState(false);
  const [card, setCard] = useState<OpenCard | null>(null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [quick, setQuick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sell, setSell] = useState<SellResult | null>(null);
  const [sellLoading, setSellLoading] = useState(false);
  const [shop, setShop] = useState<ShopData | null>(null);
  const [room, setRoom] = useState<RoomId>("vault");
  const [lowPower, setLowPower] = useState(() => stored(LOW_POWER_KEY) === "1");
  const [view, setView] = useState<ViewMode>(() => (stored(VIEW_KEY) === "fp" ? "fp" : "top"));
  const [autoStart, setAutoStart] = useState(() => startInStation());
  const [demoTrader, setDemoTrader] = useState<TraderState>(() => ({ running: demoFlag("running"), message: "" }));

  const sellRef = useRef<SellResult | null>(null);
  sellRef.current = sell;
  const viewRef = useRef(view);
  viewRef.current = view;
  const layout = useMemo(() => layoutWarehouse(sell?.result ?? null), [sell]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const shopLayout = useMemo(() => layoutShop(shop), [shop]);
  const shopLayoutRef = useRef(shopLayout);
  shopLayoutRef.current = shopLayout;

  const trader = host?.trader ?? demoTrader;
  const traderRef = useRef(trader);
  traderRef.current = trader;
  const trades = sell?.result.connected ? sell.result.trades_remaining : null;
  const tradesRef = useRef(trades);
  tradesRef.current = trades;

  // opening the station counts as "the app has started": Home is the home page from here on
  useEffect(() => markStarted(), []);

  // --- warehouse stock: read on mount, on walking in and after each listing. Never on a timer.
  const loadSell = useCallback(async (rescan: boolean) => {
    const seq = ++sellSeq.current;
    setSellLoading(true);
    try {
      const res = await fetchSellFinder(rescan);
      // a newer read is already on its way: let that one win
      if (aliveRef.current && seq === sellSeq.current) setSell(res);
    } finally {
      if (aliveRef.current && seq === sellSeq.current) setSellLoading(false);
    }
  }, []);

  // --- shop floor stock: read on mount, on walking in, after each action and when the backend says it changed
  const loadShop = useCallback(async () => {
    const seq = ++shopSeq.current;
    const res = await fetchShop();
    if (aliveRef.current && seq === shopSeq.current) setShop(res);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void loadSell(false);
    void loadShop();
    return () => {
      aliveRef.current = false;
    };
  }, [loadSell, loadShop]);

  /** One explicit listing. Rejects with the backend's reason; on success the crate turns teal at once. */
  const listItem = useCallback(
    async (item: SellCandidate, quantity: number) => {
      await listForSale(item, quantity);
      if (!aliveRef.current) return;
      setSell((prev) => (prev ? { ...prev, result: { ...prev.result, items: prev.result.items.map((i) => (i.unique_name === item.unique_name ? { ...i, in_stock: true } : i)) } } : prev));
      void loadSell(false);
      void loadShop();
    },
    [loadSell, loadShop],
  );

  /** A shop card changed something: re-read the shelves, the vault and the warehouse's "listed" marks. */
  const stockChanged = useCallback(() => {
    void loadShop();
    void loadSell(false);
    reloadRef.current();
  }, [loadShop, loadSell]);

  // --- opening things: one card or one panel at a time
  const openCard = useCallback((next: OpenCard) => {
    setOverlay(null);
    setPanel(null);
    setCard(next);
  }, []);
  const openPanel = useCallback((id: PanelId) => {
    setOverlay(null);
    setCard(null);
    setQuick(false);
    setPanel(id);
  }, []);

  const toggleTrader = useCallback(() => {
    if (host) {
      // the confirmation dialog needs the mouse
      if (host.startAsks && !host.trader.running) gameRef.current?.releasePointer();
      host.toggleTrader();
    } else {
      setDemoTrader((t) => ({ running: !t.running, message: "" }));
    }
  }, [host]);

  const useFixture = useCallback(
    (id: FixtureId) => {
      if (id === "lever") return toggleTrader();
      if (id === "manager") return openCard({ kind: "manager" });
      if (id === "docks") return openCard({ kind: "docks" });
      const p = panelOfFixture(id);
      if (p) openPanel(p);
    },
    [toggleTrader, openCard, openPanel],
  );

  /** The game is created once; it reaches the current handlers through this ref. */
  const handlers = { useFixture, openCard, loadSell, loadShop };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // demo trader: a status line that moves, like the real one
  useEffect(() => {
    if (host || !demoTrader.running) return;
    let i = 0;
    const tick = () => {
      i++;
      setDemoTrader((t) => (t.running ? { running: true, message: `Checking Item: ${DEMO_CHECKS[i % DEMO_CHECKS.length]} ${(i % DEMO_CHECKS.length) + 1}/${DEMO_CHECKS.length}` } : t));
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [host, demoTrader.running]);

  // --- game lifecycle (safe under StrictMode: destroy() cancels a pending init)
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const game = new StationGame(el, {
      onInteract: (target: InteractTarget) => {
        const h = handlersRef.current;
        switch (target.kind) {
          case "crate":
            return h.openCard({ kind: "item", id: target.id });
          case "terminal":
            return h.openCard(sellRef.current?.result.connected ? { kind: "bay", category: target.category } : { kind: "connect" });
          case "fixture":
            return h.useFixture(target.id);
          default:
            return h.openCard(target);
        }
      },
      onDebugBuyer: () => game.addBuyer(demoBuyer()),
      onDebugSale: () => {
        if (demoRef.current) {
          demoSale(DEBUG_SALE); // moves the demo balance; the reload below detects it like a real sale
          reloadRef.current();
        } else {
          game.surge(DEBUG_SALE); // live data: visual only, the real level is untouched
        }
      },
      onError: (message) => setError(message),
      onRoom: (next) => {
        setRoom(next);
        if (next === "warehouse") void handlersRef.current.loadSell(false);
        if (next === "shop") void handlersRef.current.loadShop();
      },
      onToggleView: () => setView((v) => (v === "top" ? "fp" : "top")),
      onQuickPanel: () => setQuick(true),
      onOverlay: (which) => setOverlay(which),
    });
    gameRef.current = game;
    // dev builds only: a handle for the screenshot scripts
    if (import.meta.env.DEV) (window as unknown as { __vtStation?: StationGame }).__vtStation = game;
    if (goalRef.current) game.setGoal(goalRef.current);
    game.setWarehouse(layoutRef.current);
    game.setShop(shopLayoutRef.current);
    game.setTrader(traderRef.current);
    game.setTrades(tradesRef.current);
    game.setView(viewRef.current);
    void game.start();
    return () => {
      game.destroy(); // also releases pointer lock
      if (gameRef.current === game) gameRef.current = null;
    };
  }, []);

  // --- vault polling, sale detection and backend events
  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetchGoal();
        if (!alive) return;
        const prev = goalRef.current;
        // a switch between demo and live numbers is not a sale
        let gain = prev && demoRef.current === res.demo ? detectSale(prev, res.goal) : 0;
        const credit = creditRef.current;
        if (Date.now() - credit.at > 120000) credit.amount = 0;
        const used = Math.min(gain, credit.amount);
        credit.amount -= used;
        gain -= used;
        goalRef.current = res.goal;
        demoRef.current = res.demo;
        setGoal(res.goal);
        setDemo(res.demo);
        gameRef.current?.setGoal(res.goal);
        if (gain > 0) gameRef.current?.surge(gain);
      } finally {
        busy = false;
      }
    };
    reloadRef.current = () => void load();
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    let refreshTimer = 0;
    let stockTimer = 0;
    const unsubscribe = subscribeStationEvents({
      onBuyer: (buyer) => gameRef.current?.addBuyer(buyer),
      onSale: (gain) => {
        creditRef.current = { amount: creditRef.current.amount + gain, at: Date.now() };
        gameRef.current?.surge(gain);
      },
      onRefresh: () => {
        // give the backend a moment to write the transaction before re-reading the vault
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void load(), 800);
      },
      onStock: () => {
        // the trader touches many rows in a row: read the shelves once it pauses
        window.clearTimeout(stockTimer);
        stockTimer = window.setTimeout(() => void handlersRef.current.loadShop(), 700);
      },
    });
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(refreshTimer);
      window.clearTimeout(stockTimer);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribe();
      reloadRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    gameRef.current?.setLowPower(lowPower);
    store(LOW_POWER_KEY, lowPower ? "1" : "0");
  }, [lowPower]);

  useEffect(() => {
    gameRef.current?.setView(view);
    store(VIEW_KEY, view);
  }, [view]);

  useEffect(() => {
    gameRef.current?.setWarehouse(layout);
  }, [layout]);

  useEffect(() => {
    gameRef.current?.setShop(shopLayout);
  }, [shopLayout]);

  useEffect(() => {
    gameRef.current?.setTrader(trader);
  }, [trader]);

  useEffect(() => {
    gameRef.current?.setTrades(trades);
  }, [trades]);

  const unread = host?.unread ?? 0;
  useEffect(() => {
    gameRef.current?.setAlert("comms", unread > 0);
  }, [unread]);

  const closeCard = useCallback(() => {
    setCard((open) => {
      if (open?.kind === "customer") gameRef.current?.dismissBuyer(open.buyer.id);
      return null;
    });
  }, []);

  // a full-screen panel hides the station: stop drawing and simulating it meanwhile
  useEffect(() => {
    gameRef.current?.setPaused(panel !== null);
  }, [panel]);

  // --- while anything is open the game ignores input (and lets go of the mouse)
  const blocked = card !== null || quick || panel !== null || overlay !== null;
  useEffect(() => {
    gameRef.current?.setInputEnabled(!blocked);
    if (!blocked) return;
    const onKey = (e: KeyboardEvent) => {
      // an app dialog on top (confirm, details) owns the keyboard
      if (e.repeat || dialogOpen()) return;
      const typing = isTyping(e.target);
      if (e.code === "Escape") {
        e.preventDefault();
        // close the topmost thing only
        if (overlay !== null) setOverlay(null);
        else if (card !== null) closeCard();
        else if (panel !== null) {
          // first Esc leaves a text field, the next one closes the panel
          if (typing) (e.target as HTMLElement).blur();
          else setPanel(null);
        } else setQuick(false);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (overlay === "map" && e.code === "KeyM") setOverlay(null);
      else if (overlay === "help" && (e.code === "KeyH" || e.key === "?")) setOverlay(null);
      else if (overlay === null && panel === null && card !== null && e.code === "KeyE") {
        e.preventDefault();
        closeCard();
      } else if (overlay === null && panel === null && card === null && quick && e.code === "Tab") {
        e.preventDefault();
        setQuick(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocked, card, quick, panel, overlay, closeCard]);

  const travel = useCallback((place: Place) => {
    setOverlay(null);
    gameRef.current?.travelTo(place.x, place.y, place.face);
  }, []);
  const travelRoom = useCallback((next: RoomId) => {
    setOverlay(null);
    gameRef.current?.travelToRoom(next);
  }, []);
  const changeAutoStart = useCallback((on: boolean) => {
    setStartInStation(on);
    setAutoStart(on);
  }, []);

  const fp = view === "fp";
  const debugKeys = demo || import.meta.env.DEV;

  // --- "do anything": every function of the station and of the app, by name
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "trader", group: "Trading", label: trader.running ? "Stop the live trader" : "Start the live trader", hint: "Trader lever, Control Deck", keywords: "live scraper start stop run lever power", run: toggleTrader },
      { id: "strategy", group: "Trading", label: "Strategy: presets and smart trader", hint: "The manager, Control Deck", keywords: "preset scavenger flipper high roller riven hunter liquidate smart adjustments", run: () => openCard({ kind: "manager" }) },
      {
        id: "serve",
        group: "Trading",
        label: "Serve the next customer",
        hint: "Trade desk, Vault",
        keywords: "buyer whisper invite sale",
        run: () => {
          const buyer = gameRef.current?.nextBuyer ?? null;
          openCard(buyer ? { kind: "customer", buyer } : { kind: "counter" });
        },
      },
      { id: "vault", group: "Trading", label: "Vault: balance and plat goal", hint: "Plat tank, Vault", keywords: "platinum goal progress today", run: () => openCard({ kind: "tank" }) },
      { id: "docks", group: "Trading", label: "Trades left today", hint: "Docks board, Control Deck", keywords: "trades remaining mastery", run: () => openCard({ kind: "docks" }) },
      { id: "quick", group: "Trading", label: "Inventory list: list owned items for sale", hint: "Warehouse", keywords: "warehouse stock list sell finder top", run: () => setQuick(true) },
      { id: "rescan", group: "Trading", label: "Rescan the inventory", hint: "Warehouse", keywords: "refresh alecaframe reload", run: () => void loadSell(true) },
      ...PANEL_IDS.map((id): Command => ({ id: `panel-${id}`, group: "Screens", label: PANELS[id].title, hint: PANELS[id].what, keywords: PANELS[id].keywords, run: () => openPanel(id) })),
      ...ROOM_ORDER.map((r): Command => ({ id: `room-${r}`, group: "Go to", label: `Go to the ${roomName(r)}`, hint: "Room", keywords: "travel teleport room", run: () => travelRoom(r) })),
      ...PLACES.map((p): Command => ({ id: `place-${p.room}-${p.label}`, group: "Go to", label: `Go to: ${p.label}`, hint: `${roomName(p.room)} · ${p.detail}`, keywords: "travel teleport", run: () => travel(p) })),
      { id: "view", group: "Station", label: fp ? "Switch to top-down view" : "Switch to first person", hint: "V", keywords: "view camera first person top down", run: () => setView((v) => (v === "top" ? "fp" : "top")) },
      { id: "map", group: "Station", label: "Station map", hint: "M", keywords: "fast travel rooms", run: () => setOverlay("map") },
      { id: "help", group: "Station", label: "Controls and help", hint: "H", keywords: "keys shortcuts", run: () => setOverlay("help") },
      { id: "low", group: "Station", label: lowPower ? "Low power: turn off" : "Low power: turn on", hint: "30 fps, lighter effects", keywords: "performance fps", run: () => setLowPower((v) => !v) },
      { id: "autostart", group: "Station", label: autoStart ? "Open the app in the classic view from now on" : "Open the app in the station from now on", hint: "Startup setting", keywords: "startup launch default", run: () => changeAutoStart(!autoStart) },
    ];
    if (host) list.push({ id: "classic", group: "Station", label: "Leave to the classic view", hint: "Home page; the Station button in the side bar brings you back", keywords: "exit quit pages", run: () => host.classic("/") });
    if (debugKeys) {
      list.push(
        { id: "debug-buyer", group: "Station", label: "Test: send in a pretend buyer", hint: "B", run: () => gameRef.current?.addBuyer(demoBuyer()) },
        { id: "debug-sale", group: "Station", label: "Test: play a pretend sale", hint: "G", run: () => gameRef.current?.surge(DEBUG_SALE) },
      );
    }
    for (const it of shop?.items ?? []) {
      const sub = subTypeText(it.sub_type);
      list.push({ id: `stock-${it.id}`, group: "Stock", label: `Sell or edit: ${it.item_name}${sub ? ` (${sub})` : ""}`, hint: `${it.owned} in stock · ${statusText(it.status)}${it.list_price ? ` · ${it.list_price}p` : ""}`, keywords: "stock item sell order", run: () => openCard({ kind: "stock", id: it.id }) });
    }
    for (const r of shop?.rivens ?? []) {
      list.push({ id: `riven-${r.id}`, group: "Stock", label: `Riven: ${rivenName(r)}`, hint: `${statusText(r.status)}${r.list_price ? ` · ${r.list_price}p` : ""}`, keywords: "stock riven sell", run: () => openCard({ kind: "riven", id: r.id }) });
    }
    for (const w of shop?.wishes ?? []) {
      list.push({ id: `wish-${w.id}`, group: "Stock", label: `Wanted: ${w.item_name}`, hint: `${w.quantity} wanted · ${statusText(w.status)}`, keywords: "wish list buy order bought", run: () => openCard({ kind: "wish", id: w.id }) });
    }
    return list;
  }, [trader.running, toggleTrader, openCard, openPanel, loadSell, travel, travelRoom, fp, lowPower, autoStart, changeAutoStart, host, debugKeys, shop]);

  const openItem = card?.kind === "item" ? (sell?.result.items.find((i) => i.unique_name === card.id) ?? null) : null;
  const shopDemo = shop?.demo ?? false;
  const openLive = () => openPanel("live");

  return (
    <div className="vt-station-root" data-station-room={room}>
      <div className="vt-station-body">
        <div className="vt-station-host" ref={hostRef}>
          {error && (
            <Text c="orange.4" ta="center" p="md">
              The station could not start its renderer ({error}). Every screen still opens from the "Do anything" list below.
            </Text>
          )}
        </div>
        {quick && <QuickPanel sell={sell} loading={sellLoading} onList={listItem} onRescan={() => void loadSell(true)} onClose={() => setQuick(false)} />}
      </div>
      {card && (
        <div className="vt-station-overlay" onPointerDown={(e) => e.target === e.currentTarget && closeCard()}>
          {card.kind === "customer" && (
            <CustomerCard buyer={card.buyer} onDone={closeCard}>
              <RecordSale key={card.buyer.id} buyer={card.buyer} items={shop?.items ?? []} onChanged={stockChanged} />
            </CustomerCard>
          )}
          {card.kind === "tank" && <TankCard goal={goal} demo={demo} onClose={closeCard} />}
          {card.kind === "counter" && <CounterCard onClose={closeCard} />}
          {card.kind === "item" && <ItemCard key={card.id} item={openItem} demo={sell?.demo ?? false} onList={listItem} onClose={closeCard} />}
          {card.kind === "bay" && sell && <BayCard sell={sell} category={card.category} onList={listItem} onClose={closeCard} />}
          {card.kind === "connect" && <ConnectCard error={sell?.error} onClose={closeCard} />}
          {card.kind === "stock" && <StockCard key={card.id} item={shop?.items.find((i) => i.id === card.id) ?? null} demo={shopDemo} onChanged={stockChanged} onMore={openLive} onClose={closeCard} />}
          {card.kind === "riven" && <RivenCard key={card.id} riven={shop?.rivens.find((i) => i.id === card.id) ?? null} demo={shopDemo} onChanged={stockChanged} onMore={openLive} onClose={closeCard} />}
          {card.kind === "wish" && <WishCard key={card.id} wish={shop?.wishes.find((i) => i.id === card.id) ?? null} demo={shopDemo} onChanged={stockChanged} onMore={openLive} onClose={closeCard} />}
          {card.kind === "manager" && <ManagerCard strategy={host ? host.renderStrategy() : null} trader={trader} onToggleTrader={toggleTrader} onClose={closeCard} />}
          {card.kind === "docks" && <DocksCard trades={trades} mastery={sell?.result.connected ? sell.result.mastery_rank : null} connected={sell?.result.connected ?? false} onScanner={() => openPanel("scanner")} onClose={closeCard} />}
        </div>
      )}
      <div className="vt-station-footer">
        <div className="vt-station-help">
          {fp ? (
            <>
              <kbd>W</kbd>
              <kbd>S</kbd> walk · <kbd>A</kbd>
              <kbd>D</kbd> strafe · mouse turn
            </>
          ) : (
            <>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> / click move
            </>
          )}{" "}
          · <kbd>E</kbd> use
        </div>
        <div className="vt-station-hud">
          <Badge color="yellow" variant="outline" size="sm" data-station-room-badge>
            {ROOMS[room].name}
          </Badge>
          <Badge color={trader.running ? "teal" : "gray"} variant="light" size="sm" data-station-trader-badge>
            Trader {trader.running ? "running" : "off"}
          </Badge>
          {(demo || sell?.demo || shopDemo) && (
            <Badge color="orange" variant="light" size="sm">
              Demo data
            </Badge>
          )}
          <div className="vt-station-tools">
            <Button size="compact-xs" variant="default" onClick={() => setOverlay((o) => (o === "map" ? null : "map"))} data-station-map-button>
              Map (M)
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setOverlay((o) => (o === "palette" ? null : "palette"))} data-station-palette-button>
              Do anything (K)
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setQuick((q) => !q)} data-station-quick>
              Stock list (Tab)
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setView((v) => (v === "top" ? "fp" : "top"))} data-station-view>
              {fp ? "Top-down (V)" : "First person (V)"}
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setOverlay((o) => (o === "help" ? null : "help"))} data-station-help-button>
              Help (H)
            </Button>
            {host && (
              <Button size="compact-xs" variant="outline" color="yellow" onClick={() => host.classic("/")} data-station-classic>
                Classic view
              </Button>
            )}
          </div>
          <Switch size="xs" label="Low power" checked={lowPower} onChange={(e) => setLowPower(e.currentTarget.checked)} />
        </div>
      </div>
      {panel && (
        <HoloPanel id={panel} onClose={() => setPanel(null)} onClassic={host && PANELS[panel].classic ? () => host.classic(PANELS[panel].classic) : undefined}>
          {host ? host.renderPanel(panel, () => setPanel(null)) : <PanelPlaceholder id={panel} />}
        </HoloPanel>
      )}
      {overlay && (
        <div className="vt-station-overlay vt-station-overlay-top" onPointerDown={(e) => e.target === e.currentTarget && setOverlay(null)}>
          {overlay === "map" && <MapOverlay current={room} onTravel={travel} onRoom={travelRoom} onClose={() => setOverlay(null)} />}
          {overlay === "palette" && <Palette commands={commands} onClose={() => setOverlay(null)} />}
          {overlay === "help" && <HelpOverlay fp={fp} startInStation={autoStart} onStartInStation={changeAutoStart} lowPower={lowPower} onLowPower={setLowPower} debugKeys={debugKeys} onClose={() => setOverlay(null)} />}
        </div>
      )}
    </div>
  );
}
