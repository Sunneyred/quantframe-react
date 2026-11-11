import { Badge, Button, Switch, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { demoBuyer, demoSale, fetchGoal, fetchSellFinder, listForSale, subscribeStationEvents, type SellResult } from "./data/bridge";
import { StationGame, type InteractTarget, type ViewMode } from "./engine/StationGame";
import { detectSale, type Buyer, type GoalSnapshot } from "./engine/logic";
import { layoutWarehouse, type BayKey, type SellCandidate } from "./engine/warehouse";
import { CounterCard, CustomerCard, TankCard } from "./ui/Cards";
import { BayCard, ConnectCard, ItemCard, QuickPanel } from "./ui/Stock";
import "./station.css";

const POLL_MS = 15000;
const DEBUG_SALE = 25;
const LOW_POWER_KEY = "vt_station_low_power";
const VIEW_KEY = "vt_station_view";

type OpenCard =
  | { kind: "tank" }
  | { kind: "counter" }
  | { kind: "customer"; buyer: Buyer }
  | { kind: "item"; id: string }
  | { kind: "bay"; category: BayKey }
  | { kind: "connect" };

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

/** Void Trader station: the trading tool as a place you walk around in, top-down or first person. */
export default function StationPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<StationGame | null>(null);
  const goalRef = useRef<GoalSnapshot | null>(null);
  const demoRef = useRef(false);
  /** Platinum already celebrated from a trade event, so the next poll does not surge twice. */
  const creditRef = useRef({ amount: 0, at: 0 });
  const reloadRef = useRef<() => void>(() => {});
  const sellSeq = useRef(0);
  const aliveRef = useRef(true);

  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [demo, setDemo] = useState(false);
  const [card, setCard] = useState<OpenCard | null>(null);
  const [quick, setQuick] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sell, setSell] = useState<SellResult | null>(null);
  const [sellLoading, setSellLoading] = useState(false);
  const [lowPower, setLowPower] = useState(() => stored(LOW_POWER_KEY) === "1");
  const [view, setView] = useState<ViewMode>(() => (stored(VIEW_KEY) === "fp" ? "fp" : "top"));

  const sellRef = useRef<SellResult | null>(null);
  sellRef.current = sell;
  const viewRef = useRef(view);
  viewRef.current = view;
  const layout = useMemo(() => layoutWarehouse(sell?.result ?? null), [sell]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

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
  const loadSellRef = useRef(loadSell);
  loadSellRef.current = loadSell;

  useEffect(() => {
    aliveRef.current = true;
    void loadSell(false);
    return () => {
      aliveRef.current = false;
    };
  }, [loadSell]);

  /** One explicit listing. Rejects with the backend's reason; on success the crate turns teal at once. */
  const listItem = useCallback(
    async (item: SellCandidate, quantity: number) => {
      await listForSale(item, quantity);
      if (!aliveRef.current) return;
      setSell((prev) => (prev ? { ...prev, result: { ...prev.result, items: prev.result.items.map((i) => (i.unique_name === item.unique_name ? { ...i, in_stock: true } : i)) } } : prev));
      void loadSell(false);
    },
    [loadSell],
  );

  // --- game lifecycle (safe under StrictMode: destroy() cancels a pending init)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new StationGame(host, {
      onInteract: (target: InteractTarget) => {
        if (target.kind === "crate") setCard({ kind: "item", id: target.id });
        else if (target.kind === "terminal") setCard(sellRef.current?.result.connected ? { kind: "bay", category: target.category } : { kind: "connect" });
        else setCard(target);
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
      onRoom: (room) => {
        if (room === "warehouse") void loadSellRef.current(false);
      },
      onToggleView: () => setView((v) => (v === "top" ? "fp" : "top")),
      onQuickPanel: () => setQuick(true),
    });
    gameRef.current = game;
    // dev builds only: a handle for the screenshot scripts
    if (import.meta.env.DEV) (window as unknown as { __vtStation?: StationGame }).__vtStation = game;
    if (goalRef.current) game.setGoal(goalRef.current);
    game.setWarehouse(layoutRef.current);
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
    });
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(refreshTimer);
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

  const closeCard = useCallback(() => {
    setCard((open) => {
      if (open?.kind === "customer") gameRef.current?.dismissBuyer(open.buyer.id);
      return null;
    });
  }, []);

  // --- while a card or the stock list is open the game ignores input (and lets go of the mouse)
  const blocked = card !== null || quick;
  useEffect(() => {
    gameRef.current?.setInputEnabled(!blocked);
    if (!blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = isTyping(e.target);
      if (e.code === "Escape" || (e.code === "KeyE" && !typing && card !== null) || (e.code === "Tab" && quick && card === null)) {
        e.preventDefault();
        // the card is on top of the stock list: close it first
        if (card !== null) closeCard();
        else setQuick(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocked, card, quick, closeCard]);

  const openItem = card?.kind === "item" ? (sell?.result.items.find((i) => i.unique_name === card.id) ?? null) : null;
  const fp = view === "fp";

  return (
    <div className="vt-station-root">
      <div className="vt-station-body">
        <div className="vt-station-host" ref={hostRef}>
          {error && (
            <Text c="orange.4" ta="center" p="md">
              The station could not start its renderer ({error}). The rest of the app still works.
            </Text>
          )}
        </div>
        {quick && <QuickPanel sell={sell} loading={sellLoading} onList={listItem} onRescan={() => void loadSell(true)} onClose={() => setQuick(false)} />}
      </div>
      {card && (
        <div className="vt-station-overlay" onPointerDown={(e) => e.target === e.currentTarget && closeCard()}>
          {card.kind === "customer" && <CustomerCard buyer={card.buyer} onDone={closeCard} />}
          {card.kind === "tank" && <TankCard goal={goal} demo={demo} onClose={closeCard} />}
          {card.kind === "counter" && <CounterCard onClose={closeCard} />}
          {card.kind === "item" && <ItemCard key={card.id} item={openItem} demo={sell?.demo ?? false} onList={listItem} onClose={closeCard} />}
          {card.kind === "bay" && sell && <BayCard sell={sell} category={card.category} onList={listItem} onClose={closeCard} />}
          {card.kind === "connect" && <ConnectCard error={sell?.error} onClose={closeCard} />}
        </div>
      )}
      <div className="vt-station-footer">
        <div className="vt-station-help">
          {fp ? (
            <>
              <kbd>W</kbd>
              <kbd>S</kbd> walk · <kbd>A</kbd>
              <kbd>D</kbd> strafe · mouse or <kbd>←</kbd>
              <kbd>→</kbd> turn
            </>
          ) : (
            <>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> / arrows / click to move
            </>
          )}{" "}
          · <kbd>E</kbd> use · <kbd>Tab</kbd> stock list · <kbd>V</kbd> {fp ? "top-down" : "first person"} · debug <kbd>B</kbd> buyer <kbd>G</kbd> sale
        </div>
        <div className="vt-station-hud">
          {(demo || sell?.demo) && (
            <Badge color="orange" variant="light" size="sm">
              Demo data
            </Badge>
          )}
          <div className="vt-station-tools">
            <Button size="compact-xs" variant="default" onClick={() => setQuick((q) => !q)} data-station-quick>
              Stock list (Tab)
            </Button>
            <Button size="compact-xs" variant="default" onClick={() => setView((v) => (v === "top" ? "fp" : "top"))} data-station-view>
              {fp ? "Top-down (V)" : "First person (V)"}
            </Button>
          </div>
          <Switch size="xs" label="Low power" checked={lowPower} onChange={(e) => setLowPower(e.currentTarget.checked)} />
        </div>
      </div>
    </div>
  );
}
