// Standalone dev entry: mounts only the station, with no Tauri and no login.
// Open /src/station/dev.html on the Vite dev server. Not part of the app build.
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/orbitron/600.css";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "../global.css";
import "../void-trader.css";
import StationCore from "./StationCore";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <div style={{ padding: 16, paddingTop: 65 + 16 }}>
        <StationCore />
      </div>
    </MantineProvider>
  </StrictMode>,
);
