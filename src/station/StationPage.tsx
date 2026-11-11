import { Badge, Switch, Text } from "@mantine/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { demoBuyer, demoSale, fetchGoal, subscribeStationEvents } from "./data/bridge";
import { StationGame, type InteractTarget } from "./engine/StationGame";
import { detectSale, type Buyer, type GoalSnapshot } from "./engine/logic";
import { CounterCard, CustomerCard, TankCard } from "./ui/Cards";
import "./station.css";

const POLL_MS = 15000;
const DEBUG_SALE = 25;
const LOW_POWER_KEY = "vt_station_low_power";

type OpenCard = { kind: "tank" } | { kind: "counter" } | { kind: "customer"; buyer: Buyer };

/** Void Trader stage 3: the one-room station. The trading tool as a place you walk around in. */
export default function StationPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<StationGame | null>(null);
  const goalRef = useRef<GoalSnapshot | null>(null);
  const demoRef = useRef(false);
  /** Platinum already celebrated from a trade event, so the next poll does not surge twice. */
  const creditRef = useRef({ amount: 0, at: 0 });
  const reloadRef = useRef<() => void>(() => {});

  const [goal, setGoal] = useState<GoalSnapshot | null>(null);
  const [demo, setDemo] = useState(false);
  const [card, setCard] = useState<OpenCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lowPower, setLowPower] = useState(() => {
    try {
      return localStorage.getItem(LOW_POWER_KEY) === "1";
    } catch {
      return false;
    }
  });

  // --- game lifecycle (safe under StrictMode: destroy() cancels a pending init)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const game = new StationGame(host, {
      onInteract: (target: InteractTarget) => setCard(target),
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
    });
    gameRef.current = game;
    if (goalRef.current) game.setGoal(goalRef.current);
    void game.start();
    return () => {
      game.destroy();
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
    try {
      localStorage.setItem(LOW_POWER_KEY, lowPower ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }, [lowPower]);

  const closeCard = useCallback(() => {
    setCard((open) => {
      if (open?.kind === "customer") gameRef.current?.dismissBuyer(open.buyer.id);
      return null;
    });
  }, []);

  // --- while a card is open the game ignores input; Esc or E closes it
  useEffect(() => {
    gameRef.current?.setInputEnabled(card === null);
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Escape" || e.code === "KeyE") {
        e.preventDefault();
        closeCard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, closeCard]);

  return (
    <div className="vt-station-root">
      <div className="vt-station-host" ref={hostRef}>
        {error && (
          <Text c="orange.4" ta="center" p="md">
            The station could not start its renderer ({error}). The rest of the app still works.
          </Text>
        )}
      </div>
      {card && (
        <div className="vt-station-overlay" onPointerDown={(e) => e.target === e.currentTarget && closeCard()}>
          {card.kind === "customer" && <CustomerCard buyer={card.buyer} onDone={closeCard} />}
          {card.kind === "tank" && <TankCard goal={goal} demo={demo} onClose={closeCard} />}
          {card.kind === "counter" && <CounterCard onClose={closeCard} />}
        </div>
      )}
      <div className="vt-station-footer">
        <div className="vt-station-help">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> / arrows or click to move · <kbd>E</kbd> interact · debug: <kbd>B</kbd> fake buyer, <kbd>G</kbd> fake +{DEBUG_SALE}p sale
        </div>
        <div className="vt-station-hud">
          {demo && (
            <Badge color="orange" variant="light" size="sm">
              Demo data
            </Badge>
          )}
          <Switch size="xs" label="Low power" checked={lowPower} onChange={(e) => setLowPower(e.currentTarget.checked)} />
        </div>
      </div>
    </div>
  );
}
