import { MantineThemeProvider } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { demoBuyer, demoSale, fetchGoal, fetchShop, subscribeStationEvents } from "../station/data/bridge";
import { detectSale, dismissBuyer, enqueueBuyer, type Buyer, type GoalSnapshot } from "../station/engine/logic";
import type { ShopData } from "../station/engine/shop";
import { fontsReady } from "./art/textures";
import { Engine, type EngineStats } from "./core/Engine";
import type { ViewMode } from "./core/player";
import type { Quality } from "./core/quality";
import * as THREE from "three";
import type { MarketStar } from "@api/market";
import { demoUndercut } from "./market/demo";
import { ModalRouter } from "./modalRouter";
import { makeAnnouncement, useNotificationCapture, type Announcement } from "./notify";
import { ObservatoryRoom } from "./rooms/observatory";
import { Ship } from "./rooms/ship";
import { PA_SOUND, VaultRoom } from "./rooms/vault";
import { ConsoleScreen, PAScreen, ReservoirScreen, SignScreen } from "./ui/Ambient";
import { DeskScreen } from "./ui/DeskScreen";
import { MarketConsole } from "./ui/MarketConsole";
import { StockScreen } from "./ui/StockScreen";
import { useMarket } from "./ui/useMarket";
import { WeatherScreen } from "./ui/WeatherScreen";
import "./game.css";

/**
 * The React side of the game. It owns the engine's lifetime (one engine per mount, disposed on
 * unmount, StrictMode safe), reads the same data the station reads (bridge.ts) and pushes it into
 * the room, and renders each screen's content into its in-world element with createPortal, so the
 * screens share every app context (Mantine, router, app state).
 */

const POLL_MS = 15000;
const DEBUG_SALE = 25;
const QUEUE_CAPACITY = 6;

interface Live {
  engine: Engine;
  vault: VaultRoom;
  observatory: ObservatoryRoom;
  ship: Ship;
  modals: ModalRouter;
}

const COMMS = "comms";

export default function GameCore() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);
  const [docked, setDocked] = useState<string | null>(null);
  const [quality, setQualityState] = useState<Quality>("high");
  const [view, setViewState] = useState<ViewMode>("first");
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [demo, setDemo] = useState(false);
  const [queue, setQueue] = useState<Buyer[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [shop, setShop] = useState<ShopData | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const goalRef = useRef<GoalSnapshot | null>(null);
  const demoRef = useRef(false);
  const creditRef = useRef({ amount: 0, at: 0 });
  const reloadRef = useRef<() => void>(() => {});
  const shopSeq = useRef(0);
  const queueRef = useRef<Buyer[]>([]);
  queueRef.current = queue;

  const announce = useCallback((a: Announcement) => {
    setAnnouncements((list) => [a, ...list].slice(0, 12));
    liveRef.current?.engine.audio.play("announce", { position: PA_SOUND, tone: a.tone });
  }, []);
  useNotificationCapture(announce);

  // --- the engine: created on mount, disposed on unmount
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: Engine;
    try {
      engine = new Engine(host);
    } catch (e) {
      console.error("[game] WebGL unavailable", e);
      return;
    }
    const vault = new VaultRoom(engine, {
      onServe: (id) => {
        setSelected(id);
        engine.screens.dock("desk");
      },
      onToggleQuality: () => engine.setQuality(engine.quality === "high" ? "low" : "high"),
    });
    const observatory = new ObservatoryRoom(engine, { onFocus: (star) => focusRef.current(star) });
    const ship = new Ship(engine, vault, observatory);
    engine.setRoom(ship);
    // the Comms display: app modals are routed onto it (see modalRouter.ts); parked and hidden until then
    engine.screens.add({ id: COMMS, title: "Comms", px: [980, 700], width: 1.45, position: new THREE.Vector3(0, -50, 0), yaw: 0, dockable: true, reach: 0, fill: 0.86 });
    engine.screens.setHidden(COMMS, true);
    const modals = new ModalRouter(engine, COMMS);
    const offs = [
      engine.events.on("dock", (id) => {
        setDocked(id);
        if (id === "desk") setSelected((s) => s ?? queueRef.current[0]?.id ?? null);
      }),
      engine.events.on("quality", (q) => {
        setQualityState(q);
        vault.setQuality(q);
      }),
      engine.events.on("view", setViewState),
      engine.events.on("stats", setStats),
      engine.events.on("debug", (what) => {
        if (what === "buyer") addBuyerRef.current(demoBuyer());
        if (what === "sale") {
          if (demoRef.current) {
            demoSale(DEBUG_SALE);
            reloadRef.current();
          } else {
            vault.surge(DEBUG_SALE); // live data: visual only
            announce(makeAnnouncement("Test pour", `+${DEBUG_SALE}p (visual only, your balance is untouched)`, "gold"));
          }
        }
        if (what === "notify") notifications.show({ title: "Test notification", message: "Captured by the vault and announced in the room.", color: "green.7" });
      }),
    ];
    setQualityState(engine.quality);
    setViewState(engine.player.view);
    const l: Live = { engine, vault, observatory, ship, modals };
    liveRef.current = l;
    setLive(l);
    if (goalRef.current) vault.setGoal(goalRef.current);
    // canvas text waits for the app fonts, then the labels are redrawn once
    void fontsReady().then(() => {
      if (liveRef.current !== l) return;
      vault.setQueue(queueRef.current, null);
      setAnnouncements((a) => [...a]);
    });
    engine.start();
    if (import.meta.env.DEV) (window as unknown as { __vtGame?: unknown }).__vtGame = devHandle(l, () => marketRef.current);
    return () => {
      for (const off of offs) off();
      modals.dispose(); // puts Mantine's shared portal node back in <body> before the DOM goes
      engine.dispose(); // also releases pointer lock and removes the canvas and the CSS3D layer
      if (liveRef.current === l) liveRef.current = null;
      setLive(null);
      setDocked(null);
      if (import.meta.env.DEV) delete (window as unknown as { __vtGame?: unknown }).__vtGame;
    };
  }, [announce]);

  // --- buyers
  const addBuyerRef = useRef<(b: Omit<Buyer, "pings">) => void>(() => {});
  addBuyerRef.current = (b) => {
    const res = enqueueBuyer(queueRef.current, b, QUEUE_CAPACITY);
    if (!res.buyer) return;
    queueRef.current = res.queue;
    setQueue(res.queue);
    if (res.added) announce(makeAnnouncement("A buyer is at the desk", `${res.buyer.name}${res.buyer.message ? `: ${res.buyer.message}` : ""}`, "cyan"));
  };
  const dismiss = useCallback((id: string) => {
    setQueue((q) => dismissBuyer(q, id));
    setSelected((s) => (s === id ? null : s));
  }, []);
  useEffect(() => {
    live?.vault.setQueue(queue, docked === "desk" ? selected : selected);
  }, [live, queue, selected, docked]);

  // --- stock
  const loadShop = useCallback(async () => {
    const seq = ++shopSeq.current;
    const res = await fetchShop();
    if (seq === shopSeq.current) setShop(res);
  }, []);
  useEffect(() => {
    void loadShop();
  }, [loadShop]);
  const stockChanged = useCallback(() => {
    void loadShop();
    reloadRef.current();
  }, [loadShop]);

  // --- the vault balance: polling, sale detection and backend events (same rules as the station)
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
        liveRef.current?.vault.setGoal(res.goal);
        if (gain > 0) {
          liveRef.current?.vault.surge(gain);
          announce(makeAnnouncement(`Sale · +${gain.toLocaleString()}p`, `The vault holds ${Math.round(res.goal.platinum).toLocaleString()}p of ${Math.round(res.goal.goal).toLocaleString()}p.`, "gold"));
        }
      } finally {
        busy = false;
      }
    };
    reloadRef.current = () => void load();
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    let refreshTimer = 0;
    let stockTimer = 0;
    const unsubscribe = subscribeStationEvents({
      onBuyer: (b) => addBuyerRef.current(b),
      onSale: (gain, player) => {
        creditRef.current = { amount: creditRef.current.amount + gain, at: Date.now() };
        liveRef.current?.vault.surge(gain);
        announce(makeAnnouncement(`Sale · +${gain.toLocaleString()}p`, player ? `Traded with ${player}.` : "A trade just finished.", "gold"));
      },
      onRefresh: () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void load(), 800);
      },
      onStock: () => {
        window.clearTimeout(stockTimer);
        stockTimer = window.setTimeout(() => void loadShop(), 700);
      },
    });
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearTimeout(refreshTimer);
      window.clearTimeout(stockTimer);
      unsubscribe();
      reloadRef.current = () => {};
    };
  }, [announce, loadShop]);

  // --- the Market Observatory
  const mk = useMarket(live?.observatory ?? null, shop, announce);
  const focusRef = useRef<(s: MarketStar) => void>(() => {});
  focusRef.current = mk.setFocus;
  const marketRef = useRef(mk);
  marketRef.current = mk;
  const marketChanged = useCallback(() => {
    void loadShop();
    reloadRef.current();
    void mk.reloadMarket();
  }, [loadShop, mk.reloadMarket]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickFromWeather = useCallback((s: MarketStar) => {
    mk.setFocus(s);
    liveRef.current?.engine.screens.undock();
  }, [mk.setFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- leaving the route: hide and stop at once, even while React still holds the old tree
  // (a navigation to a lazy route keeps the previous screen until the chunk loads)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const start = window.location.pathname;
    const id = window.setInterval(() => {
      const away = window.location.pathname !== start;
      host.style.visibility = away ? "hidden" : "";
      const e = liveRef.current?.engine;
      if (!e) return;
      if (away) e.stop();
      else if (!document.hidden) e.start();
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  // --- the ticker ring
  useEffect(() => {
    if (!live) return;
    const lines = announcements.slice(0, 5).map((a) => a.text);
    if (goal) {
      lines.push(`Vault ${Math.round(goal.platinum).toLocaleString()}p of ${Math.round(goal.goal).toLocaleString()}p`);
      lines.push(`Today +${Math.round(goal.profit_today).toLocaleString()}p of ${Math.round(goal.daily_target).toLocaleString()}p`);
    }
    lines.push(queue.length ? `${queue.length} at the trade desk` : "The trade desk is open");
    const items = mk.state.market?.overview.items;
    if (items?.length) lines.push(`Market Observatory north: ${items.filter((i) => i.trend_dir === "rising").length} rising, ${items.filter((i) => i.trend_dir === "falling").length} falling`);
    live.vault.setTicker(lines);
  }, [live, announcements, goal, queue.length, mk.state.market]);

  // a first line on the PA display
  useEffect(() => {
    announce(makeAnnouncement("Welcome aboard", "Click to take control · E to engage a screen · V to change camera", "cyan"));
  }, [announce]);

  const undock = useCallback(() => liveRef.current?.engine.screens.undock(), []);
  const onMore = useCallback(() => announce(makeAnnouncement("Stock desk", "Market info: the Market Observatory, north through the arch. Bulk edit: Live Trading in the app.", "cyan")), [announce]);

  const portals = useMemo(() => {
    if (!live) return null;
    const s = live.vault.screens;
    const out: Array<[HTMLElement, string, ReactNode]> = [
      [s.reservoir.content, "reservoir", <ReservoirScreen goal={goal} demo={demo} docked={docked === "reservoir"} onDisengage={undock} />],
      [
        s.desk.content,
        "desk",
        <DeskScreen queue={queue} selected={selected} items={shop?.items ?? []} docked={docked === "desk"} onSelect={setSelected} onDismiss={dismiss} onChanged={stockChanged} onDisengage={undock} />,
      ],
      [s.stock.content, "stock", <StockScreen shop={shop} docked={docked === "stock"} onChanged={stockChanged} onMore={onMore} onDisengage={undock} />],
      [s.pa.content, "pa", <PAScreen items={announcements} />],
      [s.sign.content, "sign", <SignScreen />],
      [
        s.console.content,
        "console",
        <ConsoleScreen quality={quality} view={view} stats={stats} docked={docked === "console"} onQuality={(q) => live.engine.setQuality(q)} onView={(v) => live.engine.setView(v)} onDisengage={undock} />,
      ],
      [
        live.observatory.screens.market.content,
        "market",
        <MarketConsole
          market={mk.state.market}
          shop={shop}
          focus={mk.state.focus}
          book={mk.state.book}
          bookLoading={mk.state.bookLoading}
          bookError={mk.state.bookError}
          history={mk.state.history}
          filter={mk.state.filter}
          docked={docked === "market"}
          onFilter={mk.setFilter}
          onFocus={mk.setFocus}
          onRefresh={mk.refreshBook}
          onVariant={mk.setVariant}
          onChanged={marketChanged}
          onMore={onMore}
          onDisengage={undock}
        />,
      ],
      [live.observatory.screens.weather.content, "weather", <WeatherScreen market={mk.state.market} docked={docked === "weather"} onPick={pickFromWeather} onDisengage={undock} />],
    ];
    return out.map(([el, id, node]) =>
      createPortal(
        // any Mantine portal (dropdowns, tooltips) opened on a screen stays on that screen
        <MantineThemeProvider theme={{ components: { Portal: { defaultProps: { target: `[data-screen="${id}"] .vtg-screen-content` } } } }}>{node}</MantineThemeProvider>,
        el,
        id,
      ),
    );
  }, [live, goal, demo, docked, queue, selected, shop, announcements, quality, view, stats, dismiss, stockChanged, undock, onMore, mk.state, mk.setFilter, mk.setFocus, mk.refreshBook, mk.setVariant, marketChanged, pickFromWeather]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={hostRef} className="vtg-host" data-vtg-host>
      {portals}
    </div>
  );
}

/**
 * Dev-only handle for tests and the console (`window.__vtGame`): the engine and rooms, plus
 * helpers to move the player, aim at things and drive the observatory.
 */
function devHandle(l: Live, market: () => ReturnType<typeof useMarket>) {
  const { engine, ship, observatory } = l;
  const aimAt = (target: THREE.Vector3) => {
    const eye = engine.player.eye(new THREE.Vector3());
    const d = target.clone().sub(eye);
    engine.player.yaw = Math.atan2(-d.x, -d.z);
    engine.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  };
  return {
    ...l,
    get where() {
      return ship.where;
    },
    place: (x: number, z: number, yaw = 0) => engine.player.place(x, z, yaw),
    aimAt: (x: number, y: number, z: number) => aimAt(new THREE.Vector3(x, y, z)),
    /** Aim the reticle at a star (the player must be within reach). */
    aimAtStar: (url: string) => {
      const p = observatory.orrery.starWorld(url);
      if (p) aimAt(p);
      return p ? [p.x, p.y, p.z] : null;
    },
    /** Open a modal through the app's ModalsProvider, as app code does (tests the routing onto Comms). */
    openTestModal: () =>
      modals.openConfirmModal({ title: "A modal from the app", children: "Opened by the app outside the game tree, shown on the Comms display.", labels: { confirm: "Confirm", cancel: "Cancel" } }),
    market: {
      get state() {
        return market().state;
      },
      focus: (url: string) => market().focusUrl(url)?.wfm_url ?? null,
      refresh: () => market().refreshBook(),
      /** Demo data only: the next refresh brings an in-game seller under your order. */
      undercut: (url: string) => demoUndercut(url),
      get hovered() {
        const i = observatory.orrery.hovered;
        return i >= 0 ? (market().state.market?.overview.items[i]?.wfm_url ?? null) : null;
      },
      get undercutActive() {
        return observatory.spire.undercutActive;
      },
    },
  };
}
