import { Component, type ReactNode } from "react";
import GameCore from "./GameCore";

/**
 * The "game" route inside the app. It covers the whole window (the app's header and side bar are
 * still mounted underneath; a later phase removes the shell). A crash is contained here.
 */
class GameBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error("[game] crashed", e);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, color: "#dceef8" }}>
        <h2 style={{ color: "#e8c15a" }}>The vault hit an error</h2>
        <pre style={{ whiteSpace: "pre-wrap", color: "#ff4d6d" }}>{this.state.error}</pre>
        <a href="/" style={{ color: "#2ad4e6" }}>
          Back to the app
        </a>
      </div>
    );
  }
}

export default function GamePage() {
  return (
    <div className="vtg-fullbleed">
      <GameBoundary>
        <GameCore />
      </GameBoundary>
    </div>
  );
}
