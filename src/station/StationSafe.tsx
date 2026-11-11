import { Component, type ReactNode } from "react";
import StationPage from "./StationPage";
import { setStartInStation } from "./startup";

/**
 * Safety net around the whole station. The app opens in the station by default, so a crash
 * here must never lock the user out: it turns that default off and offers the classic view.
 */
class StationBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown) {
    console.error("[station] crashed", e);
    try {
      setStartInStation(false);
    } catch {
      /* storage unavailable */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, maxWidth: 640 }}>
        <h2 style={{ color: "#e8c15a" }}>The station hit an error</h2>
        <p>Your trading data is not affected. The app will open in the classic view from now on until you turn the station start back on.</p>
        <pre style={{ whiteSpace: "pre-wrap", color: "#ff4d6d" }}>{this.state.error}</pre>
        <p>
          <a href="/" style={{ color: "#2ad4e6" }}>
            Go to the classic view
          </a>
        </p>
      </div>
    );
  }
}

export default function StationSafe() {
  return (
    <StationBoundary>
      <StationPage />
    </StationBoundary>
  );
}
