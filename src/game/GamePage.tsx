import { Component, type ReactNode } from "react";
import GameCore from "./GameCore";
import { fallBackToClassic } from "./shellMode";

/**
 * The game as the app's logged-in shell (see GameShell.tsx): it fills the window and nothing else is
 * on screen. A crash never ends on an error page: it switches the app to the hidden classic view
 * (shellMode.ts), which unmounts this tree.
 */
class GameBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error("[game] crashed", e);
    fallBackToClassic(`crash: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  render() {
    if (!this.state.error) return this.props.children;
    // only ever seen on the standalone dev page: inside the app the classic view has taken over
    return <pre style={{ padding: 32, whiteSpace: "pre-wrap", color: "#ff4d6d" }}>{this.state.error}</pre>;
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
