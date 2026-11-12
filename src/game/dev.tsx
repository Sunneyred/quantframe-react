// Standalone dev entry: the game alone, no Tauri, no login, demo data from bridge.ts.
// Open /src/game/dev.html on the Vite dev server. Not part of the app build.
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
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
import { modals } from "@mantine/modals";
import GamePage from "./GamePage";

(window as unknown as { __vtModal?: () => void }).__vtModal = () =>
  modals.openConfirmModal({ title: "A modal from the app", children: "Opened outside the game tree, routed onto the Comms display.", labels: { confirm: "Confirm", cancel: "Cancel" } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      {/* mounted like the app does, to prove the game captures and hides it */}
      <Notifications position="bottom-right" />
      {/* like App.tsx, so app-style modals can be opened over the game (dev: __vtModal()) */}
      <ModalsProvider modalProps={{ centered: true }}>
        <GamePage />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
