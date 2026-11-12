import { Component, Suspense, lazy, type ReactNode } from "react";
import { fallBackToClassic } from "./shellMode";

/**
 * What every logged-in route renders while the app is in the ship (the default): the game, loaded
 * lazily. Kept out of the game's chunk so that a chunk that fails to load, or anything the game's
 * own boundary does not catch, still ends in the classic view instead of a blank window.
 */
const PGame = lazy(() => import("./GamePage"));

class ShellBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error("[shell] the game could not be loaded", e);
    fallBackToClassic(`load: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function GameShell() {
  return (
    <ShellBoundary>
      <Suspense fallback={null}>
        <PGame />
      </Suspense>
    </ShellBoundary>
  );
}
