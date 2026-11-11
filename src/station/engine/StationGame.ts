import { Application, Container } from "pixi.js";
import { dirFromAngle } from "../entities/character";
import { Customers, type Customer } from "../entities/customers";
import { Player } from "../entities/player";
import { TankView, goalLineY } from "../fluid/TankView";
import { FirstPersonView, PERSON_H, crateTop } from "../fp/FirstPersonView";
import { distToRect, nearestOnRect, pointInRect } from "./collision";
import {
  COUNTER,
  COUNTER_SOLID,
  DOOR,
  DOOR_VAULT_SIDE,
  DOOR_WH_SIDE,
  FLOOR,
  INTERACT_RANGE,
  PAL,
  RACK,
  TANK_FILL_GOAL,
  TANK_FILL_MIN,
  TANK_FRAME,
  TANK_GLASS,
  TANK_SOLID,
  TANK_USE,
  VIEW_H,
  VIEW_W,
  WH_FLOOR,
  WH_OX,
  terminalRect,
  type Rect,
} from "./constants";
import { Keyboard } from "./input";
import { LabelLayer } from "./labels";
import { clamp, easeLevel, planSurge, progressToFill, type Buyer, type GoalSnapshot } from "./logic";
import { READOUT, Room, SIGN } from "./room";
import { BAYS, LISTED_CSS, TIER_CSS, layoutWarehouse, type BayKey, type Crate, type WarehouseLayout } from "./warehouse";
import { WarehouseRoom, crateLift } from "./warehouseRoom";

export type InteractTarget =
  | { kind: "tank" }
  | { kind: "counter" }
  | { kind: "customer"; buyer: Buyer }
  /** A stock crate, by the item's unique name. */
  | { kind: "crate"; id: string }
  /** The terminal at the end of a bay. */
  | { kind: "terminal"; category: BayKey };

export type ViewMode = "top" | "fp";
export type RoomId = "vault" | "warehouse";

export interface StationCallbacks {
  onInteract(target: InteractTarget): void;
  onDebugBuyer(): void;
  onDebugSale(): void;
  onError(message: string): void;
  /** The player walked into another room. */
  onRoom?(room: RoomId): void;
  /** V was pressed. */
  onToggleView?(): void;
  /** Tab was pressed. */
  onQuickPanel?(): void;
  /** Pointer lock was taken or released (first person). */
  onPointerLock?(locked: boolean): void;
}

interface Floater {
  el: HTMLDivElement;
  age: number;
  x: number;
  y: number;
}

interface Candidate {
  target: InteractTarget;
  /** Closest point of the thing to the player. */
  x: number;
  y: number;
  dist: number;
  /** Maximum distance it can be used from. */
  range: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const TURN_SPEED = 2.6;
const MOUSE_SENS = 0.0026;
/** First person: how far off the view direction something may be and still be "in front". */
const FP_CONE = 0.75;

/**
 * Owns the station state (player, customers, tank, warehouse stock), the game
 * loop and both renderers over that state: the Pixi top-down scene and the
 * first-person raycaster. Created and destroyed by the React page; everything
 * the page needs goes through the small public API.
 */
export class StationGame {
  private app: Application | null = null;
  private destroyed = false;
  private stage: HTMLDivElement;
  /** Static labels of each room (room-local coordinates), and the labels that follow things. */
  private labelsVault: LabelLayer;
  private labelsWh: LabelLayer;
  private labels: LabelLayer;
  private resizeObserver: ResizeObserver | null = null;
  private keyboard: Keyboard | null = null;
  private fp: FirstPersonView | null = null;

  private world: Container | null = null;
  private room: Room | null = null;
  private warehouse: WarehouseRoom | null = null;
  private tank: TankView | null = null;
  private player: Player | null = null;
  private customers: Customers | null = null;
  private bubbles = new Map<Customer, HTMLDivElement>();
  private floaters: Floater[] = [];

  private goal: GoalSnapshot | null = null;
  private layoutData: WarehouseLayout = layoutWarehouse(null);
  private fillTarget = progressToFill(0.5, TANK_FILL_MIN, TANK_FILL_GOAL);
  private fillShown = this.fillTarget;
  private lowPower = false;
  private inputEnabled = true;
  private current: InteractTarget | null = null;
  private mode: ViewMode = "top";
  private roomId: RoomId = "vault";
  private camX = 0;
  private hover: Crate | null = null;
  private time = 0;

  private elPlat: HTMLDivElement;
  private elGoal: HTMLDivElement;
  private elToday: HTMLDivElement;
  private elGoalLine: HTMLDivElement;
  private elPrompt: HTMLDivElement;
  private elCrate: HTMLDivElement;
  private elHint: HTMLDivElement;

  constructor(
    private host: HTMLElement,
    private callbacks: StationCallbacks,
  ) {
    this.stage = document.createElement("div");
    this.stage.className = "vt-station-stage";
    host.appendChild(this.stage);
    this.labelsVault = new LabelLayer(this.stage);
    this.labelsWh = new LabelLayer(this.stage);
    this.labels = new LabelLayer(this.stage);

    const v = this.labelsVault;
    const title = v.add("vt-station-readout-title", "VAULT");
    v.place(title, READOUT.x + 5, READOUT.y + 3);
    this.elPlat = v.add("vt-station-readout-plat", "--");
    v.place(this.elPlat, READOUT.x + 5, READOUT.y + 9);
    this.elGoal = v.add("vt-station-readout-goal", "");
    v.place(this.elGoal, READOUT.x + READOUT.w - 5, READOUT.y + 4);
    this.elToday = v.add("vt-station-readout-today", "");
    v.place(this.elToday, READOUT.x + 5, READOUT.y + 30);
    this.elGoalLine = v.add("vt-station-goal-line", "GOAL");
    v.place(this.elGoalLine, TANK_GLASS.x + TANK_GLASS.w / 2, goalLineY() - 1);
    const sign = v.add("vt-station-sign", "TRADE DESK");
    v.place(sign, SIGN.x + SIGN.w / 2, SIGN.y + SIGN.h / 2);
    const door = v.add("vt-station-door-tag", "WAREHOUSE");
    v.place(door, DOOR.x - 3, DOOR.y - 6);

    this.elCrate = this.labels.add("vt-station-crate-bubble", "");
    this.labels.show(this.elCrate, false);
    this.elPrompt = this.labels.add("vt-station-prompt", "");
    this.labels.show(this.elPrompt, false);
    this.elHint = this.labels.add("vt-station-fp-hint", "Click to look around with the mouse (Esc frees it)");
    this.labels.place(this.elHint, VIEW_W / 2, 14);
    this.labels.show(this.elHint, false);
    this.applyView();
  }

  /** Async Pixi init. Safe to call destroy() before this resolves. */
  async start(): Promise<void> {
    const app = new Application();
    try {
      await app.init({
        width: VIEW_W,
        height: VIEW_H,
        background: PAL.void,
        antialias: false,
        resolution: 1,
        autoDensity: false,
        roundPixels: true,
        preference: "webgl",
        powerPreference: "low-power",
        autoStart: false,
        sharedTicker: false,
      });
    } catch (e) {
      if (!this.destroyed) this.callbacks.onError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: true });
      return;
    }
    this.app = app;
    app.canvas.className = "vt-station-canvas";
    this.stage.insertBefore(app.canvas, this.labelsVault.root);

    // --- scene: both rooms live in one world container that the camera slides
    this.room = new Room();
    this.tank = new TankView(this.fillShown);
    this.player = new Player();
    const sorted = new Container();
    sorted.sortableChildren = true;
    this.customers = new Customers(sorted);
    this.warehouse = new WarehouseRoom(sorted, this.labelsWh);
    this.warehouse.setLayout(this.layoutData);
    sorted.addChild(this.room.counter, this.player.sprite.view);
    const world = new Container();
    world.addChild(this.room.back, this.warehouse.back, this.tank.view, sorted, this.room.front);
    app.stage.addChild(world);
    this.world = world;

    // --- first-person renderer over the same state
    this.fp = new FirstPersonView(this.stage, this.labelsVault.root);
    this.fp.setLayout(this.layoutData);
    if (this.goal) this.fp.setGoal(this.goal);
    this.fp.canvas.addEventListener("pointerdown", this.handleFpPointer);
    this.applyLowPower();

    // --- input
    this.keyboard = new Keyboard(this.handlePress);
    this.keyboard.enabled = this.inputEnabled;
    app.canvas.addEventListener("pointerdown", this.handlePointer);
    app.canvas.addEventListener("pointermove", this.handleHover);
    app.canvas.addEventListener("pointerleave", this.handleLeave);
    document.addEventListener("visibilitychange", this.handleVisibility);
    document.addEventListener("pointerlockchange", this.handleLockChange);
    document.addEventListener("mousemove", this.handleMouseLook);

    // --- layout
    this.resizeObserver = new ResizeObserver(this.layout);
    this.resizeObserver.observe(this.host);
    this.layout();

    app.ticker.add(this.tick);
    if (!document.hidden) app.ticker.start();
    if (this.goal) this.renderGoal();
    this.applyView();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  setGoal(goal: GoalSnapshot) {
    const first = this.goal === null;
    this.goal = goal;
    const next = progressToFill(goal.progress, TANK_FILL_MIN, TANK_FILL_GOAL);
    const delta = next - this.fillTarget;
    this.fillTarget = next;
    if (first) {
      // start a little low so the first frame already has the liquid settling in
      this.fillShown = Math.max(0.02, next - 0.06);
    } else if (Math.abs(delta) > 0.002) {
      this.tank?.slosh(Math.sign(delta || 1) * clamp(10 + Math.abs(delta) * 260, 10, 60));
    }
    this.renderGoal();
    this.fp?.setGoal(goal);
  }

  /** New warehouse stock (from the sell finder). Both views rebuild their crates from it. */
  setWarehouse(layout: WarehouseLayout) {
    this.layoutData = layout;
    this.hover = null;
    this.warehouse?.setLayout(layout);
    this.fp?.setLayout(layout);
  }

  setView(mode: ViewMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.player?.stop();
    this.keyboard?.clear();
    // facing carries over: the top-down sprite takes the nearest of its four directions
    if (mode === "top" && this.player) this.player.sprite.dir = dirFromAngle(this.player.angle);
    if (mode === "top") this.releasePointer();
    this.applyView();
  }

  get view(): ViewMode {
    return this.mode;
  }

  /** Play a sale: gold pours in from the pipe, sized to the gain. */
  surge(gain: number) {
    if (!this.tank || gain <= 0) return;
    const span = this.goal ? this.goal.goal - this.goal.floor : 150;
    const plan = planSurge(gain, span, this.lowPower);
    this.tank.surge(plan.particles, plan.duration, plan.kick);
    const el = this.labels.add("vt-station-floater", `+${fmt(gain)}p`);
    this.floaters.push({ el, age: 0, x: TANK_FRAME.x + TANK_FRAME.w / 2, y: TANK_GLASS.y + 26 });
  }

  /** A buyer arrived. Returns false if the queue is full. */
  addBuyer(buyer: Omit<Buyer, "pings">): boolean {
    if (!this.customers || !this.room) return false;
    const { customer, added } = this.customers.add(buyer);
    if (!customer) return false;
    this.room.ping();
    if (added) {
      const el = this.labels.add("vt-station-bubble", customer.buyer.name);
      this.bubbles.set(customer, el);
    }
    const el = this.bubbles.get(customer);
    if (el) {
      // restart the attention animation on every ping
      el.classList.remove("vt-station-bubble-ping");
      void el.offsetWidth;
      el.classList.add("vt-station-bubble-ping");
    }
    return true;
  }

  dismissBuyer(id: string) {
    this.customers?.dismiss(id);
  }

  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    if (this.keyboard) {
      this.keyboard.enabled = enabled;
      this.keyboard.clear();
    }
    if (!enabled) {
      this.player?.stop();
      // a card or panel is open: give the mouse back
      this.releasePointer();
    }
  }

  setLowPower(low: boolean) {
    this.lowPower = low;
    this.applyLowPower();
  }

  /** Let go of the mouse if the first-person view holds it. */
  releasePointer() {
    try {
      if (this.fp && document.pointerLockElement === this.fp.canvas) document.exitPointerLock();
    } catch {
      /* nothing to release */
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.releasePointer();
    this.resizeObserver?.disconnect();
    this.keyboard?.destroy();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    document.removeEventListener("mousemove", this.handleMouseLook);
    this.fp?.canvas.removeEventListener("pointerdown", this.handleFpPointer);
    this.fp?.destroy();
    this.fp = null;
    const app = this.app;
    if (app) {
      app.canvas.removeEventListener("pointerdown", this.handlePointer);
      app.canvas.removeEventListener("pointermove", this.handleHover);
      app.canvas.removeEventListener("pointerleave", this.handleLeave);
      app.ticker.remove(this.tick);
      app.ticker.stop();
      this.customers?.destroy();
      this.warehouse?.destroy();
      this.tank?.destroy();
      app.destroy({ removeView: true }, { children: true, texture: true });
      this.app = null;
    }
    this.bubbles.clear();
    this.floaters = [];
    this.labelsVault.destroy();
    this.labelsWh.destroy();
    this.labels.destroy();
    this.stage.remove();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private applyLowPower() {
    if (this.app) this.app.ticker.maxFPS = this.lowPower ? 30 : 0;
    this.tank?.setLowPower(this.lowPower);
    this.room?.setMoteCount(this.lowPower ? 6 : 16);
    this.fp?.setLowPower(this.lowPower);
  }

  /** Show the canvas and the static labels that belong to the current view and room. */
  private applyView() {
    const top = this.mode === "top";
    if (this.app) {
      this.app.canvas.style.display = top ? "" : "none";
      // the Pixi scene is not drawn while the raycaster is on screen
      this.app.stage.visible = top;
    }
    this.fp?.setVisible(!top);
    this.labelsVault.root.style.display = top && this.roomId === "vault" ? "" : "none";
    this.labelsWh.root.style.display = top && this.roomId === "warehouse" ? "" : "none";
    this.camX = this.roomId === "warehouse" ? WH_OX : 0;
    if (this.world) this.world.x = -this.camX;
    this.stage.classList.toggle("vt-station-stage-fp", !top);
    this.updateHint();
  }

  private updateHint() {
    const locked = this.fp !== null && document.pointerLockElement === this.fp.canvas;
    this.labels.show(this.elHint, this.mode === "fp" && !locked && this.inputEnabled);
  }

  private renderGoal() {
    const g = this.goal;
    if (!g) return;
    const v = this.labelsVault;
    v.text(this.elPlat, `${fmt(g.platinum)}p`);
    v.text(this.elGoal, `GOAL ${fmt(g.goal)}p`);
    v.text(this.elToday, `today ${fmt(g.profit_today)} / ${fmt(g.daily_target)}p`);
    v.text(this.elGoalLine, `GOAL ${fmt(g.goal)}p`);
    this.elToday.classList.toggle("vt-station-readout-today-hit", g.profit_today >= g.daily_target && g.daily_target > 0);
  }

  private layout = () => {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w <= 0 || h <= 0) return;
    let scale = Math.min(w / VIEW_W, h / VIEW_H);
    // whole-number scales keep the pixels square; fall back to fractional on small windows
    if (scale >= 2) scale = Math.floor(scale * 2) / 2;
    this.stage.style.width = `${Math.round(VIEW_W * scale)}px`;
    this.stage.style.height = `${Math.round(VIEW_H * scale)}px`;
    this.stage.style.setProperty("--vt-u", `${scale}px`);
  };

  private handleVisibility = () => {
    const app = this.app;
    if (!app) return;
    if (document.hidden) {
      app.ticker.stop();
      this.keyboard?.clear();
    } else {
      app.ticker.start();
    }
  };

  private handlePress = (code: string) => {
    switch (code) {
      case "KeyE":
        if (this.current) this.callbacks.onInteract(this.current);
        break;
      case "KeyB":
        this.callbacks.onDebugBuyer();
        break;
      case "KeyG":
        this.callbacks.onDebugSale();
        break;
      case "KeyV":
        this.callbacks.onToggleView?.();
        break;
      case "Tab":
        this.callbacks.onQuickPanel?.();
        break;
    }
  };

  private toWorld(e: PointerEvent): { x: number; y: number } | null {
    if (!this.app) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return { x: ((e.clientX - rect.left) / rect.width) * VIEW_W + this.camX, y: ((e.clientY - rect.top) / rect.height) * VIEW_H };
  }

  private handlePointer = (e: PointerEvent) => {
    if (!this.inputEnabled || !this.player || !this.customers) return;
    const p = this.toWorld(e);
    if (!p) return;
    const { x, y } = p;
    const hit = this.customers.at(x, y);
    if (hit) {
      this.callbacks.onInteract({ kind: "customer", buyer: hit.buyer });
      return;
    }
    const inDoor = y >= DOOR.y - 4 && y <= DOOR.y + DOOR.h + 4;
    if (this.roomId === "vault") {
      if (inDoor && x >= DOOR.x - 6) {
        // through the door into the warehouse
        this.player.moveTo(DOOR_WH_SIDE.x, DOOR_WH_SIDE.y, [DOOR_VAULT_SIDE]);
        return;
      }
      if (pointInRect(x, y, TANK_FRAME, 2)) {
        if (distToRect(this.player.x, this.player.y, TANK_SOLID) < INTERACT_RANGE) this.callbacks.onInteract({ kind: "tank" });
        else this.player.moveTo(clamp(x, TANK_SOLID.x + 6, TANK_SOLID.x + TANK_SOLID.w - 6), TANK_USE.y);
        return;
      }
      if (pointInRect(x, y, COUNTER)) {
        // walk to the staff side of the counter
        this.player.moveTo(clamp(x, COUNTER.x + 6, COUNTER.x + COUNTER.w - 6), COUNTER_SOLID.y - 2);
        return;
      }
      this.player.moveTo(clamp(x, FLOOR.x + 5, FLOOR.x + FLOOR.w - 5), clamp(y, FLOOR.y + 6, FLOOR.y + FLOOR.h - 1));
      return;
    }
    // --- warehouse
    if (inDoor && x <= WH_OX + 14) {
      this.player.moveTo(DOOR_VAULT_SIDE.x, DOOR_VAULT_SIDE.y, [DOOR_WH_SIDE]);
      return;
    }
    const crate = this.warehouse?.crateAt(x, y);
    if (crate) {
      this.callbacks.onInteract({ kind: "crate", id: crate.item.unique_name });
      return;
    }
    for (let i = 0; i < RACK.count; i++) {
      const t = terminalRect(i);
      if (pointInRect(x, y, { x: t.x, y: t.y - 8, w: t.w, h: t.h + 8 }, 1)) {
        this.callbacks.onInteract({ kind: "terminal", category: BAYS[i].key });
        return;
      }
    }
    this.player.moveTo(clamp(x, WH_FLOOR.x + 5, WH_FLOOR.x + WH_FLOOR.w - 5), clamp(y, WH_FLOOR.y + 6, WH_FLOOR.y + WH_FLOOR.h - 1));
  };

  private handleHover = (e: PointerEvent) => {
    if (this.roomId !== "warehouse" || !this.inputEnabled) {
      this.hover = null;
      return;
    }
    const p = this.toWorld(e);
    this.hover = p ? (this.warehouse?.crateAt(p.x, p.y) ?? null) : null;
    if (this.app) this.app.canvas.style.cursor = this.hover ? "pointer" : "";
  };

  private handleLeave = () => {
    this.hover = null;
  };

  // --- first person: click captures the mouse, then clicks interact
  private handleFpPointer = () => {
    const fp = this.fp;
    if (!fp || !this.inputEnabled || this.mode !== "fp") return;
    if (document.pointerLockElement === fp.canvas) {
      if (this.current) this.callbacks.onInteract(this.current);
      return;
    }
    try {
      const res = fp.canvas.requestPointerLock() as unknown;
      // newer browsers return a promise that rejects when the lock is refused
      if (res && typeof (res as Promise<void>).catch === "function") (res as Promise<void>).catch(() => {});
    } catch {
      /* pointer lock unavailable: the arrow keys still turn */
    }
  };

  private handleLockChange = () => {
    const locked = this.fp !== null && document.pointerLockElement === this.fp.canvas;
    this.updateHint();
    this.callbacks.onPointerLock?.(locked);
  };

  private handleMouseLook = (e: MouseEvent) => {
    if (this.mode !== "fp" || !this.inputEnabled || !this.fp || !this.player) return;
    if (document.pointerLockElement !== this.fp.canvas) return;
    this.player.angle += clamp(e.movementX, -200, 200) * MOUSE_SENS;
  };

  // -------------------------------------------------------------------------
  // Interaction (shared by both views)
  // -------------------------------------------------------------------------

  private crateById(id: string): Crate | null {
    return this.layoutData.crates.find((c) => c.item.unique_name === id) ?? null;
  }

  private rectCandidate(target: InteractTarget, r: Rect, range: number, px: number, py: number): Candidate {
    const q = nearestOnRect(px, py, r);
    return { target, x: q.x, y: q.y, dist: Math.hypot(q.x - px, q.y - py), range };
  }

  /** Everything usable from where the player stands, with its reach. */
  private candidates(px: number, py: number): Candidate[] {
    const out: Candidate[] = [];
    const customers = this.customers;
    if (!customers) return out;
    const fp = this.mode === "fp";
    if (this.roomId === "vault") {
      for (const c of customers.all) {
        if (c.phase === "leaving") continue;
        out.push({ target: { kind: "customer", buyer: c.buyer }, x: c.x, y: c.y - 4, dist: Math.hypot(c.x - px, c.y - 4 - py), range: INTERACT_RANGE - 0.01 });
      }
      const head = customers.head;
      out.push(this.rectCandidate(head ? { kind: "customer", buyer: head.buyer } : { kind: "counter" }, COUNTER_SOLID, 14, px, py));
      out.push(this.rectCandidate({ kind: "tank" }, TANK_SOLID, fp ? 26 : 16, px, py));
    } else {
      for (const c of this.layoutData.crates) out.push(this.rectCandidate({ kind: "crate", id: c.item.unique_name }, c.rect, fp ? 24 : 15, px, py));
      for (let i = 0; i < RACK.count; i++) out.push(this.rectCandidate({ kind: "terminal", category: BAYS[i].key }, terminalRect(i), fp ? 22 : 13, px, py));
    }
    return out;
  }

  /**
   * The thing E would use. Top-down keeps the original order of preference
   * (a customer in reach, then the counter, the tank, the nearest crate); first
   * person takes what is nearest to the centre of the view within reach.
   */
  private pickTarget(): InteractTarget | null {
    const p = this.player;
    if (!p) return null;
    const list = this.candidates(p.x, p.y).filter((c) => c.dist < c.range);
    if (list.length === 0) return null;
    if (this.mode === "top") {
      const rank = (c: Candidate) => (c.target.kind === "customer" && c.range > 20 ? 0 : c.target.kind === "tank" ? 2 : c.target.kind === "terminal" ? 4 : c.target.kind === "crate" ? 3 : 1);
      list.sort((a, b) => rank(a) - rank(b) || a.dist - b.dist);
      return list[0].target;
    }
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const c of list) {
      let off = 0;
      if (c.dist > 5) {
        off = Math.abs(Math.atan2(c.y - (p.y - 2.5), c.x - p.x) - p.angle) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        if (off > FP_CONE) continue;
      }
      const score = off * 26 + c.dist;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best ? best.target : null;
  }

  /** World point (z above the floor) to label coordinates in the current view, or null when it cannot be seen. */
  private toScreen(wx: number, wy: number, z: number, lift: number): { x: number; y: number } | null {
    if (this.mode === "fp") return this.fp?.project(wx, wy, z) ?? null;
    const x = wx - this.camX;
    if (x < -4 || x > VIEW_W + 4) return null;
    return { x, y: wy - lift };
  }

  private placeOrHide(el: HTMLElement, at: { x: number; y: number } | null) {
    this.labels.show(el, at !== null);
    if (at) this.labels.place(el, clamp(at.x, 6, VIEW_W - 6), clamp(at.y, 8, VIEW_H - 2));
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private tick = () => {
    const app = this.app;
    const { room, tank, player, customers, warehouse } = this;
    if (!app || !room || !tank || !player || !customers || !warehouse) return;
    const dt = Math.min(app.ticker.deltaMS / 1000, 0.05);
    this.time += dt;
    const fpMode = this.mode === "fp";
    const kb = this.keyboard;

    // --- player: one body, two ways of steering it
    if (fpMode && kb) {
      const turn = (kb.isDown("ArrowRight") ? 1 : 0) - (kb.isDown("ArrowLeft") ? 1 : 0);
      player.angle += turn * TURN_SPEED * dt;
      const fwd = (kb.isDown("KeyW") || kb.isDown("ArrowUp") ? 1 : 0) - (kb.isDown("KeyS") || kb.isDown("ArrowDown") ? 1 : 0);
      const strafe = (kb.isDown("KeyD") ? 1 : 0) - (kb.isDown("KeyA") ? 1 : 0);
      const cos = Math.cos(player.angle);
      const sin = Math.sin(player.angle);
      player.update(dt, { ax: cos * fwd - sin * strafe, ay: sin * fwd + cos * strafe }, false);
    } else {
      player.update(dt, kb?.axis() ?? { ax: 0, ay: 0 });
    }

    // --- which room are we in (with a little hysteresis in the doorway)
    const nextRoom: RoomId = this.roomId === "vault" ? (player.x > WH_OX + 2 ? "warehouse" : "vault") : player.x < WH_OX - 2 ? "vault" : "warehouse";
    if (nextRoom !== this.roomId) {
      this.roomId = nextRoom;
      this.hover = null;
      this.applyView();
      this.callbacks.onRoom?.(nextRoom);
    }

    // walking past the tank drags a small bow wave along the glass
    if (Math.abs(player.vx) > 5 && player.y < TANK_SOLID.y + TANK_SOLID.h + 40 && player.x > TANK_GLASS.x - 12 && player.x < TANK_GLASS.x + TANK_GLASS.w + 12) {
      const frac = (player.x - TANK_GLASS.x) / TANK_GLASS.w;
      const push = Math.abs(player.vx) * dt * 1.5;
      tank.nudge(frac + Math.sign(player.vx) * 0.1, push);
      tank.nudge(frac - Math.sign(player.vx) * 0.06, -push);
    }

    // --- tank (the simulation runs in both views; first person samples its pixels)
    this.fillShown = easeLevel(this.fillShown, this.fillTarget, dt);
    tank.setFill(this.fillShown);
    tank.update(dt, this.lowPower);

    // --- customers
    for (const gone of customers.update(dt)) {
      const el = this.bubbles.get(gone);
      if (el) this.labels.remove(el);
      this.bubbles.delete(gone);
    }

    if (fpMode) {
      const fp = this.fp;
      if (fp) {
        fp.setFluid(tank.image);
        fp.render({ x: player.x, y: player.y - 2.5, angle: player.angle }, customers.all, this.time);
      }
    } else {
      room.update(dt);
      warehouse.update(dt);
    }

    // --- customer name bubbles
    for (const [c, el] of this.bubbles) {
      if (c.phase === "leaving") {
        this.labels.show(el, false);
        continue;
      }
      const bounce = c.phase === "waiting" ? Math.round(Math.abs(Math.sin(c.waited * 3)) * 1.5) : 0;
      if (fpMode) {
        // people in a line overlap on screen: step their name tags up so each stays readable
        const at = this.toScreen(c.x, c.y - 2, PERSON_H + 4 + bounce, 0);
        this.placeOrHide(el, at ? { x: at.x, y: at.y - (c.slot > 0 ? ((c.slot - 1) % 2) + 1 : 0) * 9 } : null);
      } else {
        // stagger the bubbles of people standing in line so the names stay readable
        const tier = c.slot > 0 ? ((c.slot - 1) % 2) + 1 : 0;
        this.placeOrHide(el, this.toScreen(c.x, c.y, 0, 20 + bounce + tier * 10));
      }
      const z = String(10 - c.slot);
      if (el.style.zIndex !== z) el.style.zIndex = z;
      this.labels.text(el, c.buyer.pings > 1 ? `${c.buyer.name} x${c.buyer.pings}` : c.buyer.name);
    }

    // --- interact prompt and the crate bubble
    this.current = this.inputEnabled ? this.pickTarget() : null;
    const cur = this.current;
    const focus = cur?.kind === "crate" ? this.crateById(cur.id) : !fpMode && this.inputEnabled ? this.hover : null;
    if (focus) {
      const i = focus.item;
      this.labels.text(this.elCrate, `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""} · ${focus.listed ? "LISTED · " : ""}${i.basis === "exact" ? "" : "~"}${fmt(i.total)}p`);
      const color = focus.listed ? LISTED_CSS : TIER_CSS[focus.tier];
      if (this.elCrate.style.borderColor !== color) this.elCrate.style.borderColor = color;
      const cx = focus.rect.x + focus.rect.w / 2;
      const at = fpMode ? this.toScreen(cx, focus.rect.y + focus.rect.h / 2, crateTop(focus.shape.h) + 6, 0) : this.toScreen(cx, focus.rect.y, 0, crateLift(focus.shape.h) + 4);
      this.placeOrHide(this.elCrate, at ?? (fpMode ? { x: VIEW_W / 2, y: VIEW_H - 62 } : null));
    } else {
      this.labels.show(this.elCrate, false);
    }
    if (cur) {
      const text =
        cur.kind === "tank"
          ? "Vault"
          : cur.kind === "counter"
            ? "Counter"
            : cur.kind === "customer"
              ? `Serve ${cur.buyer.name}`
              : cur.kind === "crate"
                ? focus?.listed
                  ? "Listed"
                  : "List for sale"
                : `${BAYS.find((b) => b.key === cur.category)?.label ?? "Bay"} terminal`;
      this.labels.text(this.elPrompt, text);
      if (fpMode) this.labels.place(this.elPrompt, VIEW_W / 2, VIEW_H - 34);
      else this.labels.place(this.elPrompt, clamp(player.x - this.camX, 20, VIEW_W - 20), player.y - (focus ? 34 + crateLift(focus.shape.h) : 24));
    }
    this.labels.show(this.elPrompt, cur !== null);
    this.stage.classList.toggle("vt-station-stage-target", fpMode && cur !== null);

    // --- "+25p" floaters over the tank
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age > 2.2) {
        this.labels.remove(f.el);
        this.floaters.splice(i, 1);
        continue;
      }
      const at = fpMode ? this.toScreen(f.x, TANK_SOLID.y + TANK_SOLID.h + 1, 44 + f.age * 6, 0) : this.toScreen(f.x, f.y, 0, f.age * 9);
      this.placeOrHide(f.el, at);
      f.el.style.opacity = String(clamp(2.2 - f.age, 0, 1));
    }
  };
}
