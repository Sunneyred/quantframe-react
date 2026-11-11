import { Application, Container } from "pixi.js";
import { dirFromAngle } from "../entities/character";
import { Customers, type Customer } from "../entities/customers";
import { Player } from "../entities/player";
import { TankView, goalLineY } from "../fluid/TankView";
import { FirstPersonView, PERSON_H, crateTop } from "../fp/FirstPersonView";
import { distToRect, isBlocked, nearestOnRect, pointInRect } from "./collision";
import {
  COUNTER,
  COUNTER_SOLID,
  DOOR,
  DOOR_VAULT_SIDE,
  DOOR_WH_SIDE,
  FIXTURES,
  FLOORS,
  INTERACT_RANGE,
  PAL,
  RACK,
  ROOMS,
  ROW_H,
  SOLIDS,
  SOUTH_DOOR,
  TANK_FILL_GOAL,
  TANK_FILL_MIN,
  TANK_FRAME,
  TANK_GLASS,
  TANK_SOLID,
  TANK_USE,
  VIEW_H,
  VIEW_W,
  WH_OX,
  fixtureById,
  roomAt,
  terminalRect,
  type Fixture,
  type FixtureId,
  type Rect,
  type RoomId,
} from "./constants";
import { Keyboard } from "./input";
import { LabelLayer } from "./labels";
import { clamp, easeLevel, planSurge, progressToFill, type Buyer, type GoalSnapshot } from "./logic";
import { BridgeRoom, ShopRoom, Terminals, type TraderState } from "./lowerRooms";
import { READOUT, Room, SIGN } from "./room";
import { EMPTY_SHOP, statusCss, statusText, type ShopCrate, type ShopLayout, type WantedBoard } from "./shop";
import { BAYS, LISTED_CSS, TIER_CSS, layoutWarehouse, type BayKey, type Crate, type WarehouseLayout } from "./warehouse";
import { WarehouseRoom, crateLift } from "./warehouseRoom";

export type InteractTarget =
  | { kind: "tank" }
  | { kind: "counter" }
  | { kind: "customer"; buyer: Buyer }
  /** A stock crate, by the item's unique name. */
  | { kind: "crate"; id: string }
  /** The terminal at the end of a bay. */
  | { kind: "terminal"; category: BayKey }
  /** A lever, desk, terminal, wall plate or hatch (see FIXTURES). */
  | { kind: "fixture"; id: FixtureId }
  /** A stock item or stock riven on the Shop Floor shelves, by database id. */
  | { kind: "stock"; id: number }
  | { kind: "riven"; id: number }
  /** A wanted poster (wish list entry). */
  | { kind: "wish"; id: number };

export type ViewMode = "top" | "fp";
export type { RoomId };

/** Every door you can click in the top-down view: where it is on screen, and the walk through it. */
const DOOR_LINKS: Array<{ room: RoomId; hit: Rect; to: { x: number; y: number }; via: { x: number; y: number } }> = [
  { room: "vault", hit: { x: SOUTH_DOOR.x - 4, y: 256, w: SOUTH_DOOR.w + 8, h: 16 }, to: { x: 238, y: ROW_H + 84 }, via: { x: 238, y: 252 } },
  { room: "warehouse", hit: { x: SOUTH_DOOR.x - 4, y: 256, w: SOUTH_DOOR.w + 8, h: 16 }, to: { x: WH_OX + 238, y: ROW_H + 84 }, via: { x: WH_OX + 238, y: 252 } },
  { room: "bridge", hit: { x: SOUTH_DOOR.x - 4, y: 0, w: SOUTH_DOOR.w + 8, h: 70 }, to: { x: 238, y: 250 }, via: { x: 238, y: ROW_H + 78 } },
  { room: "shop", hit: { x: SOUTH_DOOR.x - 4, y: 0, w: SOUTH_DOOR.w + 8, h: 70 }, to: { x: WH_OX + 238, y: 250 }, via: { x: WH_OX + 238, y: ROW_H + 78 } },
  { room: "bridge", hit: { x: DOOR.x - 6, y: DOOR.y - 4, w: 16, h: DOOR.h + 8 }, to: { x: DOOR_WH_SIDE.x, y: ROW_H + DOOR_WH_SIDE.y }, via: { x: DOOR_VAULT_SIDE.x, y: ROW_H + DOOR_VAULT_SIDE.y } },
  { room: "shop", hit: { x: 0, y: DOOR.y - 4, w: 14, h: DOOR.h + 8 }, to: { x: DOOR_VAULT_SIDE.x, y: ROW_H + DOOR_VAULT_SIDE.y }, via: { x: DOOR_WH_SIDE.x, y: ROW_H + DOOR_WH_SIDE.y } },
];

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
  /** M, K or /, H or ? were pressed. */
  onOverlay?(which: "map" | "palette" | "help"): void;
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
  private labelsBridge: LabelLayer;
  private labelsShop: LabelLayer;
  private labels: LabelLayer;
  private resizeObserver: ResizeObserver | null = null;
  private keyboard: Keyboard | null = null;
  private fp: FirstPersonView | null = null;

  private world: Container | null = null;
  private room: Room | null = null;
  private warehouse: WarehouseRoom | null = null;
  private bridge: BridgeRoom | null = null;
  private shop: ShopRoom | null = null;
  private terminals: Terminals | null = null;
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
  private camY = 0;
  private hover: Crate | null = null;
  private hoverShop: ShopCrate | null = null;
  private shopData: ShopLayout = EMPTY_SHOP;
  private trader: TraderState = { running: false, message: "" };
  private trades: number | null = null;
  private alerts = new Map<FixtureId, boolean>();
  private paused = false;
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
    this.labelsBridge = new LabelLayer(this.stage);
    this.labelsShop = new LabelLayer(this.stage);
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
    v.place(v.add("vt-station-door-tag vt-station-door-tag-mid", "CONTROL DECK"), SOUTH_DOOR.x + SOUTH_DOOR.w / 2, VIEW_H - 11);
    const w = this.labelsWh;
    w.place(w.add("vt-station-door-tag vt-station-door-tag-mid", "SHOP FLOOR"), SOUTH_DOOR.x + SOUTH_DOOR.w / 2, VIEW_H - 11);

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
    this.bridge = new BridgeRoom(sorted, this.labelsBridge);
    this.bridge.setTrader(this.trader);
    this.bridge.setTrades(this.trades);
    if (this.goal) this.bridge.setGoal(this.goal);
    this.shop = new ShopRoom(sorted, this.labelsShop);
    this.shop.setLayout(this.shopData);
    this.terminals = new Terminals(sorted, { vault: this.labelsVault, warehouse: this.labelsWh, bridge: this.labelsBridge, shop: this.labelsShop });
    for (const [id, on] of this.alerts) this.terminals.setAlert(id, on);
    sorted.addChild(this.room.counter, this.player.sprite.view);
    const world = new Container();
    world.addChild(this.room.back, this.warehouse.back, this.bridge.back, this.shop.back, this.tank.view, sorted, this.room.front);
    app.stage.addChild(world);
    this.world = world;

    // --- first-person renderer over the same state
    this.fp = new FirstPersonView(this.stage, this.labelsVault.root);
    this.fp.setLayout(this.layoutData);
    this.fp.setShop(this.shopData);
    this.fp.setTrader(this.trader);
    this.fp.setTrades(this.trades);
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
    if (!document.hidden && !this.paused) app.ticker.start();
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
    this.bridge?.setGoal(goal);
  }

  /** New Shop Floor stock (stock items, stock rivens, wish list). */
  setShop(layout: ShopLayout) {
    this.shopData = layout;
    this.hoverShop = null;
    this.shop?.setLayout(layout);
    this.fp?.setShop(layout);
  }

  /** Running state and status line of the live trader, shown on the Control Deck. */
  setTrader(state: TraderState) {
    if (state.running === this.trader.running && state.message === this.trader.message) return;
    this.trader = state;
    this.bridge?.setTrader(state);
    this.fp?.setTrader(state);
  }

  /** Trades left today for the docks board, or null when unknown. */
  setTrades(trades: number | null) {
    this.trades = trades;
    this.bridge?.setTrades(trades);
    this.fp?.setTrades(trades);
  }

  /** Flash a terminal's screen (unread chat on the comms terminal). */
  setAlert(id: FixtureId, on: boolean) {
    this.alerts.set(id, on);
    this.terminals?.setAlert(id, on);
  }

  /** Fast travel: put the player somewhere, facing a direction. */
  travelTo(x: number, y: number, angle: number) {
    const p = this.player;
    if (!p) return;
    p.stop();
    p.x = x;
    p.y = y;
    p.angle = angle;
    p.sprite.dir = dirFromAngle(angle);
    p.sprite.setPosition(x, y);
    this.keyboard?.clear();
    // while paused nothing ticks: switch rooms now so the view is right when the panel closes
    this.syncRoom(true);
  }

  travelToFixture(id: FixtureId) {
    const f = fixtureById(id);
    this.travelTo(f.use.x, f.use.y, f.face);
  }

  travelToRoom(room: RoomId) {
    const { ox, oy } = ROOMS[room];
    this.travelTo(ox + 238, oy + 190, -Math.PI / 2);
  }

  get position(): { x: number; y: number; room: RoomId } {
    return { x: this.player?.x ?? 0, y: this.player?.y ?? 0, room: this.roomId };
  }

  /** Stop drawing and simulating while something covers the whole station. */
  setPaused(paused: boolean) {
    this.paused = paused;
    const app = this.app;
    if (!app) return;
    if (paused) app.ticker.stop();
    else if (!document.hidden) app.ticker.start();
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

  /** The buyer at the front of the queue, if anyone is waiting. */
  get nextBuyer(): Buyer | null {
    return this.customers?.head?.buyer ?? null;
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
      this.current = null;
      this.labels.show(this.elPrompt, false);
      this.labels.show(this.elCrate, false);
      this.stage.classList.remove("vt-station-stage-target");
    }
    this.updateHint();
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
      this.bridge?.destroy();
      this.shop?.destroy();
      this.terminals?.destroy();
      this.tank?.destroy();
      app.destroy({ removeView: true }, { children: true, texture: true });
      this.app = null;
    }
    this.bubbles.clear();
    this.floaters = [];
    this.labelsVault.destroy();
    this.labelsWh.destroy();
    this.labelsBridge.destroy();
    this.labelsShop.destroy();
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
    this.labelsBridge.root.style.display = top && this.roomId === "bridge" ? "" : "none";
    this.labelsShop.root.style.display = top && this.roomId === "shop" ? "" : "none";
    this.camX = ROOMS[this.roomId].ox;
    this.camY = ROOMS[this.roomId].oy;
    if (this.world) this.world.position.set(-this.camX, -this.camY);
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
    } else if (!this.paused) {
      app.ticker.start();
    }
  };

  /** Follow the player into another room (with a little hysteresis in the doorways). */
  private syncRoom(now = false) {
    const p = this.player;
    if (!p) return;
    const { ox, oy } = ROOMS[this.roomId];
    const m = now ? 0 : 2;
    if (p.x >= ox - m && p.x <= ox + VIEW_W + m && p.y >= oy - m && p.y <= oy + ROW_H + m) return;
    const next = roomAt(p.x, p.y);
    if (next === this.roomId) return;
    this.roomId = next;
    this.hover = null;
    this.hoverShop = null;
    this.applyView();
    this.callbacks.onRoom?.(next);
  }

  private handlePress = (code: string, key: string) => {
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
      case "KeyM":
        this.callbacks.onOverlay?.("map");
        break;
      case "KeyK":
        this.callbacks.onOverlay?.("palette");
        break;
      case "KeyH":
        this.callbacks.onOverlay?.("help");
        break;
      case "Slash":
        this.callbacks.onOverlay?.(key === "?" ? "help" : "palette");
        break;
    }
  };

  private toWorld(e: PointerEvent): { x: number; y: number } | null {
    if (!this.app) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    return { x: ((e.clientX - rect.left) / rect.width) * VIEW_W + this.camX, y: ((e.clientY - rect.top) / rect.height) * VIEW_H + this.camY };
  }

  /** Where a fixture is drawn on screen in the top-down view (world coordinates). */
  private fixtureArt(f: Fixture): Rect {
    const { ox, oy } = ROOMS[f.room];
    if (f.kind === "wall" && f.plate) return { x: ox + f.plate.x, y: oy + f.plate.y, w: f.plate.w, h: f.plate.h };
    if (f.kind === "hatch") return f.rect;
    return { x: f.rect.x, y: f.rect.y - 8, w: f.rect.w, h: f.rect.h + 8 };
  }

  private fixtureReach(f: Fixture): number {
    const fp = this.mode === "fp";
    return f.kind === "terminal" ? (fp ? 22 : 13) : f.kind === "wall" ? (fp ? 30 : 18) : f.kind === "hatch" ? (fp ? 20 : 14) : fp ? 24 : 14;
  }

  private boardStrip(b: WantedBoard): Rect {
    const { ox, oy } = ROOMS.shop;
    return { x: ox + b.plate.x, y: oy + 70, w: b.plate.w, h: 1 };
  }

  /** Can a body walk the straight line between two points? */
  private lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3));
    for (let i = 1; i <= n; i++) {
      if (isBlocked(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, FLOORS, SOLIDS)) return false;
    }
    return true;
  }

  /**
   * Click-to-move with a little route finding: every leg that a desk or shelf
   * blocks is bent into an L (one corner), whichever of the two corners is free.
   */
  private walkTo(x: number, y: number, via: Array<{ x: number; y: number }> = []) {
    const p = this.player;
    if (!p) return;
    const path: Array<{ x: number; y: number }> = [];
    let from = { x: p.x, y: p.y };
    for (const to of [...via, { x, y }]) {
      if (!this.lineClear(from.x, from.y, to.x, to.y)) {
        const corners = [
          { x: to.x, y: from.y },
          { x: from.x, y: to.y },
        ];
        const corner = corners.find((c) => this.lineClear(from.x, from.y, c.x, c.y) && this.lineClear(c.x, c.y, to.x, to.y));
        if (corner) path.push(corner);
        else {
          // shelves in the way on both corners: go round by the clear lane along the bottom or the top of the room
          const oy = ROOMS[roomAt(from.x, from.y)].oy;
          for (const lane of [oy + 252, oy + 80]) {
            if (this.lineClear(from.x, from.y, from.x, lane) && this.lineClear(from.x, lane, to.x, lane) && this.lineClear(to.x, lane, to.x, to.y)) {
              path.push({ x: from.x, y: lane }, { x: to.x, y: lane });
              break;
            }
          }
        }
      }
      path.push(to);
      from = to;
    }
    const last = path.pop()!;
    p.moveTo(last.x, last.y, path);
  }

  private handlePointer = (e: PointerEvent) => {
    if (!this.inputEnabled || !this.player || !this.customers) return;
    const p = this.toWorld(e);
    if (!p) return;
    const { x, y } = p;
    const room = this.roomId;
    const { ox, oy } = ROOMS[room];
    const lx = x - ox;
    const ly = y - oy;
    if (room === "vault") {
      const hit = this.customers.at(x, y);
      if (hit) {
        this.callbacks.onInteract({ kind: "customer", buyer: hit.buyer });
        return;
      }
    }
    // --- doors: walk through to the other side
    const inDoor = ly >= DOOR.y - 4 && ly <= DOOR.y + DOOR.h + 4;
    if (room === "vault" && inDoor && lx >= DOOR.x - 6) {
      this.walkTo(DOOR_WH_SIDE.x, DOOR_WH_SIDE.y, [DOOR_VAULT_SIDE]);
      return;
    }
    if (room === "warehouse" && inDoor && lx <= 14) {
      this.walkTo(DOOR_VAULT_SIDE.x, DOOR_VAULT_SIDE.y, [DOOR_WH_SIDE]);
      return;
    }
    for (const d of DOOR_LINKS) {
      if (d.room === room && pointInRect(lx, ly, d.hit)) {
        this.walkTo(d.to.x, d.to.y, [d.via]);
        return;
      }
    }
    // --- stock
    if (room === "warehouse") {
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
    }
    if (room === "shop") {
      const crate = this.shop?.crateAt(x, y);
      if (crate) {
        this.callbacks.onInteract({ kind: crate.kind, id: crate.id });
        return;
      }
      for (const b of this.shopData.boards) {
        if (pointInRect(lx, ly, b.plate, 1)) {
          this.callbacks.onInteract({ kind: "wish", id: b.id });
          return;
        }
      }
    }
    // --- fixtures: use them when in reach, otherwise walk up to them
    for (const f of FIXTURES) {
      if (f.room !== room || !pointInRect(x, y, this.fixtureArt(f), 1)) continue;
      if (distToRect(this.player.x, this.player.y, f.rect) < this.fixtureReach(f)) this.callbacks.onInteract({ kind: "fixture", id: f.id });
      else this.walkTo(f.use.x, f.use.y);
      return;
    }
    if (room === "vault") {
      if (pointInRect(x, y, TANK_FRAME, 2)) {
        if (distToRect(this.player.x, this.player.y, TANK_SOLID) < INTERACT_RANGE) this.callbacks.onInteract({ kind: "tank" });
        else this.walkTo(clamp(x, TANK_SOLID.x + 6, TANK_SOLID.x + TANK_SOLID.w - 6), TANK_USE.y);
        return;
      }
      if (pointInRect(x, y, COUNTER)) {
        // walk to the staff side of the counter
        this.walkTo(clamp(x, COUNTER.x + 6, COUNTER.x + COUNTER.w - 6), COUNTER_SOLID.y - 2);
        return;
      }
    }
    this.walkTo(clamp(x, ox + 13, ox + VIEW_W - 13), clamp(y, oy + 76, oy + 261));
  };

  private handleHover = (e: PointerEvent) => {
    this.hover = null;
    this.hoverShop = null;
    if (!this.inputEnabled) return;
    const p = this.toWorld(e);
    if (p && this.roomId === "warehouse") this.hover = this.warehouse?.crateAt(p.x, p.y) ?? null;
    if (p && this.roomId === "shop") this.hoverShop = this.shop?.crateAt(p.x, p.y) ?? null;
    let pointer = this.hover !== null || this.hoverShop !== null;
    if (p && !pointer) {
      const { ox, oy } = ROOMS[this.roomId];
      for (const f of FIXTURES) if (f.room === this.roomId && pointInRect(p.x, p.y, this.fixtureArt(f), 1)) pointer = true;
      if (this.roomId === "shop") for (const b of this.shopData.boards) if (pointInRect(p.x - ox, p.y - oy, b.plate, 1)) pointer = true;
    }
    if (this.app) this.app.canvas.style.cursor = pointer ? "pointer" : "";
  };

  private handleLeave = () => {
    this.hover = null;
    this.hoverShop = null;
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
    } else if (this.roomId === "warehouse") {
      for (const c of this.layoutData.crates) out.push(this.rectCandidate({ kind: "crate", id: c.item.unique_name }, c.rect, fp ? 24 : 15, px, py));
      for (let i = 0; i < RACK.count; i++) out.push(this.rectCandidate({ kind: "terminal", category: BAYS[i].key }, terminalRect(i), fp ? 22 : 13, px, py));
    } else if (this.roomId === "shop") {
      for (const c of this.shopData.crates) out.push(this.rectCandidate({ kind: c.kind, id: c.id }, c.rect, fp ? 24 : 15, px, py));
      for (const b of this.shopData.boards) out.push(this.rectCandidate({ kind: "wish", id: b.id }, this.boardStrip(b), fp ? 30 : 18, px, py));
    }
    for (const f of FIXTURES) if (f.room === this.roomId) out.push(this.rectCandidate({ kind: "fixture", id: f.id }, f.rect, this.fixtureReach(f), px, py));
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
      const rank = (c: Candidate) => {
        const k = c.target.kind;
        if (k === "customer") return c.range > 20 ? 0 : 1;
        return k === "counter" ? 1 : k === "tank" || k === "fixture" ? 2 : k === "crate" || k === "stock" || k === "riven" ? 3 : 4;
      };
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
    const y = wy - this.camY;
    if (x < -4 || x > VIEW_W + 4 || y < -4 || y > VIEW_H + 24) return null;
    return { x, y: y - lift };
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

    // --- which room are we in
    this.syncRoom();

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
    } else if (this.roomId === "vault") {
      room.update(dt);
    } else if (this.roomId === "warehouse") {
      warehouse.update(dt);
    } else if (this.roomId === "bridge") {
      this.bridge?.update(dt);
    } else {
      this.shop?.update(dt);
    }
    if (!fpMode) this.terminals?.update(dt, this.roomId);

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
    const shopFocus = cur?.kind === "stock" || cur?.kind === "riven" ? (this.shopData.crates.find((c) => c.kind === cur.kind && c.id === cur.id) ?? null) : !fpMode && this.inputEnabled ? this.hoverShop : null;
    const board = cur?.kind === "wish" ? (this.shopData.boards.find((b) => b.id === cur.id) ?? null) : null;
    let lifted = 0;
    if (focus) {
      const i = focus.item;
      this.labels.text(this.elCrate, `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""} · ${focus.listed ? "LISTED · " : ""}${i.basis === "exact" ? "" : "~"}${fmt(i.total)}p`);
      const color = focus.listed ? LISTED_CSS : TIER_CSS[focus.tier];
      if (this.elCrate.style.borderColor !== color) this.elCrate.style.borderColor = color;
      const cx = focus.rect.x + focus.rect.w / 2;
      const at = fpMode ? this.toScreen(cx, focus.rect.y + focus.rect.h / 2, crateTop(focus.shape.h) + 6, 0) : this.toScreen(cx, focus.rect.y, 0, crateLift(focus.shape.h) + 4);
      this.placeOrHide(this.elCrate, at ?? (fpMode ? { x: VIEW_W / 2, y: VIEW_H - 62 } : null));
      lifted = crateLift(focus.shape.h);
    } else if (shopFocus) {
      const c = shopFocus;
      this.labels.text(this.elCrate, `${c.name}${c.quantity > 1 ? ` x${c.quantity}` : ""} · ${c.hidden ? "hidden" : statusText(c.status)} · ${c.listPrice ? `${fmt(c.listPrice)}p` : "no price yet"}`);
      const color = c.hidden ? "#8d89b8" : statusCss(c.status);
      if (this.elCrate.style.borderColor !== color) this.elCrate.style.borderColor = color;
      const cx = c.rect.x + c.rect.w / 2;
      const at = fpMode ? this.toScreen(cx, c.rect.y + c.rect.h / 2, crateTop(c.shape.h) + 6, 0) : this.toScreen(cx, c.rect.y, 0, crateLift(c.shape.h) + 4);
      this.placeOrHide(this.elCrate, at ?? (fpMode ? { x: VIEW_W / 2, y: VIEW_H - 62 } : null));
      lifted = crateLift(c.shape.h);
    } else if (board) {
      this.labels.text(this.elCrate, `Wanted: ${board.name}${board.quantity > 1 ? ` x${board.quantity}` : ""} · ${board.hidden ? "hidden" : statusText(board.status)}${board.maxPrice !== null ? ` · max ${fmt(board.maxPrice)}p` : ""}`);
      const color = board.hidden ? "#8d89b8" : statusCss(board.status);
      if (this.elCrate.style.borderColor !== color) this.elCrate.style.borderColor = color;
      const bx = ROOMS.shop.ox + board.plate.x + board.plate.w / 2;
      const at = fpMode ? this.toScreen(bx, ROOMS.shop.oy + 70, 18, 0) : { x: clamp(bx - this.camX, 40, VIEW_W - 40), y: board.plate.y + board.plate.h + 14 };
      this.placeOrHide(this.elCrate, at ?? (fpMode ? { x: VIEW_W / 2, y: VIEW_H - 62 } : null));
    } else {
      this.labels.show(this.elCrate, false);
    }
    if (cur) {
      let text: string;
      switch (cur.kind) {
        case "tank":
          text = "Vault";
          break;
        case "counter":
          text = "Counter";
          break;
        case "customer":
          text = `Serve ${cur.buyer.name}`;
          break;
        case "crate":
          text = focus?.listed ? "Listed" : "List for sale";
          break;
        case "terminal":
          text = `${BAYS.find((b) => b.key === cur.category)?.label ?? "Bay"} terminal`;
          break;
        case "stock":
          text = "Sell or edit";
          break;
        case "riven":
          text = "Riven: sell or edit";
          break;
        case "wish":
          text = "Buy order";
          break;
        case "fixture":
          text = cur.id === "lever" ? (this.trader.running ? "Stop the trader" : "Start the trader") : fixtureById(cur.id).prompt;
          break;
      }
      this.labels.text(this.elPrompt, text);
      if (fpMode) this.labels.place(this.elPrompt, VIEW_W / 2, VIEW_H - 34);
      else {
        // a console or desk is right above the player: put the prompt under their feet so it does not cover it
        const kind = cur.kind === "fixture" ? fixtureById(cur.id).kind : "";
        const under = kind === "lever" || kind === "desk";
        this.labels.place(this.elPrompt, clamp(player.x - this.camX, 20, VIEW_W - 20), under ? player.y - this.camY + 17 : Math.max(14, player.y - this.camY - (lifted ? 34 + lifted : 24)));
      }
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
