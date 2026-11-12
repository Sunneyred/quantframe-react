// Standalone dev entry: the game alone, no Tauri, no login, demo data from bridge.ts.
// Open /src/game/dev.html on the Vite dev server. Not part of the app build.
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/600.css";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "../global.css";
import "../void-trader.css";
import GamePage from "./GamePage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      {/* mounted like the app does, to prove the game captures and hides it */}
      <Notifications position="bottom-right" />
      <GamePage />
    </MantineProvider>
  </StrictMode>,
);
