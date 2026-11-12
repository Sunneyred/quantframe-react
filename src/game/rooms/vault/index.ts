import * as THREE from "three";
import { additive, faceCentre, gyroOrnament, polar } from "../../art/kit";
import { CanvasLabel, CYAN, drawGlyph, FONT_DISPLAY, GOLD } from "../../art/textures";
import type { Engine, Room } from "../../core/Engine";
import type { Quality } from "../../core/quality";
import type { Screen } from "../../core/screens";
import type { Buyer, GoalSnapshot } from "../../../station/engine/logic";
import { buildAudioProps, type AudioProps } from "./audioProps";
import { Customers, DOOR_DEG } from "./customers";
import { Reservoir } from "./reservoir";
import { APOTHEM, buildShell, type Shell } from "./shell";
import { buildServiceDeck, type ServiceDeck } from "./terminals";

/**
 * Room 1, the Vault. Builds the hall, the Plat Reservoir, the Trade Desk with its customers, the
 * Stock Display, the fidelity console, the PA display and the open arch north to the Market
 * Observatory, and registers their
 * screens and interactables. React feeds it data through the setters below.
 */

export interface VaultHooks {
  onServe(buyerId: string): void;
  onToggleQuality(): void;
}

export type VaultScreens = Record<"reservoir" | "desk" | "stock" | "pa" | "console" | "sign", Screen>;

/** Where a sale is heard: the pour into the reservoir tank. */
export const RESERVOIR_SOUND = { x: 0, y: 2.6, z: 0 };
/** Where announcements are heard: the PA display. */
export const PA_SOUND = polar(120, APOTHEM - 0.3, 3.55);
const DESK_DEG = 90;
const DESK_R = 8.2;

export class VaultRoom implements Room {
  readonly id = "vault";
  readonly spawn = { x: -1.6, z: 8.4, yaw: -0.16 };
  readonly screens: VaultScreens;
  /** The Service Deck: one terminal per classic section, and the Bridge Watch (terminals.ts). */
  readonly deck: ServiceDeck;
  private shell: Shell;
  private reservoir: Reservoir;
  private customers: Customers;
  private tickerLabel = new CanvasLabel(4096, 96);
  private queueLabel = new CanvasLabel(512, 192);
  private queueKey = "";
  private lever: THREE.Group;
  private leverTarget = 0;
  private goal: GoalSnapshot | null = null;
  private updates: Array<(dt: number, t: number) => void> = [];
  private labels: CanvasLabel[] = [];
  /** The tape deck and the master volume panel (audioProps.ts). */
  readonly audioProps: AudioProps;

  constructor(
    private engine: Engine,
    hooks: VaultHooks,
  ) {
    const { scene, palette: p, world, screens, interact } = engine;
    this.shell = buildShell(p, scene);
    const tex = this.tickerLabel.texture;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = 4;
    this.shell.tickerTexture(tex);
    this.labels.push(this.tickerLabel, this.queueLabel);

    world.area({ kind: "circle", x: 0, z: 0, r: APOTHEM - 0.75 });

    // --- Plat Reservoir, centre of the hall
    this.reservoir = new Reservoir(p, () => engine.quality === "low");
    scene.add(this.reservoir.group);
    world.circle(0, 0, 2.2);
    const lectern = new THREE.Group();
    lectern.position.set(0, 0, 2.0);
    const lecternBody = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.82, 0.6), p.pearlPlain);
    lecternBody.position.y = 0.41;
    lectern.add(lecternBody);
    const lecternTop = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.7), p.gold);
    lecternTop.position.y = 0.84;
    lectern.add(lecternTop);
    const lecternBand = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.2), p.filigree);
    lecternBand.position.set(0, 0.55, 0.302);
    lectern.add(lecternBand);
    scene.add(lectern);
    world.box(0, 2.05, 1.0, 0.42);

    const reservoirScreen = screens.add({
      id: "reservoir",
      title: "Plat Reservoir",
      px: [820, 330],
      width: 1.6,
      position: new THREE.Vector3(0, 1.15, 2.1),
      yaw: 0,
      pitch: 0.55,
      dockable: true,
      verb: "Read",
      reach: 3.4,
      fill: 0.8,
    });
    // the column itself can be engaged too (same readout)
    interact.add({
      id: "reservoir-column",
      label: "Plat Reservoir",
      verb: "Read",
      position: new THREE.Vector3(0, 3.6, 0),
      radius: 1.3,
      reach: 5,
      hint: new THREE.Vector3(0, 2.4, 1.6),
      enabled: () => !screens.busy,
      onUse: () => screens.dock("reservoir"),
    });

    // --- Trade Desk, east
    const desk = this.buildDesk();
    const deskScreen = screens.add({
      id: "desk",
      title: "Trade Desk",
      px: [1120, 700],
      width: 1.78,
      position: polar(DESK_DEG - 6.6, DESK_R - 0.05, 1.8),
      yaw: faceCentre(DESK_DEG - 6.6),
      pitch: 0.04,
      dockable: true,
      reach: 4,
    });
    void desk;
    this.customers = new Customers(p, interact, hooks.onServe);
    scene.add(this.customers.group);

    // --- Stock Display, west wall
    const stockScreen = screens.add({
      id: "stock",
      title: "Stock Display",
      px: [1240, 760],
      width: 3.3,
      position: polar(270, APOTHEM - 0.16, 2.7),
      yaw: faceCentre(270),
      dockable: true,
      reach: 5.5,
      fill: 0.88,
    });
    this.buildStockPlinth();

    // --- fidelity console, south west
    const consoleScreen = this.buildConsole(hooks);

    // --- PA display over the line of customers, and the sign over the arch to the observatory
    const pa = screens.add({ id: "pa", title: "Vault Announcements", px: [1100, 320], width: 3.4, position: polar(120, APOTHEM - 0.12, 3.55), yaw: faceCentre(120) });
    const sign = screens.add({ id: "sign", title: "Market Observatory", px: [900, 220], width: 2.2, position: polar(0, APOTHEM - 0.16, 5.16), yaw: faceCentre(0) });
    this.plaque("ARRIVALS", "TRADERS ENTER HERE", polar(DOOR_DEG, APOTHEM - 0.14, 5.2), faceCentre(DOOR_DEG));
    this.banners();
    this.sculptures();
    this.audioProps = buildAudioProps(engine);
    this.updates.push(this.audioProps.update);

    this.deck = buildServiceDeck(engine);
    this.screens = { reservoir: reservoirScreen, desk: deskScreen, stock: stockScreen, pa, console: consoleScreen, sign };
    this.lever = this.leverGroup;
    this.setQuality(engine.quality);
    this.setTicker(["THE VAULT IS LISTENING"]);
    this.setQueue([], null);
  }

  // ---------------------------------------------------------------------------
  // Builders
  // ---------------------------------------------------------------------------

  private deskProjector!: { cone: THREE.Mesh; ring: THREE.Mesh; sprite: THREE.Sprite };

  private buildDesk() {
    const { scene, palette: p, world } = this.engine;
    const g = new THREE.Group();
    g.position.copy(polar(DESK_DEG, DESK_R));
    g.rotation.y = faceCentre(DESK_DEG);
    scene.add(g);
    const L = 3.7;
    const D = 0.9;
    const H = 1.06;
    // a curved-front counter: body, plinth, top
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H - 0.1, D), p.pearl);
    body.position.y = (H - 0.1) / 2 + 0.06;
    g.add(body);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(L + 0.12, 0.12, D + 0.12), p.ivory);
    plinth.position.y = 0.06;
    g.add(plinth);
    const top = new THREE.Mesh(new THREE.BoxGeometry(L + 0.2, 0.07, D + 0.2), p.steel);
    top.position.y = H;
    g.add(top);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(L + 0.22, 0.025, 0.03), p.cyanGlow);
    lip.position.set(0, H - 0.02, (D + 0.2) / 2);
    g.add(lip);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(L, 0.26), p.filigree);
    const uv = band.geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (L / 2));
    band.position.set(0, 0.62, D / 2 + 0.003);
    g.add(band);
    for (const x of [-L / 2, L / 2]) {
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, H + 0.1, 16), p.gold);
      end.position.set(x, (H + 0.1) / 2, 0);
      g.add(end);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), p.goldGlow);
      cap.position.set(x, H + 0.28, 0);
      cap.scale.y = 1.6;
      g.add(cap);
    }
    // the screen's emitter slab
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.3), p.gold);
    emitter.position.set(-0.86, H + 0.06, 0.05);
    g.add(emitter);
    const emitLine = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.012, 0.012), p.cyanGlow);
    emitLine.position.set(-0.86, H + 0.095, 0.2);
    g.add(emitLine);
    // the holographic queue projector, south end
    const proj = new THREE.Group();
    proj.position.set(1.38, H + 0.04, -0.05);
    g.add(proj);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.06, 32), p.gold);
    proj.add(disc);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), p.cyanGlow);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = 0.032;
    proj.add(lens);
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 0.4, 32, 1, true), this.engine.palette.holo.clone());
    (cone.material as THREE.MeshBasicMaterial).opacity = 0.12;
    cone.position.y = 0.23;
    proj.add(cone);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.007, 4, 48), p.cyanGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.43;
    proj.add(ring);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.queueLabel.texture, transparent: true, depthWrite: false, toneMapped: false }));
    sprite.scale.set(0.62, 0.23, 1);
    sprite.position.y = 0.6;
    proj.add(sprite);
    this.deskProjector = { cone, ring, sprite };
    this.updates.push((_dt, t) => {
      ring.position.y = 0.43 + Math.sin(t * 1.4) * 0.03;
      ring.rotation.z = t;
      sprite.position.y = 0.6 + Math.sin(t * 1.4) * 0.02;
      (sprite.material as THREE.SpriteMaterial).opacity = 0.85 + Math.sin(t * 23) * 0.04 + (Math.sin(t * 0.7) > 0.97 ? -0.3 : 0);
    });
    g.add(p.shadowDecal(L + 0.8, D + 0.8));
    const lamp = new THREE.PointLight(0x2ad4e6, 7, 7, 1.6);
    lamp.position.set(-0.6, 2.4, 1.0);
    g.add(lamp);
    world.box(g.position.x, g.position.z, L / 2 + 0.25, D / 2 + 0.12, g.rotation.y);
    return g;
  }

  private buildStockPlinth() {
    const { scene, palette: p, world } = this.engine;
    const at = polar(270, 10.35);
    const g = new THREE.Group();
    g.position.copy(at);
    g.rotation.y = faceCentre(270);
    scene.add(g);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.5, 24), p.pearlPlain);
    base.position.y = 0.25;
    g.add(base);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.03, 6, 40), p.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.5;
    g.add(rim);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), p.cyanGlow);
    lens.position.y = 0.5;
    g.add(lens);
    // fan of projection beams up to the screen's bottom edge
    const beamMat = additive(new THREE.MeshBasicMaterial({ color: 0x2ad4e6, opacity: 0.08, side: THREE.DoubleSide, toneMapped: false }), false);
    const shape = new THREE.Shape();
    shape.moveTo(-0.08, 0);
    shape.lineTo(0.08, 0);
    shape.lineTo(1.65, 1.2);
    shape.lineTo(-1.65, 1.2);
    shape.closePath();
    const fan = new THREE.Mesh(new THREE.ShapeGeometry(shape), beamMat);
    fan.position.set(0, 0.5, -0.05);
    fan.rotation.x = -0.45;
    g.add(fan);
    g.add(p.shadowDecal(1.8));
    const lamp = new THREE.PointLight(0x2ad4e6, 5, 6, 1.6);
    lamp.position.set(0, 2.4, 0.8);
    g.add(lamp);
    world.circle(at.x, at.z, 0.75);
  }

  private leverGroup!: THREE.Group;

  private buildConsole(hooks: VaultHooks): Screen {
    const { scene, palette: p, world, screens, interact } = this.engine;
    const deg = 222;
    const g = new THREE.Group();
    g.position.copy(polar(deg, 9.3));
    g.rotation.y = faceCentre(deg);
    scene.add(g);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.55), p.pearlPlain);
    body.position.y = 0.45;
    g.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.65), p.gold);
    top.position.y = 0.92;
    g.add(top);
    g.add(p.shadowDecal(1.6, 1.1));
    // the physical lever: up = high fidelity, down = low
    const lever = new THREE.Group();
    lever.position.set(0.72, 0.7, 0);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.3), p.steel);
    lever.add(housing);
    const arm = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8), p.gold);
    stick.position.y = 0.19;
    arm.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), p.cyanGlow);
    knob.position.y = 0.4;
    arm.add(knob);
    arm.position.x = 0.08;
    lever.add(arm);
    g.add(lever);
    this.leverGroup = arm;
    this.updates.push((dt) => {
      arm.rotation.x += (this.leverTarget - arm.rotation.x) * (1 - Math.exp(-dt * 10));
    });
    const worldLever = new THREE.Vector3();
    lever.updateWorldMatrix(true, false);
    lever.getWorldPosition(worldLever);
    interact.add({
      id: "fidelity-lever",
      label: "Render fidelity",
      verb: "Pull",
      position: worldLever.clone().setY(0.95),
      radius: 0.25,
      reach: 2.6,
      enabled: () => !screens.busy,
      onUse: () => hooks.onToggleQuality(),
    });
    world.box(g.position.x, g.position.z, 0.75, 0.4, g.rotation.y);
    const s = screens.add({
      id: "console",
      title: "Fidelity Console",
      px: [620, 380],
      width: 0.92,
      position: polar(deg, 9.3 - 0.06, 1.18),
      yaw: faceCentre(deg),
      pitch: 0.6,
      dockable: true,
      reach: 2.8,
      fill: 0.7,
    });
    return s;
  }

  /** An etched gold plaque (canvas texture on a plane), for signs that need no DOM. */
  private plaque(title: string, sub: string, at: THREE.Vector3, yaw: number) {
    const label = new CanvasLabel(1024, 256);
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
      ctx.font = `600 38px Rajdhani, sans-serif`;
      ctx.fillText(sub, w / 2, h * 0.74);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, toneMapped: false }));
    m.position.copy(at);
    m.rotation.y = yaw;
    this.engine.scene.add(m);
  }

  /** Two cloth banners with the glyph script, flanking the desk wall. */
  private banners() {
    const { scene, palette: p } = this.engine;
    const label = new CanvasLabel(256, 1024);
    this.labels.push(label);
    label.draw((ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#1a1730");
      g.addColorStop(1, "#0d0c1a");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, 0);
      ctx.lineTo(w, h - 90);
      ctx.lineTo(w / 2, h);
      ctx.lineTo(0, h - 90);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.fillStyle = GOLD;
      for (let i = 0; i < 9; i++) drawGlyph(ctx, 400 + i, w / 2 - 34, 130 + i * 82, 64);
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, 70, 34, 0, Math.PI * 2);
      ctx.stroke();
    });
    const mat = new THREE.MeshStandardMaterial({ map: label.texture, transparent: true, alphaTest: 0.1, roughness: 0.8, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: label.texture, emissiveIntensity: 0.25 });
    for (const deg of [76, 104]) {
      const geo = new THREE.PlaneGeometry(0.9, 3.6, 1, 12);
      const banner = new THREE.Mesh(geo, mat);
      banner.position.copy(polar(deg, APOTHEM - 0.08, 3.6));
      banner.rotation.y = faceCentre(90);
      scene.add(banner);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), p.gold);
      rod.rotation.z = Math.PI / 2;
      rod.position.copy(banner.position).setY(5.42);
      rod.rotation.y = faceCentre(90);
      scene.add(rod);
    }
  }

  /** Floating sculptures on plinths in the quieter wall bays. */
  private sculptures() {
    const { scene, palette: p, world } = this.engine;
    for (const deg of [300, 245]) {
      const at = polar(deg, 10.2);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.1, 8), p.pearlPlain);
      plinth.position.copy(at).setY(0.55);
      scene.add(plinth);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.025, 6, 8), p.gold);
      trim.rotation.x = Math.PI / 2;
      trim.position.copy(at).setY(1.1);
      scene.add(trim);
      const o = gyroOrnament(0.42, p.gold, deg === 300 ? p.cyanGlow : p.goldGlow, p.pearlPlain);
      o.group.position.copy(at).setY(1.85);
      scene.add(o.group);
      const decal = p.shadowDecal(1.6);
      decal.position.x = at.x;
      decal.position.z = at.z;
      scene.add(decal);
      this.updates.push((_dt, t) => {
        o.update(t * 1.3 + deg);
        o.group.position.y = 1.85 + Math.sin(t * 0.8 + deg) * 0.08;
      });
      world.circle(at.x, at.z, 0.6);
    }
  }

  // ---------------------------------------------------------------------------
  // Data in
  // ---------------------------------------------------------------------------

  setGoal(goal: GoalSnapshot) {
    this.goal = goal;
    this.reservoir.setGoal(goal);
  }

  /** A sale: pour, slosh, floater. */
  surge(gain: number) {
    const span = this.goal ? Math.max(1, this.goal.goal - this.goal.floor) : 150;
    this.reservoir.surge(gain, span);
    this.engine.audio.market.sale({ position: RESERVOIR_SOUND, amount: gain });
  }

  setQueue(queue: Buyer[], selected: string | null) {
    this.customers.setQueue(queue, selected);
    const key = `${queue.length}|${queue[0]?.name ?? ""}`;
    if (key === this.queueKey) return;
    this.queueKey = key;
    this.queueLabel.draw((ctx, w, h) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 16;
      ctx.fillStyle = CYAN;
      ctx.font = `700 92px ${FONT_DISPLAY}`;
      ctx.fillText(String(queue.length).padStart(2, "0"), w / 2, h * 0.36);
      ctx.font = `600 34px ${FONT_DISPLAY}`;
      ctx.fillStyle = "#d8f8ff";
      ctx.fillText(queue.length === 0 ? "NO ONE WAITING" : queue.length === 1 ? "BUYER WAITING" : "BUYERS WAITING", w / 2, h * 0.78);
    });
  }

  /** Lines for the scrolling ticker ring (newest first). */
  setTicker(lines: string[]) {
    this.tickerLabel.draw((ctx, w, h) => {
      ctx.textBaseline = "middle";
      ctx.font = `600 50px Rajdhani, sans-serif`;
      let x = 40;
      let i = 0;
      const glyphs = (n: number) => {
        ctx.strokeStyle = "rgba(42, 212, 230, 0.7)";
        ctx.fillStyle = "rgba(42, 212, 230, 0.7)";
        ctx.lineWidth = 2.5;
        for (let k = 0; k < n; k++) drawGlyph(ctx, i * 17 + k, x + k * 26, h / 2 - 16, 32);
        x += n * 26 + 24;
      };
      while (x < w - 200 && lines.length > 0) {
        const line = lines[i % lines.length].toUpperCase();
        ctx.fillStyle = i % lines.length === 0 ? "#ffe39a" : "#dff7ff";
        ctx.shadowColor = i % lines.length === 0 ? GOLD : CYAN;
        ctx.shadowBlur = 12;
        ctx.fillText(line, x, h / 2 + 2);
        x += ctx.measureText(line).width + 40;
        ctx.shadowBlur = 0;
        glyphs(4);
        i++;
        if (i > 40) break;
      }
    });
  }

  setQuality(q: Quality) {
    this.leverTarget = q === "high" ? -0.55 : 0.55;
    if (this.lever) this.lever.rotation.x = this.leverTarget;
  }

  update(dt: number, t: number) {
    this.shell.update(dt, t);
    this.reservoir.update(dt, t);
    this.customers.update(dt, t);
    for (const u of this.updates) u(dt, t);
    const tex = this.tickerLabel.texture;
    tex.offset.x = (tex.offset.x + dt * 0.012) % 1;
    (this.deskProjector.cone.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(t * 2) * 0.02;
  }

  dispose() {
    this.reservoir.dispose();
    this.customers.dispose();
    this.deck.dispose();
    this.audioProps.dispose();
    for (const l of this.labels) l.dispose();
  }
}
