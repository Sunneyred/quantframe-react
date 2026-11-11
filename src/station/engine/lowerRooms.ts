import { Container, Graphics } from "pixi.js";
import { Character, type CharacterPalette } from "../entities/character";
import {
  DOOR,
  FIXTURES,
  MANAGER_POS,
  PAL,
  RIVEN_CASE,
  ROOMS,
  SHOP_DISPLAY,
  SHOP_RACK,
  SOUTH_DOOR,
  TRADER_DISPLAY,
  WANTED,
  fixtureById,
  rivenCaseRect,
  shopRackRect,
  wantedPlate,
  type Fixture,
  type FixtureId,
  type Rect,
  type RoomId,
} from "./constants";
import type { LabelLayer } from "./labels";
import type { GoalSnapshot } from "./logic";
import { drawCrateBox, drawPlate, drawRack, drawShell, drawTerminalBody, drawTerminalScreen, lookOf, mixHex } from "./shell";
import { EMPTY_SHOP, statusCss, statusHex, type ShopCrate, type ShopLayout } from "./shop";
import { crateLift } from "./warehouseRoom";

const fmt = (n: number) => Math.round(n).toLocaleString();

export interface TraderState {
  running: boolean;
  /** Current status line of the live trader (already translated), or "". */
  message: string;
}

export const MANAGER_PALETTE: CharacterPalette = { suit: 0x8a6a2f, suitDark: 0x5c4310, trim: PAL.goldLight, head: 0x2b2a4d, visor: PAL.gold };
export const RIVEN_HEX = 0xb388ff;

// ---------------------------------------------------------------------------
// Terminals (all rooms)
// ---------------------------------------------------------------------------

/** The standing terminals of every room: body, animated screen and a name tag under each. */
export class Terminals {
  private items: Array<{ f: Fixture; body: Graphics; screen: Graphics; seed: number }> = [];
  private alerts = new Set<FixtureId>();
  private time = 0;

  constructor(sorted: Container, labels: Record<RoomId, LabelLayer>) {
    FIXTURES.forEach((f, seed) => {
      if (f.kind !== "terminal") return;
      const body = new Graphics();
      drawTerminalBody(body, f.rect);
      body.zIndex = f.rect.y + f.rect.h;
      const screen = new Graphics();
      screen.zIndex = f.rect.y + f.rect.h + 0.5;
      sorted.addChild(body, screen);
      this.items.push({ f, body, screen, seed });
      const { ox, oy } = ROOMS[f.room];
      const tag = labels[f.room].add("vt-station-fx-tag", f.label);
      labels[f.room].place(tag, f.rect.x - ox + f.rect.w / 2, f.rect.y - oy + f.rect.h + 3);
    });
  }

  /** Make a terminal's screen flash (something is waiting there). */
  setAlert(id: FixtureId, on: boolean) {
    if (on) this.alerts.add(id);
    else this.alerts.delete(id);
  }

  update(dt: number, room: RoomId) {
    this.time += dt;
    for (const it of this.items) {
      if (it.f.room !== room) continue;
      it.screen.clear();
      drawTerminalScreen(it.screen, it.f.rect, this.time, it.seed, this.alerts.has(it.f.id));
    }
  }

  destroy() {
    for (const it of this.items) {
      it.body.destroy();
      it.screen.destroy();
    }
    this.items = [];
  }
}

// ---------------------------------------------------------------------------
// Control Deck
// ---------------------------------------------------------------------------

const BR = ROOMS.bridge;

export class BridgeRoom {
  readonly back = new Container();
  private lights = new Graphics();
  private lever = new Graphics();
  private desk = new Graphics();
  readonly manager = new Character(MANAGER_PALETTE);
  private trader: TraderState = { running: false, message: "" };
  private trades: number | null = null;
  private leverPos = 0;
  private time = 0;

  private elState: HTMLDivElement;
  private elMsg: HTMLDivElement;
  private elToday: HTMLDivElement;
  private elTodaySub: HTMLDivElement;
  private elTrades: HTMLDivElement;

  constructor(
    sorted: Container,
    private labels: LabelLayer,
  ) {
    this.back.addChild(this.drawStatic(), this.lights);
    const lv = fixtureById("lever").rect;
    this.lever.zIndex = lv.y + lv.h;
    const dk = fixtureById("manager").rect;
    this.drawDesk(dk);
    this.desk.zIndex = dk.y + dk.h;
    this.manager.setPosition(MANAGER_POS.x, MANAGER_POS.y);
    this.manager.update(0);
    sorted.addChild(this.lever, this.desk, this.manager.view);

    const d = TRADER_DISPLAY;
    labels.place(labels.add("vt-station-readout-title", "LIVE TRADER"), d.x + 5, d.y + 3);
    this.elState = labels.add("vt-station-trader-state", "OFFLINE");
    labels.place(this.elState, d.x + 5, d.y + 10);
    this.elMsg = labels.add("vt-station-trader-msg", "");
    labels.place(this.elMsg, d.x + 5, d.y + 33);
    this.elMsg.style.maxWidth = `calc(var(--vt-u) * ${d.w - 10})`;

    const about = fixtureById("about").plate!;
    labels.place(labels.add("vt-station-sign vt-station-plaque", "INFO"), about.x + about.w / 2, about.y + about.h / 2 + 5);

    const ov = fixtureById("overview").plate!;
    labels.place(labels.add("vt-station-readout-title", "OVERVIEW"), ov.x + 5, ov.y + 3);
    this.elToday = labels.add("vt-station-plate-big", "--");
    labels.place(this.elToday, ov.x + 5, ov.y + 10);
    this.elTodaySub = labels.add("vt-station-wh-sub vt-station-plate-sub", "profit today");
    labels.place(this.elTodaySub, ov.x + 5, ov.y + 29);

    const dock = fixtureById("docks").plate!;
    labels.place(labels.add("vt-station-readout-title", "DOCKS"), dock.x + 5, dock.y + 3);
    this.elTrades = labels.add("vt-station-plate-big", "--");
    labels.place(this.elTrades, dock.x + 5, dock.y + 10);
    labels.place(labels.add("vt-station-wh-sub vt-station-plate-sub", "trades left today"), dock.x + 5, dock.y + 29);

    for (const id of ["lever", "manager", "hatch"] as const) {
      const f = fixtureById(id);
      const tag = labels.add("vt-station-fx-tag", id === "lever" ? "TRADER LEVER" : f.label);
      labels.place(tag, f.rect.x - BR.ox + f.rect.w / 2, f.rect.y - BR.oy + f.rect.h + 3);
    }
    labels.place(labels.add("vt-station-door-tag vt-station-door-tag-mid", "VAULT"), SOUTH_DOOR.x + SOUTH_DOOR.w / 2, 60);
    labels.place(labels.add("vt-station-door-tag", "SHOP FLOOR"), DOOR.x - 3, DOOR.y - 6);
    this.update(0);
  }

  private drawStatic(): Graphics {
    const g = new Graphics();
    const { ox, oy } = BR;
    drawShell(g, ox, oy, { north: true, east: true });
    const at = (r: Rect): Rect => ({ x: ox + r.x, y: oy + r.y, w: r.w, h: r.h });

    // info plaque: a gold plate with an "i"
    const a = at(fixtureById("about").plate!);
    g.rect(a.x - 1, a.y - 1, a.w + 2, a.h + 2).fill(PAL.goldDark);
    g.rect(a.x, a.y, a.w, a.h).fill(PAL.gold);
    g.rect(a.x + 2, a.y + 2, a.w - 4, a.h - 4).fill(0x0a0920);
    g.rect(a.x + a.w / 2 - 1, a.y + 4, 2, 2).fill(PAL.goldLight);
    g.rect(a.x + a.w / 2 - 1, a.y + 7, 2, 5).fill(PAL.goldLight);
    for (const [cx, cy] of [
      [a.x, a.y],
      [a.x + a.w - 2, a.y],
      [a.x, a.y + a.h - 2],
      [a.x + a.w - 2, a.y + a.h - 2],
    ])
      g.rect(cx, cy, 2, 2).fill(PAL.goldLight);

    // trader display, with a conduit down to the lever console
    const d = at(TRADER_DISPLAY);
    drawPlate(g, d);
    g.rect(d.x + d.w / 2 - 1, d.y + d.h + 2, 2, 62 - TRADER_DISPLAY.y - TRADER_DISPLAY.h - 2).fill(PAL.cyanDark);

    // overview screen: a small bar chart on the right of the plate
    const o = at(fixtureById("overview").plate!);
    drawPlate(g, o);
    const bars = [7, 13, 10, 16, 19];
    bars.forEach((h, i) => {
      const bx = o.x + o.w - 6 - (bars.length - i) * 5;
      g.rect(bx, o.y + o.h - 5 - h, 3, h).fill(i === bars.length - 1 ? PAL.gold : PAL.cyanDark);
      g.rect(bx, o.y + o.h - 5 - h, 3, 1).fill(i === bars.length - 1 ? PAL.goldLight : PAL.cyan);
    });
    g.rect(o.x + o.w - 33, o.y + o.h - 5, 29, 1).fill(PAL.metalLight);

    // docks board
    drawPlate(g, at(fixtureById("docks").plate!), PAL.goldDark);

    // maintenance hatch: a floor plate with hazard stripes
    const h = fixtureById("hatch").rect;
    g.rect(h.x - 1, h.y - 1, h.w + 2, h.h + 2).fill(PAL.goldDark);
    g.rect(h.x, h.y, h.w, h.h).fill(PAL.metalDark);
    for (let i = -h.h; i < h.w; i += 6) {
      for (let k = 0; k < h.h; k++) {
        const x = h.x + i + k;
        if (x >= h.x && x + 2 <= h.x + h.w && (k < 3 || k >= h.h - 3)) g.rect(x, h.y + k, 2, 1).fill(PAL.gold);
      }
    }
    g.rect(h.x + 3, h.y + 4, h.w - 6, h.h - 8).fill(PAL.metal);
    g.rect(h.x + h.w / 2 - 3, h.y + h.h / 2 - 1, 6, 2).fill(PAL.metalLight);
    g.rect(h.x + 4, h.y + 5, 1, 1).fill(PAL.goldLight);
    g.rect(h.x + h.w - 5, h.y + h.h - 6, 1, 1).fill(PAL.goldLight);

    // floor markings: a standing pad at the lever and a compass inlay
    const lv = fixtureById("lever");
    g.rect(lv.rect.x + 6, lv.rect.y + lv.rect.h + 6, lv.rect.w - 12, 1).fill({ color: PAL.gold, alpha: 0.55 });
    g.rect(lv.rect.x + 6, lv.rect.y + lv.rect.h + 18, lv.rect.w - 12, 1).fill({ color: PAL.gold, alpha: 0.3 });
    const cx = ox + 238;
    const cy = oy + 176;
    g.poly([cx, cy - 26, cx + 44, cy, cx, cy + 26, cx - 44, cy]).stroke({ width: 1, color: PAL.cyan, alpha: 0.3 });
    g.poly([cx, cy - 14, cx + 24, cy, cx, cy + 14, cx - 24, cy]).stroke({ width: 1, color: PAL.gold, alpha: 0.3 });
    g.rect(cx - 2, cy - 2, 4, 4).fill({ color: PAL.cyan, alpha: 0.5 });
    return g;
  }

  private drawDesk(c: Rect) {
    const g = this.desk;
    g.rect(c.x + 2, c.y + c.h, c.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
    g.rect(c.x, c.y - 6, c.w, 14).fill(PAL.metalLight);
    g.rect(c.x, c.y - 6, c.w, 1).fill(PAL.goldLight);
    g.rect(c.x + 2, c.y - 4, c.w - 4, 10).fill(PAL.metal);
    g.rect(c.x, c.y + 7, c.w, 1).fill(PAL.gold);
    g.rect(c.x, c.y + 8, c.w, c.h - 8).fill(PAL.metalDark);
    g.rect(c.x + 6, c.y + 11, c.w - 12, 1).fill(PAL.gold);
    g.rect(c.x, c.y + 8, 2, c.h - 8).fill(PAL.goldDark);
    g.rect(c.x + c.w - 2, c.y + 8, 2, c.h - 8).fill(PAL.goldDark);
    // a ledger slate and a little strategy board on the desk
    g.rect(c.x + 6, c.y - 2, 14, 7).fill(0x221c52);
    g.rect(c.x + 7, c.y - 1, 8, 1).fill(PAL.goldDark);
    g.rect(c.x + 7, c.y + 1, 11, 1).fill(PAL.goldDark);
    g.rect(c.x + c.w - 22, c.y - 3, 16, 8).fill(PAL.void);
    g.rect(c.x + c.w - 21, c.y - 2, 14, 6).fill(PAL.cyanDark);
    for (let i = 0; i < 4; i++) g.rect(c.x + c.w - 20 + i * 3, c.y + 3 - [2, 4, 3, 5][i], 2, [2, 4, 3, 5][i]).fill(PAL.cyanLight);
  }

  setTrader(state: TraderState) {
    this.trader = state;
    this.labels.text(this.elState, state.running ? "RUNNING" : "OFFLINE");
    this.elState.classList.toggle("vt-station-trader-on", state.running);
    this.labels.text(this.elMsg, state.running ? state.message || "Working through your stock..." : "Pull the lever to start trading");
  }

  setGoal(goal: GoalSnapshot) {
    this.labels.text(this.elToday, `${goal.profit_today >= 0 ? "+" : ""}${fmt(goal.profit_today)}p`);
    this.labels.text(this.elTodaySub, goal.daily_target > 0 ? `today · target ${fmt(goal.daily_target)}p` : "profit today");
  }

  /** Trades left today, or null when the inventory link does not say. */
  setTrades(trades: number | null) {
    this.trades = trades;
    this.labels.text(this.elTrades, trades === null ? "--" : String(trades));
    this.elTrades.classList.toggle("vt-station-plate-warn", trades !== null && trades <= 2);
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const on = this.trader.running;
    // the lever eases between its two stops
    const target = on ? 1 : 0;
    this.leverPos += (target - this.leverPos) * Math.min(1, dt * 9);
    if (Math.abs(target - this.leverPos) < 0.01) this.leverPos = target;

    const c = fixtureById("lever").rect;
    const g = this.lever;
    g.clear();
    g.rect(c.x + 2, c.y + c.h, c.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
    // top surface and front face
    g.rect(c.x, c.y - 8, c.w, 16).fill(PAL.metalLight);
    g.rect(c.x, c.y - 8, c.w, 1).fill(PAL.goldLight);
    g.rect(c.x + 2, c.y - 6, c.w - 4, 12).fill(PAL.metal);
    g.rect(c.x, c.y + 7, c.w, 1).fill(PAL.gold);
    g.rect(c.x, c.y + 8, c.w, c.h - 8).fill(PAL.metalDark);
    g.rect(c.x, c.y + 8, 2, c.h - 8).fill(PAL.goldDark);
    g.rect(c.x + c.w - 2, c.y + 8, 2, c.h - 8).fill(PAL.goldDark);
    // status lamps on the front: a chase while running, one red lamp when stopped
    const lamps = 9;
    const head = Math.floor(t * 10) % lamps;
    for (let i = 0; i < lamps; i++) {
      const lx = c.x + 5 + i * 4.5;
      let color: number = PAL.metal;
      let alpha = 1;
      if (on) {
        const dist = (head - i + lamps) % lamps;
        color = dist === 0 ? 0xeafff6 : 0x3ddcb0;
        alpha = dist === 0 ? 1 : dist < 4 ? 0.85 - dist * 0.18 : 0.25;
      } else if (i === 0) {
        color = 0xff4d6d;
        alpha = 0.55 + 0.35 * Math.sin(t * 2.2);
      }
      g.rect(Math.round(lx), c.y + 11, 3, 2).fill({ color, alpha });
    }
    // gauges either side of the slot
    g.rect(c.x + 4, c.y - 4, 10, 8).fill(PAL.void);
    g.rect(c.x + 5, c.y - 3, 8, 6).fill(on ? PAL.cyanDark : 0x24223f);
    if (on) for (let i = 0; i < 3; i++) g.rect(c.x + 6, c.y - 2 + i * 2, 2 + ((i * 3 + Math.floor(t * 4)) % 5), 1).fill(PAL.cyanLight);
    g.rect(c.x + c.w - 14, c.y - 4, 10, 8).fill(PAL.void);
    g.rect(c.x + c.w - 13, c.y - 3, 8, 6).fill(on ? 0x0f5a4c : 0x3a1420);
    g.rect(c.x + c.w - 11, c.y - 1, 4, 2).fill(on ? 0x35e0b4 : 0xff4d6d);
    // the lever: a slot down the middle of the top and a big gold handle
    const sx = c.x + c.w / 2;
    g.rect(sx - 3, c.y - 6, 6, 12).fill(PAL.void);
    g.rect(sx - 1, c.y - 5, 2, 10).fill(PAL.goldDeep);
    const hy = Math.round(c.y + 3 - this.leverPos * 8);
    g.rect(sx - 1, hy - 5, 2, 7).fill(PAL.goldDark);
    g.rect(sx - 4, hy - 9, 8, 5).fill(on ? 0x35e0b4 : PAL.gold);
    g.rect(sx - 4, hy - 9, 8, 1).fill(on ? 0xeafff6 : PAL.goldLight);
    g.rect(sx - 4, hy - 5, 8, 1).fill(on ? 0x0f5a4c : PAL.goldDark);

    // wall lights and the display's glow follow the trader
    const l = this.lights;
    l.clear();
    const d = TRADER_DISPLAY;
    const pulse = on ? 0.7 + 0.3 * Math.sin(t * 3.2) : 0.35;
    l.rect(BR.ox + d.x - 2, BR.oy + d.y + d.h + 3, d.w + 4, 1).fill({ color: on ? 0x35e0b4 : 0xff4d6d, alpha: pulse });
    l.rect(BR.ox + d.x, BR.oy + d.y, d.w, d.h).fill({ color: on ? 0x35e0b4 : 0xff4d6d, alpha: on ? 0.05 + 0.03 * Math.sin(t * 3.2) : 0.03 });
    for (const [x, w] of [
      [304, 76],
      [396, 64],
    ]) {
      l.rect(BR.ox + x, BR.oy + 7, w, 2).fill({ color: PAL.cyan, alpha: 0.65 + 0.2 * Math.sin(t * 1.4 + x) });
    }
    if (on) {
      // light running down the conduit into the console
      const run = (t * 26) % 14;
      l.rect(BR.ox + d.x + d.w / 2 - 1, BR.oy + d.y + d.h + 2 + Math.min(run, 6), 2, 2).fill({ color: 0xeafff6, alpha: 0.9 });
      l.rect(c.x - 3, c.y - 10, c.w + 6, c.h + 14).fill({ color: 0x35e0b4, alpha: 0.05 + 0.03 * Math.sin(t * 3.2) });
    }
    // trades-left pips on the docks board
    const dock = fixtureById("docks").plate!;
    if (this.trades !== null) {
      const n = Math.min(this.trades, 14);
      for (let i = 0; i < 14; i++) {
        l.rect(BR.ox + dock.x + dock.w - 6 - (i % 7) * 4 - 3, BR.oy + dock.y + 6 + Math.floor(i / 7) * 5, 3, 3).fill({ color: i < n ? PAL.gold : PAL.metal, alpha: i < n ? 0.95 : 0.6 });
      }
    }
    // the manager shifts on their feet now and then
    this.manager.dir = Math.sin(t * 0.35) > 0.93 ? "left" : Math.sin(t * 0.35) < -0.93 ? "right" : "down";
    this.manager.update(dt);
  }

  destroy() {
    this.lever.destroy();
    this.desk.destroy();
    this.manager.destroy();
    this.back.destroy({ children: true });
  }
}

// ---------------------------------------------------------------------------
// Shop Floor
// ---------------------------------------------------------------------------

const SH = ROOMS.shop;
const RACK_NAMES = ["STOCK A", "STOCK B", "STOCK C"];

export class ShopRoom {
  readonly back = new Container();
  private glow = new Graphics();
  private posters = new Graphics();
  private crateViews: Graphics[] = [];
  private tags: HTMLDivElement[] = [];
  private layout: ShopLayout = EMPTY_SHOP;
  private time = 0;

  private elValue: HTMLDivElement;
  private elSub: HTMLDivElement;
  private elStats: HTMLDivElement[];
  private elSigns: HTMLDivElement[] = [];
  private elPosters: Array<{ name: HTMLDivElement; price: HTMLDivElement }> = [];
  private elMore: HTMLDivElement;

  constructor(
    private sorted: Container,
    private labels: LabelLayer,
  ) {
    this.back.addChild(this.drawStatic(), this.posters, this.glow);
    const d = SHOP_DISPLAY;
    labels.place(labels.add("vt-station-readout-title", "SHOP FLOOR"), d.x + 5, d.y + 3);
    this.elValue = labels.add("vt-station-readout-plat vt-station-wh-value", "--");
    labels.place(this.elValue, d.x + 5, d.y + 9);
    this.elSub = labels.add("vt-station-wh-sub", "");
    labels.place(this.elSub, d.x + 5, d.y + 27);
    this.elStats = [0, 1, 2].map((i) => {
      const el = labels.add("vt-station-wh-stat", "");
      labels.place(el, d.x + d.w - 5, d.y + 4 + i * 9);
      return el;
    });
    for (let i = 0; i < SHOP_RACK.count; i++) {
      const r = shopRackRect(i);
      const sign = labels.add("vt-station-sign vt-station-wh-sign", "");
      labels.place(sign, r.x - SH.ox + r.w / 2, 53);
      this.elSigns.push(sign);
    }
    // the wanted wall is above the riven case, so its name sits on the floor in front of it
    const rc = rivenCaseRect();
    const caseSign = labels.add("vt-station-fx-tag vt-station-riven-tag", "");
    labels.place(caseSign, rc.x - SH.ox + rc.w / 2, rc.y - SH.oy - 11);
    this.elSigns.push(caseSign);
    labels.place(labels.add("vt-station-readout-title", "WANTED"), WANTED.x0, 6);
    for (let i = 0; i < WANTED.count; i++) {
      const p = wantedPlate(i);
      const name = labels.add("vt-station-wanted-name", "");
      name.style.width = `calc(var(--vt-u) * ${p.w - 4})`;
      labels.place(name, p.x + p.w / 2, p.y + 3);
      const price = labels.add("vt-station-wanted-price", "");
      labels.place(price, p.x + p.w / 2, p.y + p.h - 3);
      this.elPosters.push({ name, price });
    }
    this.elMore = labels.add("vt-station-wh-more", "");
    const desk = fixtureById("stockconsole").rect;
    labels.place(this.elMore, desk.x - SH.ox + desk.w / 2, desk.y - SH.oy - 22);
    labels.place(labels.add("vt-station-door-tag vt-station-door-tag-mid", "WAREHOUSE"), SOUTH_DOOR.x + SOUTH_DOOR.w / 2, 60);
    labels.place(labels.add("vt-station-door-tag vt-station-door-tag-left", "DECK"), 11, DOOR.y - 6);
    this.setLayout(EMPTY_SHOP, true);
  }

  private drawStatic(): Graphics {
    const g = new Graphics();
    const { ox, oy } = SH;
    drawShell(g, ox, oy, { north: true, west: true });
    drawPlate(g, { x: ox + SHOP_DISPLAY.x, y: oy + SHOP_DISPLAY.y, w: SHOP_DISPLAY.w, h: SHOP_DISPLAY.h });
    for (let i = 0; i < SHOP_RACK.count + 1; i++) {
      const riven = i === SHOP_RACK.count;
      const k = riven ? rivenCaseRect() : shopRackRect(i);
      drawRack(g, k, riven ? RIVEN_CASE.rows : SHOP_RACK.rows, riven ? RIVEN_CASE.rowPitch : SHOP_RACK.rowPitch, 16, riven ? 0x6a4fb8 : PAL.cyanDark);
      if (riven) {
        // glass case: a pale sheen over the deck and a brighter frame
        g.rect(k.x + 1, k.y + 1, k.w - 2, k.h - 2).fill({ color: RIVEN_HEX, alpha: 0.08 });
        g.rect(k.x, k.y, k.w, 1).fill(RIVEN_HEX);
        g.rect(k.x, k.y + k.h - 1, k.w, 1).fill(RIVEN_HEX);
      }
      if (riven) continue;
      // sign plate on the back wall
      g.rect(k.x - 7, oy + 46, k.w + 14, 13).fill(PAL.gold);
      g.rect(k.x - 6, oy + 47, k.w + 12, 11).fill(0x0a0920);
      g.rect(k.x + k.w / 2 - 1, oy + 59, 2, 3).fill(PAL.goldDark);
    }
    // a light strip over the wanted wall, and a gold diamond in the open floor
    g.rect(ox + WANTED.x0 + 40, oy + 8, WANTED.pitch * WANTED.count - 46, 2).fill({ color: PAL.cyan, alpha: 0.8 });
    g.rect(ox + WANTED.x0 + 40, oy + 8, WANTED.pitch * WANTED.count - 46, 1).fill({ color: PAL.cyanLight, alpha: 0.7 });
    const cx = ox + 406;
    const cy = oy + 150;
    g.poly([cx, cy - 22, cx + 36, cy, cx, cy + 22, cx - 36, cy]).stroke({ width: 1, color: PAL.gold, alpha: 0.4 });
    g.poly([cx, cy - 12, cx + 20, cy, cx, cy + 12, cx - 20, cy]).stroke({ width: 1, color: PAL.gold, alpha: 0.25 });
    g.rect(cx - 2, cy - 2, 4, 4).fill({ color: PAL.gold, alpha: 0.5 });
    return g;
  }

  setLayout(layout: ShopLayout, force = false) {
    if (!force && layout === this.layout) return;
    this.layout = layout;
    for (const g of this.crateViews) {
      this.sorted.removeChild(g);
      g.destroy();
    }
    this.crateViews = [];
    for (const el of this.tags) this.labels.remove(el);
    this.tags = [];

    for (const c of layout.crates) {
      const g = new Graphics();
      const color = c.kind === "riven" ? mixHex(RIVEN_HEX, statusHex(c.status), 0.35) : statusHex(c.status);
      drawCrateBox(g, c.rect, crateLift(c.shape.h), c.shape.stack, lookOf(color, c.hidden));
      if (c.kind === "riven") {
        // a riven card standing on the plinth
        const lift = crateLift(c.shape.h);
        g.rect(c.rect.x + 3, c.rect.y - lift + 2, 6, 7).fill(0x2a1a55);
        g.rect(c.rect.x + 4, c.rect.y - lift + 3, 4, 5).fill(RIVEN_HEX);
        g.rect(c.rect.x + 5, c.rect.y - lift + 4, 2, 2).fill(0xf3e8ff);
      }
      g.zIndex = c.rect.y + c.rect.h;
      this.crateViews.push(g);
      this.sorted.addChild(g);
      const tag = this.labels.add(`vt-station-wh-tag ${c.col === 0 ? "vt-station-wh-tag-left" : ""}`, c.hidden ? "HIDDEN" : c.listPrice ? `${fmt(c.listPrice)}p` : "--");
      tag.style.color = c.hidden ? "#8d89b8" : statusCss(c.status);
      if (c.hidden) tag.style.opacity = "0.75";
      const lift = crateLift(c.shape.h);
      const mid = c.rect.y + c.rect.h - (c.rect.h + lift) / 2;
      this.labels.place(tag, (c.col === 0 ? c.rect.x - 3 : c.rect.x + c.rect.w + 3) - SH.ox, (c.col === 0 ? mid - 5 : mid + 2) - SH.oy);
      this.tags.push(tag);
    }

    // wanted posters
    const p = this.posters;
    p.clear();
    for (let i = 0; i < WANTED.count; i++) {
      const r = wantedPlate(i);
      const b = layout.boards[i];
      const x = SH.ox + r.x;
      const y = SH.oy + r.y;
      const color = b ? (b.hidden ? 0x4a4873 : statusHex(b.status)) : PAL.metal;
      p.rect(x - 1, y - 1, r.w + 2, r.h + 2).fill(b ? PAL.goldDark : PAL.metalDark);
      p.rect(x, y, r.w, r.h).fill(b ? 0x14102e : 0x0c0a1f);
      p.rect(x, y, r.w, 2).fill({ color, alpha: b ? 1 : 0.5 });
      if (b) {
        p.rect(x + 2, y + r.h - 11, r.w - 4, 1).fill({ color: PAL.gold, alpha: 0.4 });
        p.rect(x + r.w / 2 - 1, y - 3, 2, 3).fill(PAL.goldLight);
      } else {
        p.rect(x + r.w / 2 - 4, y + r.h / 2, 8, 1).fill({ color: PAL.metalLight, alpha: 0.5 });
      }
      this.labels.text(this.elPosters[i].name, b ? b.name : "");
      this.labels.text(this.elPosters[i].price, b ? (b.hidden ? "hidden" : b.maxPrice !== null ? `max ${fmt(b.maxPrice)}p` : b.listPrice ? `${fmt(b.listPrice)}p` : "open") : "");
      this.elPosters[i].price.style.color = b && !b.hidden ? statusCss(b.status) : "#8d89b8";
    }

    const s = layout.summary;
    this.labels.text(this.elValue, s.loaded ? `${fmt(s.listedValue)}p` : "--");
    this.labels.text(this.elSub, s.loaded ? `listed value · ${s.live} live on the market` : "Reading your stock...");
    this.labels.text(this.elStats[0], s.loaded ? `${s.items} ITEMS` : "");
    this.labels.text(this.elStats[1], s.loaded ? `${s.rivens} RIVENS` : "");
    this.labels.text(this.elStats[2], s.loaded ? `${s.wishes} WANTED` : "");
    for (let i = 0; i < SHOP_RACK.count; i++) {
      const n = layout.crates.filter((c) => c.kind === "stock" && Math.floor(c.slot / (SHOP_RACK.rows * 2)) === i).length;
      this.labels.text(this.elSigns[i], n > 0 ? `${RACK_NAMES[i]} ${n}` : RACK_NAMES[i]);
    }
    const rivens = layout.crates.filter((c) => c.kind === "riven").length;
    this.labels.text(this.elSigns[SHOP_RACK.count], rivens > 0 ? `RIVENS ${rivens}` : "RIVENS");
    const more = s.moreItems + s.moreRivens + s.moreWishes;
    this.labels.text(this.elMore, more > 0 ? `+${more} more here` : "");
  }

  /** The crate drawn under a world point, front-most first. */
  crateAt(wx: number, wy: number): ShopCrate | null {
    let best: ShopCrate | null = null;
    for (const c of this.layout.crates) {
      const lift = crateLift(c.shape.h);
      if (wx < c.rect.x - 1 || wx > c.rect.x + c.rect.w + 1 || wy < c.rect.y - lift - 1 || wy > c.rect.y + c.rect.h + 1) continue;
      if (!best || c.rect.y > best.rect.y) best = c;
    }
    return best;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const g = this.glow;
    g.clear();
    for (const c of this.layout.crates) {
      if (c.hidden) continue;
      const live = c.status === "live";
      if (!live && c.kind !== "riven") continue;
      const lift = crateLift(c.shape.h);
      const a = live ? 0.14 + 0.08 * Math.sin(t * 2.6 + c.slot) : 0.08;
      g.rect(c.rect.x - 2, c.rect.y - lift - 2, c.rect.w + 4, c.rect.h + lift + 4).fill({ color: c.kind === "riven" ? RIVEN_HEX : statusHex(c.status), alpha: a });
    }
    // live wanted posters breathe
    this.layout.boards.forEach((b, i) => {
      if (b.hidden || b.status !== "live") return;
      const r = wantedPlate(i);
      g.rect(SH.ox + r.x - 2, SH.oy + r.y - 2, r.w + 4, r.h + 4).fill({ color: statusHex(b.status), alpha: 0.08 + 0.05 * Math.sin(t * 2.2 + i) });
    });
  }

  destroy() {
    for (const g of this.crateViews) g.destroy();
    this.back.destroy({ children: true });
  }
}
