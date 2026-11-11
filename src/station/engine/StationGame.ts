import { Application, Container } from "pixi.js";
import { Customers, type Customer } from "../entities/customers";
import { Player } from "../entities/player";
import { TankView, goalLineY } from "../fluid/TankView";
import { distToRect, pointInRect } from "./collision";
import {
  COUNTER,
  COUNTER_SOLID,
  FLOOR,
  INTERACT_RANGE,
  PAL,
  TANK_FILL_GOAL,
  TANK_FILL_MIN,
  TANK_FRAME,
  TANK_GLASS,
  TANK_SOLID,
  TANK_USE,
  VIEW_H,
  VIEW_W,
} from "./constants";
import { Keyboard } from "./input";
import { LabelLayer } from "./labels";
import { clamp, easeLevel, planSurge, progressToFill, type Buyer, type GoalSnapshot } from "./logic";
import { READOUT, Room, SIGN } from "./room";

export type InteractTarget = { kind: "tank" } | { kind: "counter" } | { kind: "customer"; buyer: Buyer };

export interface StationCallbacks {
  onInteract(target: InteractTarget): void;
  onDebugBuyer(): void;
  onDebugSale(): void;
  onError(message: string): void;
}

interface Floater {
  el: HTMLDivElement;
  age: number;
  x: number;
  y: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/**
 * Owns the Pixi application, the scene and the game loop. Created and destroyed
 * by the React page; everything the page needs goes through the small public API.
 */
export class StationGame {
  private app: Application | null = null;
  private destroyed = false;
  private stage: HTMLDivElement;
  private labels: LabelLayer;
  private resizeObserver: ResizeObserver | null = null;
  private keyboard: Keyboard | null = null;

  private room: Room | null = null;
  private tank: TankView | null = null;
  private player: Player | null = null;
  private customers: Customers | null = null;
  private bubbles = new Map<Customer, HTMLDivElement>();
  private floaters: Floater[] = [];

  private goal: GoalSnapshot | null = null;
  private fillTarget = progressToFill(0.5, TANK_FILL_MIN, TANK_FILL_GOAL);
  private fillShown = this.fillTarget;
  private lowPower = false;
  private inputEnabled = true;
  private current: InteractTarget | null = null;

  private elPlat: HTMLDivElement;
  private elGoal: HTMLDivElement;
  private elToday: HTMLDivElement;
  private elGoalLine: HTMLDivElement;
  private elPrompt: HTMLDivElement;

  constructor(
    private host: HTMLElement,
    private callbacks: StationCallbacks,
  ) {
    this.stage = document.createElement("div");
    this.stage.className = "vt-station-stage";
    host.appendChild(this.stage);
    this.labels = new LabelLayer(this.stage);

    const title = this.labels.add("vt-station-readout-title", "VAULT");
    this.labels.place(title, READOUT.x + 5, READOUT.y + 3);
    this.elPlat = this.labels.add("vt-station-readout-plat", "--");
    this.labels.place(this.elPlat, READOUT.x + 5, READOUT.y + 9);
    this.elGoal = this.labels.add("vt-station-readout-goal", "");
    this.labels.place(this.elGoal, READOUT.x + READOUT.w - 5, READOUT.y + 4);
    this.elToday = this.labels.add("vt-station-readout-today", "");
    this.labels.place(this.elToday, READOUT.x + 5, READOUT.y + 30);
    this.elGoalLine = this.labels.add("vt-station-goal-line", "GOAL");
    this.labels.place(this.elGoalLine, TANK_GLASS.x + TANK_GLASS.w / 2, goalLineY() - 1);
    const sign = this.labels.add("vt-station-sign", "TRADE DESK");
    this.labels.place(sign, SIGN.x + SIGN.w / 2, SIGN.y + SIGN.h / 2);
    this.elPrompt = this.labels.add("vt-station-prompt", "");
    this.labels.show(this.elPrompt, false);
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
    this.stage.insertBefore(app.canvas, this.labels.root);

    // --- scene
    this.room = new Room();
    this.tank = new TankView(this.fillShown);
    this.player = new Player();
    const sorted = new Container();
    sorted.sortableChildren = true;
    this.customers = new Customers(sorted);
    sorted.addChild(this.room.counter, this.player.sprite.view);
    app.stage.addChild(this.room.back, this.tank.view, sorted, this.room.front);
    this.applyLowPower();

    // --- input
    this.keyboard = new Keyboard(this.handlePress);
    this.keyboard.enabled = this.inputEnabled;
    app.canvas.addEventListener("pointerdown", this.handlePointer);
    document.addEventListener("visibilitychange", this.handleVisibility);

    // --- layout
    this.resizeObserver = new ResizeObserver(this.layout);
    this.resizeObserver.observe(this.host);
    this.layout();

    app.ticker.add(this.tick);
    if (!document.hidden) app.ticker.start();
    if (this.goal) this.renderGoal();
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
    if (!enabled) this.player?.stop();
  }

  setLowPower(low: boolean) {
    this.lowPower = low;
    this.applyLowPower();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.keyboard?.destroy();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    const app = this.app;
    if (app) {
      app.canvas.removeEventListener("pointerdown", this.handlePointer);
      app.ticker.remove(this.tick);
      app.ticker.stop();
      this.customers?.destroy();
      this.tank?.destroy();
      app.destroy({ removeView: true }, { children: true, texture: true });
      this.app = null;
    }
    this.bubbles.clear();
    this.floaters = [];
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
  }

  private renderGoal() {
    const g = this.goal;
    if (!g) return;
    this.labels.text(this.elPlat, `${fmt(g.platinum)}p`);
    this.labels.text(this.elGoal, `GOAL ${fmt(g.goal)}p`);
    this.labels.text(this.elToday, `today ${fmt(g.profit_today)} / ${fmt(g.daily_target)}p`);
    this.labels.text(this.elGoalLine, `GOAL ${fmt(g.goal)}p`);
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
    }
  };

  private handlePointer = (e: PointerEvent) => {
    if (!this.inputEnabled || !this.app || !this.player || !this.customers) return;
    const rect = this.app.canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    const hit = this.customers.at(x, y);
    if (hit) {
      this.callbacks.onInteract({ kind: "customer", buyer: hit.buyer });
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
  };

  private pickTarget(): InteractTarget | null {
    const p = this.player;
    const customers = this.customers;
    if (!p || !customers) return null;
    const near = customers.nearest(p.x, p.y, INTERACT_RANGE);
    if (near) return { kind: "customer", buyer: near.buyer };
    if (distToRect(p.x, p.y, COUNTER_SOLID) < 14) {
      const head = customers.head;
      return head ? { kind: "customer", buyer: head.buyer } : { kind: "counter" };
    }
    if (distToRect(p.x, p.y, TANK_SOLID) < 16) return { kind: "tank" };
    return null;
  }

  private tick = () => {
    const app = this.app;
    const { room, tank, player, customers } = this;
    if (!app || !room || !tank || !player || !customers) return;
    const dt = Math.min(app.ticker.deltaMS / 1000, 0.05);

    // --- player
    player.update(dt, this.keyboard?.axis() ?? { ax: 0, ay: 0 });

    // walking past the tank drags a small bow wave along the glass
    if (Math.abs(player.vx) > 5 && player.y < TANK_SOLID.y + TANK_SOLID.h + 40 && player.x > TANK_GLASS.x - 12 && player.x < TANK_GLASS.x + TANK_GLASS.w + 12) {
      const frac = (player.x - TANK_GLASS.x) / TANK_GLASS.w;
      const push = Math.abs(player.vx) * dt * 1.5;
      tank.nudge(frac + Math.sign(player.vx) * 0.1, push);
      tank.nudge(frac - Math.sign(player.vx) * 0.06, -push);
    }

    // --- tank
    this.fillShown = easeLevel(this.fillShown, this.fillTarget, dt);
    tank.setFill(this.fillShown);
    tank.update(dt, this.lowPower);

    // --- customers and their name bubbles
    for (const gone of customers.update(dt)) {
      const el = this.bubbles.get(gone);
      if (el) this.labels.remove(el);
      this.bubbles.delete(gone);
    }
    for (const [c, el] of this.bubbles) {
      const leaving = c.phase === "leaving";
      this.labels.show(el, !leaving);
      if (leaving) continue;
      const bounce = c.phase === "waiting" ? Math.round(Math.abs(Math.sin(c.waited * 3)) * 1.5) : 0;
      // stagger the bubbles of people standing in line so the names stay readable
      const tier = c.slot > 0 ? ((c.slot - 1) % 2) + 1 : 0;
      this.labels.place(el, c.x, c.y - 20 - bounce - tier * 10);
      const z = String(10 - c.slot);
      if (el.style.zIndex !== z) el.style.zIndex = z;
      this.labels.text(el, c.buyer.pings > 1 ? `${c.buyer.name} x${c.buyer.pings}` : c.buyer.name);
    }

    room.update(dt);

    // --- interact prompt
    this.current = this.inputEnabled ? this.pickTarget() : null;
    if (this.current) {
      const text = this.current.kind === "tank" ? "Vault" : this.current.kind === "counter" ? "Counter" : `Serve ${this.current.buyer.name}`;
      this.labels.text(this.elPrompt, text);
      this.labels.place(this.elPrompt, player.x, player.y - 24);
    }
    this.labels.show(this.elPrompt, this.current !== null);

    // --- "+25p" floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age > 2.2) {
        this.labels.remove(f.el);
        this.floaters.splice(i, 1);
        continue;
      }
      this.labels.place(f.el, f.x, f.y - f.age * 9);
      f.el.style.opacity = String(clamp(2.2 - f.age, 0, 1));
    }
  };
}
