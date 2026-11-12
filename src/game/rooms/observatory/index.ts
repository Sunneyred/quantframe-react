import * as THREE from "three";
import type { MarketStar, OrderBook, PriceHistory } from "@api/market";
import { CanvasLabel, CYAN, FONT_DISPLAY, GOLD } from "../../art/textures";
import type { Engine } from "../../core/Engine";
import type { Screen } from "../../core/screens";
import type { MarketFilter } from "../../market/layout";
import { APOTHEM as VAULT_APOTHEM } from "../vault/shell";
import { Orrery } from "./orrery";
import { Ribbon } from "./ribbon";
import { buildCorridor, buildObservatoryShell, ENTRANCE, lface, lpolar, OBS_APOTHEM, type ObservatoryShell } from "./shell";
import { Spire, SPIRE_TOP } from "./spire";

/**
 * Room 2, the Market Observatory, north of the Vault through the arch and a short corridor.
 * The Orrery fills the middle of the hall, the Order Spire and its Price Ribbon stand to the north
 * with the Market Console beside them, the Market Weather display is on the east wall and a
 * legend plaque explains the sky on the west wall. React feeds it through the setters.
 */

const CORRIDOR = 7.2;
/** World z of the observatory's centre. */
export const OBS_Z = -(VAULT_APOTHEM + 0.6 + CORRIDOR + OBS_APOTHEM + 0.6);
export const SPIRE_AT = lpolar(0, 10.6);
const CONSOLE_DEG = 339;
const CONSOLE_R = 10.1;

export interface ObservatoryHooks {
  onFocus(star: MarketStar): void;
}

export type ObservatoryScreens = Record<"market" | "weather", Screen>;

export class ObservatoryRoom {
  readonly root = new THREE.Group();
  readonly screens: ObservatoryScreens;
  readonly orrery: Orrery;
  readonly spire: Spire;
  readonly ribbon: Ribbon;
  private shell: ObservatoryShell;
  private corridor: { group: THREE.Group; update(dt: number, t: number): void };
  private labels: CanvasLabel[] = [];
  private focused: MarketStar | null = null;
  /** Sound: where the spire stands (world), and whether the current undercut was already announced. */
  private spireWorld = new THREE.Vector3();
  private cutHeard = false;

  constructor(
    private engine: Engine,
    hooks: ObservatoryHooks,
  ) {
    const { scene, palette: p, world, screens, interact } = engine;
    this.root.name = "observatory";
    this.root.position.set(0, 0, OBS_Z);
    scene.add(this.root);
    this.root.updateWorldMatrix(true, false);

    this.shell = buildObservatoryShell(p, () => engine.quality === "high");
    this.root.add(this.shell.group);
    const z0 = -(VAULT_APOTHEM + 0.6);
    const z1 = OBS_Z + OBS_APOTHEM + 0.6;
    this.corridor = buildCorridor(p, z0, z1, ENTRANCE.half, ENTRANCE.spring);
    scene.add(this.corridor.group);
    // walkable: the hall, and the corridor overlapping both halls
    world.area({ kind: "circle", x: 0, z: OBS_Z, r: OBS_APOTHEM - 0.75 });
    world.area({ kind: "rect", x0: -ENTRANCE.half + 0.05, x1: ENTRANCE.half - 0.05, z0: OBS_Z + OBS_APOTHEM - 1.5, z1: -(VAULT_APOTHEM - 1.5) });

    // --- the Orrery
    const spireWorld = this.root.localToWorld(SPIRE_AT.clone());
    this.spireWorld.copy(spireWorld).setY(2.4);
    this.orrery = new Orrery(interact, { onFocus: (s) => hooks.onFocus(s) }, () => ({ h: engine.viewport.h, fov: engine.camera.fov, pr: engine.renderer.getPixelRatio() }), new THREE.Vector3(SPIRE_AT.x, SPIRE_TOP + 0.4, SPIRE_AT.z));
    this.root.add(this.orrery.group);
    world.circle(0, OBS_Z, 0.28); // the axis pole

    // --- the Order Spire and the Price Ribbon
    this.spire = new Spire(p);
    this.spire.group.position.copy(SPIRE_AT);
    this.root.add(this.spire.group);
    this.ribbon = new Ribbon();
    this.ribbon.group.position.copy(SPIRE_AT);
    this.root.add(this.ribbon.group);
    world.circle(spireWorld.x, spireWorld.z, 1.4);
    const spireLamp = new THREE.SpotLight(0xfff0d8, 14, 12, 0.45, 0.8, 1.4);
    spireLamp.position.copy(SPIRE_AT).add(new THREE.Vector3(0, 7, 2.5));
    spireLamp.target.position.copy(SPIRE_AT);
    this.root.add(spireLamp, spireLamp.target);
    interact.add({
      id: "spire",
      label: "Order Spire",
      verb: "Engage console",
      position: spireWorld.clone().setY(2.4),
      radius: 0.9,
      reach: 5.5,
      hint: spireWorld.clone().add(new THREE.Vector3(0, 1.32, 1.95)),
      enabled: () => !screens.busy && this.focused !== null && this.orrery.hovered < 0,
      onUse: () => screens.dock("market"),
    });

    // --- the Market Console, beside the spire
    const lectern = new THREE.Group();
    lectern.position.copy(lpolar(CONSOLE_DEG, CONSOLE_R + 0.35));
    lectern.rotation.y = lface(CONSOLE_DEG);
    this.root.add(lectern);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.8, 0.5), p.pearlPlain);
    body.position.y = 0.4;
    lectern.add(body);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.6), p.gold);
    cap.position.y = 0.82;
    lectern.add(cap);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.2), p.filigree);
    band.position.set(0, 0.55, 0.252);
    lectern.add(band);
    for (const x of [-1.15, 1.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 10), p.gold);
      post.position.set(x, 1.3, -0.05);
      lectern.add(post);
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), p.cyanGlow);
      tip.position.set(x, 2.7, -0.05);
      tip.scale.y = 1.6;
      lectern.add(tip);
    }
    lectern.add(p.shadowDecal(3, 1.2));
    const lw = this.root.localToWorld(lectern.position.clone());
    world.box(lw.x, lw.z, 1.3, 0.4, lectern.rotation.y);
    const market = screens.add(
      {
        id: "market",
        title: "Market Console",
        px: [1240, 780],
        width: 2.2,
        position: lpolar(CONSOLE_DEG, CONSOLE_R + 0.32, 1.66),
        yaw: lface(CONSOLE_DEG),
        pitch: 0.06,
        dockable: true,
        reach: 4.5,
        fill: 0.9,
      },
      this.root,
    );

    // --- Market Weather, east wall
    const weather = screens.add(
      {
        id: "weather",
        title: "Market Weather",
        px: [1500, 720],
        width: 4.4,
        position: lpolar(90, OBS_APOTHEM - 0.14, 3.0),
        yaw: lface(90),
        dockable: true,
        reach: 7,
        fill: 0.9,
      },
      this.root,
    );
    this.legend();
    this.plaque("MARKET OBSERVATORY", "EVERY STAR IS AN ITEM · HEIGHT IS PRICE", lpolar(180, OBS_APOTHEM - 0.14, 5.25), lface(180), 3.2);
    this.screens = { market, weather };
  }

  // ---------------------------------------------------------------------------

  /** The legend plaque on the west wall: how to read the sky and the spire. */
  private legend() {
    const label = new CanvasLabel(1600, 1120);
    this.labels.push(label);
    label.draw((ctx, w, h) => {
      ctx.fillStyle = "rgba(10, 10, 22, 0.9)";
      ctx.beginPath();
      ctx.roundRect(6, 6, w - 12, h - 12, 30);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `600 64px ${FONT_DISPLAY}`;
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.fillText("READING THE SKY", 70, 90);
      ctx.shadowBlur = 0;
      const star = (x: number, y: number, r: number, c: string) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.25, c);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r * 3, 0, Math.PI * 2);
        ctx.fill();
      };
      const row = (y: number, draw: (x: number) => void, text: string, sub?: string) => {
        draw(140);
        ctx.font = `700 50px Rajdhani, sans-serif`;
        ctx.fillStyle = "#f2f6ff";
        ctx.fillText(text, 250, sub ? y - 18 : y);
        if (sub) {
          ctx.font = `600 36px Rajdhani, sans-serif`;
          ctx.fillStyle = "rgba(200, 225, 255, 0.75)";
          ctx.fillText(sub, 250, y + 26);
        }
      };
      let y = 200;
      const dy = 104;
      row(y, (x) => star(x, y, 14, "#ffb84a"), "Gold star: price rising", "average above its moving average by more than 5 %");
      y += dy;
      row(y, (x) => star(x, y, 14, "#e8f0ff"), "White star: flat");
      y += dy;
      row(y, (x) => star(x, y, 14, "#7a7dff"), "Blue-violet star: price falling");
      y += dy;
      row(y, (x) => (star(x - 30, y, 7, "#ffffff"), star(x + 26, y, 18, "#ffffff")), "Bigger and brighter: more trades a day", "height: price, log scale (rings at 1p, 10p, 100p, 1000p) · further from the axis: busier");
      y += dy;
      const ring = (x: number, color: string, rx: number, ry: number, dash?: number[]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.setLineDash(dash ?? []);
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        star(x, y, 7, "#ffffff");
      };
      row(y, (x) => ring(x, "#ffc861", 52, 19), "Gold orbit: you have a live sell order");
      y += dy;
      row(y, (x) => ring(x, CYAN, 32, 32), "Cyan ring: in your stock");
      y += dy;
      row(y, (x) => ring(x, "#b78cff", 40, 40, [14, 10]), "Dashed violet ring: on your wish list");
      y += dy;
      row(y, (x) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 46);
        g.addColorStop(0, "rgba(160, 220, 255, 0.5)");
        g.addColorStop(1, "rgba(160, 220, 255, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 46, 0, Math.PI * 2);
        ctx.fill();
        star(x, y, 7, "#ffffff");
      }, "Soft halo: in your Warframe inventory");
      y += dy;
      ctx.font = `600 40px Rajdhani, sans-serif`;
      ctx.fillStyle = "#9fefff";
      ctx.fillText("Look at a star and press E to raise its order book on the spire.", 70, h - 70);
    });
    const mat = new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.52), mat);
    m.position.copy(lpolar(270, OBS_APOTHEM - 0.12, 3.0));
    m.rotation.y = lface(270);
    this.root.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.75, 2.67, 0.06), this.engine.palette.gold);
    frame.position.copy(lpolar(270, OBS_APOTHEM - 0.08, 3.0));
    frame.rotation.y = lface(270);
    this.root.add(frame);
  }

  private plaque(title: string, sub: string, at: THREE.Vector3, yaw: number, width: number) {
    const label = new CanvasLabel(1536, 256);
    this.labels.push(label);
    label.draw((ctx, w, h) => {
      ctx.fillStyle = "rgba(12, 10, 20, 0.85)";
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 20);
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 10;
      ctx.font = `600 84px ${FONT_DISPLAY}`;
      ctx.fillText(title, w / 2, h * 0.4);
      ctx.fillStyle = CYAN;
      ctx.shadowColor = CYAN;
      ctx.font = `600 40px Rajdhani, sans-serif`;
      ctx.fillText(sub, w / 2, h * 0.76);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 6), new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, toneMapped: false }));
    m.position.copy(at);
    m.rotation.y = yaw;
    this.root.add(m);
  }

  // ---------------------------------------------------------------------------
  // Data in
  // ---------------------------------------------------------------------------

  setItems(items: MarketStar[]) {
    this.orrery.setItems(items);
  }

  setFilter(f: MarketFilter) {
    this.orrery.setFilter(f);
  }

  setFocus(star: MarketStar | null) {
    const same = !!star && !!this.focused && star.wfm_url === this.focused.wfm_url && star.flags.riven === this.focused.flags.riven;
    this.focused = star;
    this.orrery.setFocus(star?.wfm_url ?? null, star?.flags.riven ?? false);
    this.spire.setItem(star);
    this.ribbon.setItem(star);
    if (same) return; // the same item with fresh numbers
    this.cutHeard = false;
    // a chime at the star: pitch and brightness follow its trend
    if (star) this.engine.audio.market.focus({ trend: star.trend, dir: star.trend_dir, position: this.orrery.starWorld(star.wfm_url) ?? this.spireWorld });
  }

  setBook(book: OrderBook | null, loading = false) {
    this.spire.setLoading(loading);
    if (book || !loading) this.spire.setBook(book);
    if (!book) return;
    // an undercut that was not there before: the alert sounds at the spire
    const cut = book.summary.undercut_by !== null && book.summary.undercut_by !== undefined;
    if (cut && !this.cutHeard) this.engine.audio.market.alert({ position: this.spireWorld });
    this.cutHeard = cut;
  }

  setHistory(star: MarketStar | null, h: PriceHistory | null, loading = false) {
    this.ribbon.setHistory(star, h, loading);
  }

  /** Where the player stands to watch the spire (world), for tests and helpers. */
  get viewpoint() {
    return { x: 0.4, z: OBS_Z - 5.9, yaw: 0 };
  }

  update(dt: number, t: number) {
    this.shell.update(dt, t);
    this.corridor.update(dt, t);
    this.orrery.update(dt, t, this.engine.camera, !this.engine.screens.busy);
    this.spire.update(dt, t);
    this.ribbon.update(dt);
  }

  dispose() {
    this.shell.dispose();
    this.orrery.dispose();
    this.spire.dispose();
    this.ribbon.dispose();
    for (const l of this.labels) l.dispose();
  }
}
