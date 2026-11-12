import * as THREE from "three";
import { faceCentre, polar } from "../../art/kit";
import { CanvasLabel, CYAN, drawGlyph, FONT_DISPLAY, GOLD, fontsReady } from "../../art/textures";
import type { Engine } from "../../core/Engine";
import { CSS_SCALE, type Screen } from "../../core/screens";
import { APOTHEM } from "./shell";

/**
 * The Service Deck: a curved bank of dockable terminals along the south windows of the Vault, one
 * per section of the classic app, plus the Bridge Watch (clock and alerts) on the south-west wall.
 * Until a function is rebuilt natively in the world, its terminal mounts the real classic page
 * (ui/ServiceDeck.tsx), so nothing the app can do is lost by the app being only the game.
 *
 * This file only builds: geometry from the shared palette, colliders, screens. The React content
 * lives in ui/ServiceDeck.tsx and is mounted while a terminal is engaged; idle terminals show a
 * light static face (see the rules on undocked screens in ARCHITECTURE.md).
 */

export type TerminalId = "live" | "market" | "chat" | "analytics" | "cargo" | "messages" | "home" | "settings" | "account" | "about" | "debug";

export interface TerminalInfo {
  id: TerminalId;
  /** Screen id in the engine's ScreenManager. */
  screen: string;
  /** In-world name. */
  title: string;
  /** What the terminal holds, for the idle face. */
  what: string;
  /** The classic section it mounts. */
  classic: string;
}

const t = (id: TerminalId, title: string, classic: string, what: string): TerminalInfo => ({ id, screen: `svc-${id}`, title, classic, what });

/** Left to right along the deck, as the player reads it facing south from the middle of the hall. */
export const TERMINALS: TerminalInfo[] = [
  t("account", "Captain's Console", "Account", "Your market account: status online / in game / invisible, log out."),
  t("settings", "Engineering", "Settings", "Every app setting: general, live trading, appearance, notifications, advanced."),
  t("home", "Overview", "Home", "Profit totals, today, best seller, charts, latest transactions."),
  t("analytics", "Ledger", "Trading Analytics", "Transactions, item and riven prices, trading partners, data import."),
  t("cargo", "Cargo Scanner", "Cargo", "Sell Finder, inventory source, rescan, inventory rivens."),
  t("live", "Trade Engine", "Live Trading", "Start and stop the live trader, strategy, stock items, rivens, wish list."),
  t("market", "Order Relay", "Market", "Your market orders and riven auctions: refresh, sold, bought, import, delete."),
  t("chat", "Courier Inbox", "Chat", "Market chats: read, reply, delete."),
  t("messages", "Broadcast Composer", "Trade Messages", "Build and copy sell and buy lines for trade chat."),
  t("about", "Ship's Registry", "About", "Version, check for updates, guide and community links."),
  t("debug", "Maintenance Hatch", "Debug", "Command logging, backend states, log reader."),
];

export const WATCH_SCREEN = "svc-watch";
export const isDeckScreen = (id: string | null | undefined): boolean => !!id && id.startsWith("svc-");

/** Where the bank stands: degrees clockwise from north, on a ring inside the south windows. */
const DECK_FROM = 149;
const DECK_TO = 213;
const DECK_R = 10.05;
const STATION_W = 1.06;
const SCREEN_W = 0.98;
/** 16:10, close to the app window, so a docked terminal uses nearly the whole view. */
const SCREEN_PX: [number, number] = [1280, 800];
const WATCH_DEG = 240;

export interface ServiceDeck {
  terminals: Array<{ info: TerminalInfo; screen: Screen }>;
  watch: Screen;
  /** World position to stand at to use a terminal, and where to look (for tests and fast travel). */
  standAt(id: TerminalId): { x: number; z: number; yaw: number; aim: [number, number, number] } | null;
  dispose(): void;
}

/**
 * Render a screen's DOM at the pixel size it has on the monitor while docked, so embedded pages are
 * laid out for the real window (not for a fixed 1280x800 scaled up or down) and text is 1:1. The
 * world size does not change, only the DOM resolution. Never below `min` (pages need the room).
 */
export function fitScreenToView(engine: Engine, id: string, min: [number, number] = [1040, 650]) {
  const s = engine.screens.get(id);
  if (!s) return;
  const { w, h } = engine.viewport;
  const fill = s.spec.fill ?? 0.84;
  const aspect = s.width / s.height;
  const pw = Math.round(Math.max(min[0], Math.min(w * fill, h * fill * aspect)));
  const ph = Math.round(pw / aspect);
  s.element.style.width = `${pw}px`;
  s.element.style.height = `${ph}px`;
  s.element.style.setProperty("--vtg-h", `${ph}px`);
  s.css.scale.setScalar((s.width / pw) * CSS_SCALE);
}

export function buildServiceDeck(engine: Engine): ServiceDeck {
  const { scene, palette: p, world, screens } = engine;
  const root = new THREE.Group();
  root.name = "service-deck";
  scene.add(root);
  const labels: CanvasLabel[] = [];
  const stands = new Map<TerminalId, { x: number; z: number; yaw: number; aim: [number, number, number] }>();
  let disposed = false;

  const n = TERMINALS.length;
  const step = (DECK_TO - DECK_FROM) / (n - 1);
  const terminals = TERMINALS.map((info, i) => {
    const deg = DECK_FROM + step * i;
    const g = new THREE.Group();
    g.position.copy(polar(deg, DECK_R));
    g.rotation.y = faceCentre(deg);
    root.add(g);
    // the lectern: body, gold top, a glowing lip toward the room, an arm holding the display
    const body = new THREE.Mesh(new THREE.BoxGeometry(STATION_W, 0.84, 0.5), p.pearlPlain);
    body.position.y = 0.42;
    g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(STATION_W + 0.05, 0.05, 0.57), p.gold);
    top.position.y = 0.865;
    g.add(top);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(STATION_W - 0.1, 0.018, 0.02), p.cyanGlow);
    lip.position.set(0, 0.86, 0.292);
    g.add(lip);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(STATION_W - 0.08, 0.16), p.filigree);
    band.position.set(0, 0.56, 0.252);
    g.add(band);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.07), p.steel);
    arm.position.set(0, 1.03, -0.12);
    arm.rotation.x = -0.3;
    g.add(arm);
    g.add(p.shadowDecal(STATION_W + 0.5, 1.1));
    world.box(g.position.x, g.position.z, STATION_W / 2 + 0.03, 0.3, g.rotation.y);

    const screen = screens.add(
      {
        id: info.screen,
        title: info.title,
        px: SCREEN_PX,
        width: SCREEN_W,
        position: new THREE.Vector3(0, 1.4, 0.02),
        yaw: 0,
        pitch: 0.3,
        dockable: true,
        reach: 3.6,
        fill: 0.93,
        className: "vtg-term",
      },
      g,
    );
    const stand = polar(deg, DECK_R - 1.5);
    stands.set(info.id, { x: stand.x, z: stand.z, yaw: Math.atan2(-(screen.center.x - stand.x), -(screen.center.z - stand.z)), aim: [screen.center.x, screen.center.y, screen.center.z] });
    return { info, screen };
  });

  // gold end posts close the bank, like the trade desk's
  for (const deg of [DECK_FROM + step * -0.62, DECK_TO + step * 0.62]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.0, 12), p.gold);
    post.position.copy(polar(deg, DECK_R)).setY(0.5);
    root.add(post);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), p.cyanGlow);
    cap.position.copy(post.position).setY(1.16);
    cap.scale.y = 1.6;
    root.add(cap);
    world.circle(post.position.x, post.position.z, 0.2);
  }

  // the name of the place, floating over the middle of the bank
  const sign = new CanvasLabel(1024, 160);
  labels.push(sign);
  const drawSign = () =>
    sign.draw((ctx, w, h) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 12;
      ctx.font = `600 76px ${FONT_DISPLAY}`;
      ctx.fillText("SERVICE DECK", w / 2, h * 0.42);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = CYAN;
      ctx.fillStyle = CYAN;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 16; i++) drawGlyph(ctx, 900 + i, w / 2 - 16 * 14 + i * 28, h * 0.74, 22);
    });
  drawSign();
  void fontsReady().then(() => {
    if (!disposed) drawSign();
  });
  const mid = (DECK_FROM + DECK_TO) / 2;
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6 * (160 / 1024)), new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, depthWrite: false, toneMapped: false }));
  signMesh.position.copy(polar(mid, DECK_R + 0.2, 2.42));
  signMesh.rotation.y = faceCentre(mid);
  root.add(signMesh);

  // --- the Bridge Watch: ship's clock and the alert feed (the classic header's functions)
  const watch = screens.add({
    id: WATCH_SCREEN,
    title: "Bridge Watch",
    px: [1100, 360],
    width: 3.0,
    position: polar(WATCH_DEG, APOTHEM - 0.16, 3.5),
    yaw: faceCentre(WATCH_DEG),
    dockable: true,
    verb: "Read",
    reach: 8,
    fill: 0.8,
    className: "vtg-term",
  });

  // a docked terminal renders at the window's own resolution
  const fit = (id: string | null) => {
    if (id && isDeckScreen(id) && id !== WATCH_SCREEN) fitScreenToView(engine, id);
  };
  const offDock = engine.events.on("dock", fit);
  // (after the engine's own ResizeObserver has measured the new view)
  const onResize = () => requestAnimationFrame(() => !disposed && fit(screens.docked?.id ?? null));
  window.addEventListener("resize", onResize);

  return {
    terminals,
    watch,
    standAt: (id) => stands.get(id) ?? null,
    dispose() {
      disposed = true;
      offDock();
      window.removeEventListener("resize", onResize);
      for (const l of labels) l.dispose();
    },
  };
}
