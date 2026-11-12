import type { MarketStar } from "@api/market";
import { useMemo } from "react";
import type { MarketResult } from "../market/data";
import { movers, plat } from "../market/layout";
import { Frame } from "./Frame";

/**
 * Market Weather, on the observatory's east wall: the day's biggest movers (by the trend signal,
 * among items that trade at least a few times a day) and the busiest items. Engage it and click a
 * row to focus that star.
 */
function Row({ s, onPick, kind }: { s: MarketStar; onPick: (s: MarketStar) => void; kind: "up" | "down" | "busy" }) {
  const pct = Math.round(s.trend * 100);
  const color = kind === "up" ? "#ffc861" : kind === "down" ? "#9d9cff" : "#7fe8f5";
  return (
    <button type="button" className="vtg-row vtg-wrow" onClick={() => onPick(s)} data-vtg-weather-item={s.name}>
      <span className="vtg-grow">{s.name}</span>
      <b style={{ width: 70, textAlign: "right", color: "#ffd36b" }}>{plat(s.median || s.avg_price)}</b>
      <span style={{ width: 84, textAlign: "right", color }}>{kind === "busy" ? `${Math.round(s.volume)}/day` : `${pct > 0 ? "+" : ""}${pct}%`}</span>
    </button>
  );
}

export function WeatherScreen({ market, docked, onPick, onDisengage }: { market: MarketResult | null; docked: boolean; onPick: (s: MarketStar) => void; onDisengage: () => void }) {
  const items = useMemo(() => market?.overview.items ?? [], [market]);
  const m = useMemo(() => movers(items, 7), [items]);
  const rising = items.filter((i) => i.trend_dir === "rising").length;
  const falling = items.filter((i) => i.trend_dir === "falling").length;
  const col = (title: string, sub: string, list: MarketStar[], kind: "up" | "down" | "busy", color: string) => (
    <div className="vtg-wcol">
      <div className="vtg-whead" style={{ color }}>
        {title}
        <span className="vtg-dim" style={{ fontSize: 14, marginLeft: 10, letterSpacing: "0.04em", fontFamily: "Rajdhani, sans-serif" }}>
          {sub}
        </span>
      </div>
      {list.length === 0 && <div className="vtg-dim" style={{ padding: 12 }}>Nothing here yet.</div>}
      {list.map((s) => (
        <Row key={`${kind}:${s.flags.riven ? "r" : "i"}:${s.wfm_url}:${s.name}`} s={s} onPick={onPick} kind={kind} />
      ))}
    </div>
  );
  return (
    <Frame
      title="Market Weather"
      status={
        <>
          {market?.demo && <span className="vtg-chip is-warn">Demo data</span>}
          <span className="vtg-chip is-gold">{rising} rising</span>
          <span className="vtg-chip" style={{ color: "#9d9cff" }}>
            {falling} falling
          </span>
        </>
      }
      onDisengage={onDisengage}
      hint={docked ? <span>Click a row to focus its star</span> : <span>Engage (E) and pick an item to focus it in the Orrery</span>}
    >
      <div style={{ display: "flex", width: "100%", gap: 0 }}>
        {col("Rising", "above their moving average", m.up, "up", "#ffc861")}
        {col("Falling", "below their moving average", m.down, "down", "#9d9cff")}
        {col("Busiest", "trades a day", m.busiest, "busy", "#7fe8f5")}
      </div>
    </Frame>
  );
}
