import type { EngineStats } from "../core/Engine";
import type { ViewMode } from "../core/player";
import type { Quality } from "../core/quality";
import { CYAN, GOLD, glyphStripURL } from "../art/textures";
import type { GoalSnapshot } from "../../station/engine/logic";
import type { Announcement } from "../notify";
import { fmt, Frame } from "./Frame";

const TONE: Record<Announcement["tone"], string> = { gold: "#ffd36b", cyan: "#7fe8f5", green: "#5df2b8", red: "#ff7a8a" };

/** The readout etched into the reservoir's lectern: balance, goal, today against the daily target. */
export function ReservoirScreen({ goal, demo, docked, onDisengage }: { goal: GoalSnapshot | null; demo: boolean; docked: boolean; onDisengage: () => void }) {
  if (!goal) {
    return (
      <Frame title="Plat Reservoir" onDisengage={onDisengage}>
        <div className="vtg-dim" style={{ margin: "auto", fontSize: 24 }}>
          Reading the vault...
        </div>
      </Frame>
    );
  }
  const toGo = Math.max(0, goal.goal - goal.platinum);
  const pct = Math.round(goal.progress * 100);
  const todayPct = goal.daily_target > 0 ? Math.min(100, Math.max(0, (goal.profit_today / goal.daily_target) * 100)) : 0;
  const pace = goal.avg_daily_profit && goal.avg_daily_profit > 0 ? Math.ceil(toGo / goal.avg_daily_profit) : null;
  const note = demo ? "Demo data: the backend did not answer." : !goal.balance_is_live ? "Typed in: no live inventory data, this is the plat you entered." : null;
  return (
    <Frame
      title="Plat Reservoir"
      status={<span className={`vtg-chip ${demo || !goal.balance_is_live ? "is-warn" : "is-ok"}`}>{demo ? "Demo" : goal.balance_is_live ? "Live balance" : "Typed in"}</span>}
      onDisengage={onDisengage}
      hint={docked ? undefined : <span>{note ?? `${pct}% of the goal`}</span>}
    >
      <div style={{ display: "flex", width: "100%", padding: "12px 22px", gap: 26, alignItems: "center" }}>
        <div style={{ flex: 1.1 }}>
          <span className="vtg-label">In the vault</span>
          <div className="vtg-big" style={{ fontSize: 66, marginTop: 6 }} data-vtg-plat>
            {fmt(goal.platinum)}
            <span style={{ fontSize: 34 }}>p</span>
          </div>
          <div style={{ fontSize: 20, marginTop: 8 }}>
            <span className="vtg-dim">goal</span> <b style={{ color: "#ffe39a" }}>{fmt(goal.goal)}p</b> <span className="vtg-dim">· {fmt(toGo)}p to go{pace ? ` · ~${pace}d at your pace` : ""}</span>
          </div>
          <div className="vtg-bar" style={{ marginTop: 10 }}>
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div style={{ flex: 0.9 }}>
          <span className="vtg-label">Today</span>
          <div className="vtg-big" style={{ fontSize: 44, marginTop: 6, color: goal.profit_today >= goal.daily_target && goal.daily_target > 0 ? "#5df2b8" : "#9ff3ff", textShadow: "0 0 16px rgba(42,212,230,0.5)" }}>
            +{fmt(goal.profit_today)}p
          </div>
          <div style={{ fontSize: 20, marginTop: 8 }}>
            <span className="vtg-dim">daily target</span> <b>{fmt(goal.daily_target)}p</b>
          </div>
          <div className="vtg-bar is-cyan" style={{ marginTop: 10 }}>
            <i style={{ width: `${todayPct}%` }} />
          </div>
          {note && docked && <div style={{ fontSize: 15, marginTop: 10, color: "#ffb37a" }}>{note}</div>}
        </div>
      </div>
    </Frame>
  );
}

/** The PA display: the latest announcement, large, and the two before it. */
export function PAScreen({ items }: { items: Announcement[] }) {
  const [latest, ...rest] = items;
  return (
    <div className="vtg-pa vtg-flicker">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span className="vtg-label" style={{ fontSize: 15 }}>
          Vault address
        </span>
        <span className="vtg-glyphs" style={{ backgroundImage: `url(${glyphStripURL(30, CYAN, 18, 9)})`, height: 18 }} />
      </div>
      {latest ? (
        <div key={latest.id} className="vtg-new" style={{ marginTop: 10 }} data-vtg-pa-latest>
          <div style={{ fontFamily: "Orbitron, sans-serif", fontWeight: 600, fontSize: 40, color: TONE[latest.tone], textShadow: `0 0 18px ${TONE[latest.tone]}88`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {latest.title || latest.text}
          </div>
          {latest.title ? <div style={{ fontSize: 28, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{latest.message}</div> : null}
        </div>
      ) : (
        <div className="vtg-dim" style={{ fontSize: 30, marginTop: 10 }}>
          All quiet.
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", gap: 24, fontSize: 19 }} className="vtg-dim">
        {rest.slice(0, 2).map((a) => (
          <span key={a.id} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 500 }}>
            <b style={{ color: TONE[a.tone] }}>{new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</b> {a.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The plaque over the sealed door to the next sector. */
export function SignScreen() {
  return (
    <div className="vtg-sign">
      <div style={{ height: 22, width: "80%", backgroundImage: `url(${glyphStripURL(34, GOLD, 22, 3)})`, backgroundRepeat: "repeat-x", backgroundSize: "auto 22px", opacity: 0.7 }} />
      <div style={{ fontFamily: "Orbitron, sans-serif", fontWeight: 600, fontSize: 54, letterSpacing: "0.2em", color: GOLD, textShadow: "0 0 16px rgba(232,193,90,0.6)", marginTop: 8 }}>SECTOR II</div>
      <div style={{ fontSize: 30, letterSpacing: "0.3em", color: "#9fefff", marginTop: 2 }} className="vtg-pulse">
        MARKET OBSERVATORY · SEALED
      </div>
    </div>
  );
}

/** The fidelity console: render quality, camera, controls, and live render figures. */
export function ConsoleScreen({
  quality,
  view,
  stats,
  docked,
  onQuality,
  onView,
  onDisengage,
}: {
  quality: Quality;
  view: ViewMode;
  stats: EngineStats | null;
  docked: boolean;
  onQuality: (q: Quality) => void;
  onView: (v: ViewMode) => void;
  onDisengage: () => void;
}) {
  const opt = (on: boolean) => ({
    flex: 1,
    padding: "8px 0",
    fontFamily: "Orbitron, sans-serif",
    fontSize: 15,
    letterSpacing: "0.12em",
    cursor: "pointer",
    color: on ? "#06101c" : "#9fefff",
    background: on ? "linear-gradient(180deg,#ffe39a,#e8c15a)" : "rgba(42,212,230,0.08)",
    border: `1px solid ${on ? "#e8c15a" : "rgba(42,212,230,0.4)"}`,
  });
  return (
    <Frame title="Fidelity" onDisengage={onDisengage} hint={docked ? undefined : <span>Lever: pull to switch</span>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "12px 18px", width: "100%" }}>
        <div>
          <span className="vtg-label">Render</span>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" style={opt(quality === "high")} onClick={() => onQuality("high")} data-vtg-quality="high">
              HIGH
            </button>
            <button type="button" style={opt(quality === "low")} onClick={() => onQuality("low")} data-vtg-quality="low">
              LOW
            </button>
          </div>
        </div>
        <div>
          <span className="vtg-label">Camera (V)</span>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button type="button" style={opt(view === "first")} onClick={() => onView("first")} data-vtg-view="first">
              FIRST
            </button>
            <button type="button" style={opt(view === "third")} onClick={() => onView("third")} data-vtg-view="third">
              THIRD
            </button>
          </div>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.45 }} className="vtg-dim">
          WASD move · Shift sprint · mouse or arrows look · E or click engage · Esc disengage
          {stats && (
            <div style={{ color: "#7fe8f5" }} data-vtg-stats>
              {stats.fps} fps · {stats.frameMs} ms · {stats.calls} draws · {Math.round(stats.triangles / 1000)}k tris
            </div>
          )}
        </div>
      </div>
    </Frame>
  );
}
