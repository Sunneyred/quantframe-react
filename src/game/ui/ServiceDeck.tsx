import { routeLoaders } from "@components/Layouts/routeLoaders";
import { MantineThemeProvider } from "@mantine/core";
import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Announcement } from "../notify";
import { isDeckScreen, WATCH_SCREEN, type ServiceDeck as Deck, type TerminalId, type TerminalInfo } from "../rooms/vault/terminals";
import { AccountConsole, SettingsConsole } from "./Consoles";
import { BridgeWatch } from "./BridgeWatch";
import { Frame } from "./Frame";
import "../terminals.css";

/**
 * The React content of the Service Deck (rooms/vault/terminals.ts): each terminal shows a light
 * idle face until it is engaged, then mounts the REAL classic page (the same lazy chunks the
 * classic routes use, the same contexts and commands) inside the in-world screen. The page stays
 * mounted while one of its own dialogs is up on the Comms display, and is unmounted on disengage.
 */

const PHome = lazy(routeLoaders.home);
const PLiveScraper = lazy(routeLoaders.liveScraper);
const PWarframeMarket = lazy(routeLoaders.warframeMarket);
const PChat = lazy(routeLoaders.chat);
const PTradingAnalytics = lazy(routeLoaders.tradingAnalytics);
const PWfInventory = lazy(routeLoaders.wfInventory);
const PTradeMessages = lazy(routeLoaders.tradeMessages);
const PAbout = lazy(routeLoaders.about);
const PDebug = lazy(routeLoaders.debug);

function page(id: TerminalId, close: () => void): ReactNode {
  switch (id) {
    case "live":
      return <PLiveScraper />;
    case "market":
      return <PWarframeMarket />;
    case "chat":
      return <PChat />;
    case "analytics":
      return <PTradingAnalytics />;
    case "cargo":
      return <PWfInventory />;
    case "messages":
      return <PTradeMessages />;
    case "home":
      return <PHome />;
    case "about":
      return <PAbout />;
    case "debug":
      return <PDebug />;
    case "settings":
      return <SettingsConsole onSaved={close} />;
    case "account":
      return <AccountConsole />;
  }
}

/** A page that crashes inside a terminal stays inside it: the ship keeps running. */
class TerminalBoundary extends Component<{ children: ReactNode; name: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error(`[game] terminal "${this.props.name}" failed`, e);
  }
  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="vtg-term-fault" data-vtg-term-fault>
        <span className="vtg-label">Terminal fault</span>
        <div style={{ fontSize: 22, color: "#ffb37a" }}>{this.props.name} could not be shown.</div>
        <div className="vtg-dim" style={{ fontSize: 16 }}>
          {this.state.error}
        </div>
        <div className="vtg-dim" style={{ fontSize: 15 }}>
          The ship keeps running. Disengage and engage again to retry.
        </div>
      </div>
    );
  }
}

const TONE: Record<Announcement["tone"], string> = { gold: "#ffd36b", cyan: "#7fe8f5", green: "#5df2b8", red: "#ff7a8a" };
const FRESH_MS = 9000;

/** The newest announcement (the app's toasts are mirrored into the world), while it is fresh. */
function useFresh(latest: Announcement | undefined, active: boolean): Announcement | null {
  const [, tick] = useState(0);
  const fresh = !!latest && active && Date.now() - latest.at < FRESH_MS;
  useEffect(() => {
    if (!fresh || !latest) return;
    const id = window.setTimeout(() => tick((n) => n + 1), Math.max(50, FRESH_MS - (Date.now() - latest.at)));
    return () => window.clearTimeout(id);
  }, [fresh, latest]);
  return fresh && latest ? latest : null;
}

function Terminal({ info, mounted, latest, onDisengage }: { info: TerminalInfo; mounted: boolean; latest: Announcement | undefined; onDisengage: () => void }) {
  const note = useFresh(latest, mounted);
  return (
    <Frame
      title={info.title}
      status={<span className="vtg-chip">{info.classic}</span>}
      onDisengage={onDisengage}
      hint={
        note ? (
          <span className="vtg-term-note" style={{ color: TONE[note.tone] }} data-vtg-term-note>
            {note.text}
          </span>
        ) : mounted ? undefined : (
          <span>Engage to open</span>
        )
      }
    >
      {mounted ? (
        <div className="vtg-term-page" data-vtg-term-page={info.id}>
          <TerminalBoundary name={info.title}>
            <Suspense fallback={<div className="vtg-term-wait vtg-dim">Opening {info.title}...</div>}>{page(info.id, onDisengage)}</Suspense>
          </TerminalBoundary>
        </div>
      ) : (
        <div className="vtg-term-idle" data-vtg-term-idle={info.id}>
          <div className="vtg-big vtg-term-idle-title">{info.title}</div>
          <div className="vtg-label vtg-term-idle-sub">{info.classic}</div>
          <div className="vtg-dim vtg-term-idle-what">{info.what}</div>
        </div>
      )}
    </Frame>
  );
}

export function ServiceDeck({ deck, docked, commsId, announcements, onDisengage }: { deck: Deck; docked: string | null; /** The display app dialogs are routed onto. */ commsId: string; announcements: Announcement[]; onDisengage: () => void }) {
  // the terminal whose page is mounted: the engaged one, kept while one of its dialogs is up on
  // the Comms display in front of it (the dialog's callbacks belong to the page)
  const last = useRef<string | null>(null);
  if (isDeckScreen(docked) && docked !== WATCH_SCREEN) last.current = docked;
  else if (docked !== commsId) last.current = null;
  const active = last.current;
  const latest = announcements[0];
  const wrap = (screenId: string, el: HTMLElement, node: ReactNode) =>
    createPortal(
      // dropdowns, tooltips, date pickers and inline modals of the page stay on its own screen
      <MantineThemeProvider theme={{ components: { Portal: { defaultProps: { target: `[data-screen="${screenId}"] .vtg-screen-content` } } } }}>{node}</MantineThemeProvider>,
      el,
      screenId,
    );
  return (
    <>
      {deck.terminals.map(({ info, screen }) =>
        wrap(info.screen, screen.content, <Terminal info={info} mounted={active === info.screen} latest={latest} onDisengage={onDisengage} />),
      )}
      {wrap(WATCH_SCREEN, deck.watch.content, <BridgeWatch docked={docked === WATCH_SCREEN} onDisengage={onDisengage} />)}
    </>
  );
}
