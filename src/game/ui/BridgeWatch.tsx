import type { QuantframeApiTypes } from "$types";
import { Clock } from "@components/Layouts/Shared/Clock";
import { useAppContext } from "@contexts/app.context";
import { open } from "@tauri-apps/plugin-shell";
import { Frame } from "./Frame";

/**
 * The Bridge Watch: what the classic header showed. The ship's clock (the app's own Clock: UTC and
 * the time to the daily reset) and the alert feed. An alert that carries a link opens it when the
 * screen is engaged, as a click on the classic ticker did.
 */

const TYPE_COLOR: Record<string, string> = { error: "#ff7a8a", warning: "#ffd36b", success: "#5df2b8" };

function openAlert(alert: QuantframeApiTypes.AlertDto) {
  const { event, payload } = (alert.properties ?? {}) as { event?: string; payload?: unknown };
  if (event === "open_url" && typeof payload === "string" && payload) void open(payload).catch((e) => console.error("[game] alert link", e));
}

export function BridgeWatch({ docked, onDisengage }: { docked: boolean; onDisengage: () => void }) {
  const { alerts } = useAppContext();
  return (
    <Frame title="Bridge Watch" status={<span className="vtg-chip">{alerts.length ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : "No alerts"}</span>} onDisengage={onDisengage} hint={docked ? undefined : <span>Read to open alert links</span>}>
      <div className="vtg-watch" data-vtg-watch>
        <div className="vtg-watch-clock" data-vtg-watch-clock>
          <span className="vtg-label">Ship's clock</span>
          <Clock />
        </div>
        <div className={`vtg-watch-alerts ${docked ? "vtg-list" : ""}`} data-vtg-watch-alerts>
          <span className="vtg-label">Alerts</span>
          {alerts.length === 0 && <div className="vtg-dim">All quiet.</div>}
          {alerts.map((alert) => {
            const link = !!alert.properties && (alert.properties as { event?: string }).event === "open_url";
            return (
              <div
                key={alert.id}
                className="vtg-watch-alert"
                data-vtg-alert={alert.id}
                data-clickable={link || undefined}
                style={{ color: TYPE_COLOR[String(alert.type)] ?? "#dceef8" }}
                onClick={link ? () => openAlert(alert) : undefined}
                role={link ? "link" : undefined}
              >
                {alert.context}
                {link ? " ›" : ""}
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}
