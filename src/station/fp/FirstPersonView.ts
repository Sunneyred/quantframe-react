import {
  COUNTER_SOLID,
  CRATES,
  FIXTURES,
  FLOORS,
  MANAGER_POS,
  RACK,
  RIVEN_CASE,
  ROW_H,
  SHOP_DISPLAY,
  SHOP_RACK,
  TANK_FILL_GOAL,
  TANK_GLASS,
  TANK_SOLID,
  TRADER_DISPLAY,
  VIEW_H,
  VIEW_W,
  WANTED,
  WH_DISPLAY,
  WH_OX,
  WORLD_H,
  WORLD_W,
  fixtureById,
  postsOf,
  rackPosts,
  rackRect,
  rivenCaseRect,
  shopRackRect,
  terminalRect,
  wantedPlate,
  type Rect,
} from "../engine/constants";
import { MANAGER_PALETTE, RIVEN_HEX, type TraderState } from "../engine/lowerRooms";
import type { GoalSnapshot } from "../engine/logic";
import { mixHex } from "../engine/shell";
import { EMPTY_SHOP, statusCss, statusHex, type ShopLayout } from "../engine/shop";
import type { WarehouseLayout } from "../engine/warehouse";
import { angleOfDir, type Dir } from "../entities/character";
import type { Customer } from "../entities/customers";
import { CELL, GRID_WALL, Raycaster, WALL_H, type Billboard, type Block, type Camera, type LiveInset, type Panel, type Scene, type Tex } from "./raycaster";
import {
  TANK_FACE,
  caseTex,
  ceilingTex,
  characterTex,
  counterSideTex,
  counterTopTex,
  crateTexIndex,
  crateTexSets,
  deskTex,
  floorTex,
  frameTex,
  leverHandleTex,
  leverTex,
  plainCrateTex,
  postTex,
  rackTex,
  shelvesTex,
  tankTex,
  terminalTex,
  textPlate,
  tintedCrateTex,
  wallTex,
  type CrateTexSet,
} from "./textures";

const fmt = (n: number) => Math.round(n).toLocaleString();
const GOLD = "#f6dc8a";
const CYAN = "#2ad4e6";
const CYAN_LIGHT = "#b9fbff";
const GREEN = "#35e0b4";
const RED = "#ff6b84";
const RACK_NAMES = ["STOCK A", "STOCK B", "STOCK C"];
/** Height of the back-wall face of the lower rooms. */
const LOW_WALL = ROW_H + 68;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const RACK_BASE_H = 3;
/** Billboard height of a person, in world units. */
const PERSON_H = 30;
/** Height of the top of a stock crate above the floor (kept under eye level so its lid shows). */
export const crateTop = (shapeH: number) => RACK_BASE_H + Math.round(shapeH * 0.8);

/** Grow a rect to the grid cells whose centres it covers. */
const snap = (r: Rect): Rect => {
  const x0 = Math.ceil((r.x - CELL / 2) / CELL) * CELL;
  const y0 = Math.ceil((r.y - CELL / 2) / CELL) * CELL;
  const x1 = (Math.floor((r.x + r.w - CELL / 2) / CELL) + 1) * CELL;
  const y1 = (Math.floor((r.y + r.h - CELL / 2) / CELL) + 1) * CELL;
  return { x: x0, y: y0, w: Math.max(CELL, x1 - x0), h: Math.max(CELL, y1 - y0) };
};

/**
 * The first-person renderer: a second view over the same station state. It
 * owns a small 2D canvas and a raycaster scene that mirrors the collision map
 * (walls, tank, counter, racks, crates) and is told about anything that changes.
 */
export class FirstPersonView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private image: ImageData | null = null;
  private caster: Raycaster | null = null;
  private low = false;

  private scene: Scene;
  private staticBlocks: Block[] = [];
  private staticPanels: Panel[] = [];
  private crateSets: CrateTexSet[] = crateTexSets();
  private terminalOn = terminalTex(true);
  private terminalOff = terminalTex(false);
  private tankLive: LiveInset;
  private readoutPanel: Panel;
  private displayPanel: Panel;
  private signs: Billboard[] = [];
  private layout: WarehouseLayout | null = null;
  private goal: GoalSnapshot | null = null;
  private destroyed = false;

  // --- lower rooms
  private traderPanel: Panel;
  private overviewPanel: Panel;
  private docksPanel: Panel;
  private shopPanel: Panel;
  private posterPanels: Panel[] = [];
  private fixtureSigns: Billboard[] = [];
  private shopSigns: Billboard[] = [];
  private shop: ShopLayout = EMPTY_SHOP;
  private trader: TraderState = { running: false, message: "" };
  private traderDrawn = { running: false, message: "", at: -1 };
  private trades: number | null = null;
  private leverLook = [leverTex(false, false), leverTex(false, true), leverTex(true, false), leverTex(true, true)];
  private handleTex = [leverHandleTex(false), leverHandleTex(true)];
  private leverBlock: Block | null = null;

  constructor(parent: HTMLElement, before: Node | null) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "vt-station-canvas vt-station-canvas-fp";
    this.canvas.style.display = "none";
    parent.insertBefore(this.canvas, before);
    this.ctx = this.canvas.getContext("2d");

    this.tankLive = { ...TANK_FACE.glass, src: null, sw: TANK_GLASS.w, sh: TANK_GLASS.h, lineRow: Math.round(TANK_GLASS.h - TANK_FILL_GOAL * TANK_GLASS.h) };
    const blank = textPlate(4, 4, []);
    this.readoutPanel = { horizontal: true, plane: 68, a0: 158, a1: 270, z0: 24, z1: 64, tex: blank };
    this.displayPanel = { horizontal: true, plane: 68, a0: WH_OX + WH_DISPLAY.x, a1: WH_OX + WH_DISPLAY.x + WH_DISPLAY.w, z0: 24, z1: 64, tex: blank };
    const lowPlate = (ox: number, r: Rect, z0 = 24, z1 = 64): Panel => ({ horizontal: true, plane: LOW_WALL, a0: ox + r.x, a1: ox + r.x + r.w, z0, z1, tex: blank });
    this.traderPanel = lowPlate(0, TRADER_DISPLAY);
    this.overviewPanel = lowPlate(0, fixtureById("overview").plate!);
    this.docksPanel = lowPlate(0, fixtureById("docks").plate!);
    this.shopPanel = lowPlate(WH_OX, SHOP_DISPLAY);
    for (let i = 0; i < WANTED.count; i++) this.posterPanels.push(lowPlate(WH_OX, wantedPlate(i), 22, 62));
    this.buildStatic();
    this.scene = {
      grid: new Uint16Array(0),
      gw: WORLD_W / CELL,
      gh: WORLD_H / CELL,
      blocks: [],
      panels: [],
      wall: wallTex(),
      floor: floorTex(),
      ceiling: ceilingTex(),
      sprites: [],
    };
    this.rebuild();
    this.setLowPower(false);
    // text plates are drawn with the page fonts: redraw them once those have loaded
    void document.fonts?.ready.then(() => {
      if (this.destroyed) return;
      this.buildStatic();
      this.rebuild();
    });
  }

  private buildStatic() {
    const blocks: Block[] = [];
    const add = (r: Rect, h: number, side: Tex, extra: Partial<Block> = {}) => {
      const s = snap(r);
      blocks.push({ x: s.x, y: s.y, w: s.w, d: s.h, h, side, ...extra });
    };
    add(TANK_SOLID, WALL_H, tankTex(), { live: this.tankLive });
    add(COUNTER_SOLID, 16, counterSideTex(), { top: counterTopTex() });
    const plain = plainCrateTex();
    CRATES.forEach((c, i) => add(c, i === 0 ? 13 : 10, plain.side, { top: plain.top }));
    // door jambs on both sides of the passage
    const frame = frameTex();
    add({ x: 472, y: 168, w: 16, h: 8 }, WALL_H, frame);
    add({ x: 472, y: 212, w: 16, h: 8 }, WALL_H, frame);
    const rack = rackTex();
    const post = postTex();
    for (let i = 0; i < RACK.count; i++) {
      const r = rackRect(i);
      add(r, RACK_BASE_H, rack.side, { top: rack.top });
      for (const [px, py] of rackPosts(i)) blocks.push({ x: px, y: py, w: 4, d: 4, h: 50, side: post });
    }
    // --- lower rooms: door frames, shelving, desk
    add({ x: 472, y: ROW_H + 168, w: 16, h: 8 }, WALL_H, frame);
    add({ x: 472, y: ROW_H + 212, w: 16, h: 8 }, WALL_H, frame);
    for (const ox of [0, WH_OX]) {
      for (const y of [264, ROW_H + 60]) {
        add({ x: ox + 212, y, w: 8, h: 8 }, WALL_H, frame);
        add({ x: ox + 256, y, w: 8, h: 8 }, WALL_H, frame);
      }
    }
    for (let i = 0; i < SHOP_RACK.count; i++) {
      const r = shopRackRect(i);
      add(r, RACK_BASE_H, rack.side, { top: rack.top });
      for (const [px, py] of postsOf(r)) blocks.push({ x: px, y: py, w: 4, d: 4, h: 50, side: post });
    }
    const glass = caseTex(RIVEN_CASE.rows, RIVEN_CASE.rowPitch);
    const cr = rivenCaseRect();
    add(cr, RACK_BASE_H, glass.side, { top: glass.top });
    for (const [px, py] of postsOf(cr)) blocks.push({ x: px, y: py, w: 4, d: 4, h: 34, side: post });
    const desk = deskTex();
    add(fixtureById("manager").rect, 15, desk.side, { top: desk.top });
    for (const f of FIXTURES) {
      if (f.kind === "terminal") blocks.push({ x: f.rect.x, y: f.rect.y, w: f.rect.w, d: f.rect.h, h: 20, side: this.terminalOn.side, top: this.terminalOn.top });
    }
    this.staticBlocks = blocks;

    this.staticPanels = [
      this.readoutPanel,
      this.displayPanel,
      { horizontal: true, plane: 68, a0: 300, a1: 412, z0: 20, z1: 54, tex: shelvesTex() },
      {
        horizontal: true,
        plane: 68,
        a0: 326,
        a1: 386,
        z0: 57,
        z1: 69,
        tex: textPlate(120, 24, [{ text: "TRADE DESK", x: 60, y: 18, size: 17, color: GOLD, align: "center" }], { border: 0xe8c15a }),
      },
      {
        horizontal: false,
        plane: 472,
        a0: 224,
        a1: 260,
        z0: 34,
        z1: 46,
        tex: textPlate(72, 24, [{ text: "WAREHOUSE", x: 36, y: 17, size: 13, color: CYAN_LIGHT, align: "center" }], { border: 0x2ad4e6 }),
      },
      {
        horizontal: false,
        plane: 488,
        a0: 224,
        a1: 260,
        z0: 34,
        z1: 46,
        flip: true,
        tex: textPlate(72, 24, [{ text: "VAULT", x: 36, y: 18, size: 16, color: GOLD, align: "center" }], { border: 0xe8c15a }),
      },
    ];
    const doorPlate = (text: string, cyan: boolean) => textPlate(96, 24, [{ text, x: 48, y: 17, size: text.length > 9 ? 12 : 15, color: cyan ? CYAN_LIGHT : GOLD, align: "center" }], { border: cyan ? 0x2ad4e6 : 0xe8c15a });
    const about = fixtureById("about").plate!;
    this.staticPanels.push(
      this.traderPanel,
      this.overviewPanel,
      this.docksPanel,
      this.shopPanel,
      ...this.posterPanels,
      // names over the doors between the rows and between the two lower rooms
      { horizontal: true, plane: 264, a0: 268, a1: 316, z0: 34, z1: 46, flip: true, tex: doorPlate("CONTROL DECK", true) },
      { horizontal: true, plane: 264, a0: WH_OX + 268, a1: WH_OX + 316, z0: 34, z1: 46, flip: true, tex: doorPlate("SHOP FLOOR", true) },
      { horizontal: true, plane: LOW_WALL, a0: 264, a1: 296, z0: 36, z1: 46, tex: doorPlate("VAULT", false) },
      { horizontal: true, plane: LOW_WALL, a0: WH_OX + 180, a1: WH_OX + 212, z0: 36, z1: 46, tex: doorPlate("WAREHOUSE", true) },
      { horizontal: false, plane: 472, a0: ROW_H + 224, a1: ROW_H + 260, z0: 34, z1: 46, tex: doorPlate("SHOP FLOOR", true) },
      { horizontal: false, plane: 488, a0: ROW_H + 224, a1: ROW_H + 260, z0: 34, z1: 46, flip: true, tex: doorPlate("CONTROL DECK", true) },
      {
        horizontal: true,
        plane: LOW_WALL,
        a0: about.x,
        a1: about.x + about.w,
        z0: 30,
        z1: 56,
        tex: textPlate(
          76,
          52,
          [
            { text: "i", x: 38, y: 22, size: 24, color: "#fff1b8", align: "center" },
            { text: "VOID TRADER", x: 38, y: 36, size: 11, color: GOLD, align: "center" },
            { text: "INFO", x: 38, y: 47, size: 10, color: CYAN_LIGHT, align: "center" },
          ],
          { border: 0xe8c15a, bg: 0x0a0920 },
        ),
      },
      { horizontal: true, plane: LOW_WALL, a0: WH_OX + WANTED.x0, a1: WH_OX + WANTED.x0 + 60, z0: 63, z1: 70, tex: textPlate(120, 14, [{ text: "WANTED  BUY ORDERS", x: 4, y: 11, size: 11, color: CYAN }]) },
    );
    // a name plate floating over every fixture you can use
    this.fixtureSigns = [];
    for (const f of FIXTURES) {
      if (f.kind === "wall") continue;
      const text = f.id === "lever" ? "TRADER LEVER" : f.label;
      const w = Math.max(60, text.length * 11 + 14);
      const tex = textPlate(w, 22, [{ text, x: w / 2, y: 16, size: 14, color: f.kind === "terminal" ? CYAN_LIGHT : GOLD, align: "center" }], { border: f.kind === "terminal" ? 0x2ad4e6 : 0xe8c15a });
      const z0 = f.kind === "hatch" ? 7 : f.kind === "desk" ? 37 : f.kind === "lever" ? 31 : 24;
      this.fixtureSigns.push({ x: f.rect.x + f.rect.w / 2, y: f.rect.y + f.rect.h / 2, z0, w: w / 4, h: 5.5, tex });
    }
    this.drawReadout();
    this.drawDisplay();
    this.drawSigns();
    this.drawTrader(true);
    this.drawOverview();
    this.drawDocks();
    this.drawShop();
  }

  // -------------------------------------------------------------------------
  // State pushed in by the game
  // -------------------------------------------------------------------------

  setLowPower(low: boolean) {
    this.low = low;
    const w = low ? 240 : 320;
    const h = low ? 135 : 180;
    if (this.caster && this.caster.w === w) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (!this.ctx) return;
    this.image = this.ctx.createImageData(w, h);
    this.caster = new Raycaster(w, h, new Uint32Array(this.image.data.buffer));
  }

  setVisible(visible: boolean) {
    this.canvas.style.display = visible ? "" : "none";
  }

  /** The tank's live pixel buffer (RGBA). */
  setFluid(image: ImageData | null) {
    this.tankLive.src = image ? image.data : null;
    if (image) {
      this.tankLive.sw = image.width;
      this.tankLive.sh = image.height;
    }
  }

  setGoal(goal: GoalSnapshot) {
    this.goal = goal;
    this.drawReadout();
    this.drawOverview();
  }

  setLayout(layout: WarehouseLayout) {
    this.layout = layout;
    this.drawDisplay();
    this.drawSigns();
    this.rebuild();
  }

  setShop(shop: ShopLayout) {
    this.shop = shop;
    this.drawShop();
    this.rebuild();
  }

  /** The status line changes often while the trader works, so the plate is redrawn at most a few times a second (see render). */
  setTrader(state: TraderState) {
    const flipped = state.running !== this.trader.running;
    this.trader = state;
    if (flipped) {
      this.drawTrader(true);
      this.rebuild();
    }
  }

  setTrades(trades: number | null) {
    if (trades === this.trades) return;
    this.trades = trades;
    this.drawDocks();
  }

  private drawTrader(force: boolean) {
    const t = this.trader;
    const message = t.running ? t.message || "Working through your stock..." : "Pull the lever to start trading";
    if (!force && this.traderDrawn.running === t.running && this.traderDrawn.message === message) return;
    this.traderDrawn = { running: t.running, message, at: this.traderDrawn.at };
    this.traderPanel.tex = textPlate(
      292,
      80,
      [
        { text: "LIVE TRADER", x: 10, y: 16, size: 12, color: CYAN },
        { text: t.running ? "RUNNING" : "OFFLINE", x: 10, y: 50, size: 34, color: t.running ? GREEN : RED },
        { text: cut(message, 46), x: 10, y: 70, size: 13, color: CYAN_LIGHT },
      ],
      { border: t.running ? 0x35e0b4 : 0x7a2a3a },
    );
  }

  private drawOverview() {
    const g = this.goal;
    this.overviewPanel.tex = textPlate(
      168,
      80,
      [
        { text: "OVERVIEW", x: 10, y: 16, size: 12, color: CYAN },
        { text: g ? `${g.profit_today >= 0 ? "+" : ""}${fmt(g.profit_today)}p` : "--", x: 10, y: 48, size: 30, color: GOLD },
        { text: g && g.daily_target > 0 ? `today  target ${fmt(g.daily_target)}p` : "profit today", x: 10, y: 68, size: 13, color: GREEN },
      ],
      { border: 0x0f6a85 },
    );
  }

  private drawDocks() {
    this.docksPanel.tex = textPlate(
      144,
      80,
      [
        { text: "DOCKS", x: 10, y: 16, size: 12, color: CYAN },
        { text: this.trades === null ? "--" : String(this.trades), x: 10, y: 50, size: 34, color: this.trades !== null && this.trades <= 2 ? RED : GOLD },
        { text: "trades left today", x: 10, y: 70, size: 13, color: CYAN_LIGHT },
      ],
      { border: 0x8a6a2f },
    );
  }

  private drawShop() {
    const s = this.shop.summary;
    this.shopPanel.tex = textPlate(
      320,
      80,
      s.loaded
        ? [
            { text: "SHOP FLOOR  LISTED", x: 12, y: 18, size: 13, color: CYAN },
            { text: `${fmt(s.listedValue)}p`, x: 12, y: 58, size: 40, color: GOLD },
            { text: `${s.items} ITEMS`, x: 308, y: 22, size: 15, color: CYAN_LIGHT, align: "right" as const },
            { text: `${s.rivens} RIVENS`, x: 308, y: 42, size: 15, color: CYAN_LIGHT, align: "right" as const },
            { text: `${s.wishes} WANTED`, x: 308, y: 62, size: 15, color: "#e8c15a", align: "right" as const },
            { text: `${s.live} live on the market`, x: 12, y: 74, size: 12, color: GREEN },
          ]
        : [
            { text: "SHOP FLOOR", x: 12, y: 18, size: 13, color: CYAN },
            { text: "READING STOCK", x: 12, y: 50, size: 26, color: CYAN_LIGHT },
          ],
      { border: 0x0f6a85 },
    );
    for (let i = 0; i < WANTED.count; i++) {
      const b = this.shop.boards[i];
      if (!b) {
        this.posterPanels[i].tex = textPlate(62, 80, [{ text: "-", x: 31, y: 44, size: 16, color: "#45447a", align: "center" }], { border: 0x1a1933, bg: 0x0c0a1f });
        continue;
      }
      // the name over up to three lines
      const words = b.name.split(" ");
      const lines: string[] = [];
      for (const w of words) {
        const last = lines[lines.length - 1];
        if (last !== undefined && (last + " " + w).length <= 9) lines[lines.length - 1] = `${last} ${w}`;
        else lines.push(w);
      }
      const color = b.hidden ? "#8d89b8" : statusCss(b.status);
      this.posterPanels[i].tex = textPlate(
        124,
        160,
        [
          { text: "WANTED", x: 62, y: 24, size: 20, color },
          ...lines.slice(0, 3).map((text, k) => ({ text: cut(text, 10), x: 62, y: 56 + k * 24, size: 24, color: "#fff1b8" })),
          { text: b.hidden ? "hidden" : b.maxPrice !== null ? `max ${fmt(b.maxPrice)}p` : b.listPrice ? `${fmt(b.listPrice)}p` : "open", x: 62, y: 146, size: 22, color },
        ].map((l) => ({ ...l, align: "center" as const })),
        { border: b.hidden ? 0x4a4873 : statusHex(b.status), bg: 0x14102e },
      );
    }
    this.shopSigns = [];
    for (let i = 0; i <= SHOP_RACK.count; i++) {
      const riven = i === SHOP_RACK.count;
      const r = riven ? rivenCaseRect() : shopRackRect(i);
      const n = riven ? this.shop.crates.filter((c) => c.kind === "riven").length : this.shop.crates.filter((c) => c.kind === "stock" && Math.floor(c.slot / (SHOP_RACK.rows * 2)) === i).length;
      const tex = textPlate(
        88,
        24,
        [
          { text: riven ? "RIVENS" : RACK_NAMES[i], x: 6, y: 17, size: 15, color: riven ? "#d9c2ff" : GOLD },
          { text: n > 0 ? String(n) : "-", x: 82, y: 17, size: 15, color: CYAN_LIGHT, align: "right" },
        ],
        { border: riven ? RIVEN_HEX : 0xe8c15a },
      );
      this.shopSigns.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, z0: 56, w: 44, h: 12, tex });
    }
  }

  private drawReadout() {
    const g = this.goal;
    const hit = g ? g.profit_today >= g.daily_target && g.daily_target > 0 : false;
    this.readoutPanel.tex = textPlate(
      224,
      80,
      [
        { text: "VAULT", x: 10, y: 16, size: 12, color: CYAN },
        { text: g ? `GOAL ${fmt(g.goal)}p` : "", x: 214, y: 17, size: 14, color: "#e8c15a", align: "right" },
        { text: g ? `${fmt(g.platinum)}p` : "--", x: 10, y: 52, size: 36, color: GOLD },
        { text: g ? `today ${fmt(g.profit_today)} / ${fmt(g.daily_target)}p` : "", x: 10, y: 72, size: 15, color: hit ? "#8cf0b4" : CYAN_LIGHT },
      ],
      { border: 0x0f6a85 },
    );
  }

  private drawDisplay() {
    const s = this.layout?.summary;
    const lines = !s?.connected
      ? [
          { text: "WAREHOUSE", x: 12, y: 18, size: 13, color: CYAN },
          { text: "NO INVENTORY LINK", x: 12, y: 48, size: 26, color: "#ffb86b" },
          { text: "Connect AlecaFrame in Cargo > Sell Finder", x: 12, y: 68, size: 14, color: CYAN_LIGHT },
        ]
      : [
          { text: "WAREHOUSE  SELLABLE", x: 12, y: 18, size: 13, color: CYAN },
          { text: `${fmt(s.sellable)}p`, x: 12, y: 58, size: 40, color: GOLD },
          { text: `${s.types} ITEM TYPES`, x: 348, y: 22, size: 15, color: CYAN_LIGHT, align: "right" as const },
          { text: `${s.trades} TRADES LEFT`, x: 348, y: 42, size: 15, color: CYAN_LIGHT, align: "right" as const },
          { text: `MR ${s.mastery}`, x: 348, y: 62, size: 15, color: "#e8c15a", align: "right" as const },
          { text: s.listedTypes > 0 ? `${s.listedTypes} listed  ${fmt(s.listedValue)}p` : "nothing listed yet", x: 12, y: 74, size: 12, color: "#35e0b4" },
        ];
    this.displayPanel.tex = textPlate(360, 80, lines, { border: 0x0f6a85 });
  }

  /** A hanging sign over every bay: category and number of item types. */
  private drawSigns() {
    this.signs = [];
    for (let i = 0; i < RACK.count; i++) {
      const bay = this.layout?.bays[i];
      const r = rackRect(i);
      const label = (bay?.label ?? "").toUpperCase();
      const tex = textPlate(
        88,
        24,
        [
          { text: label, x: 6, y: 17, size: 15, color: GOLD },
          { text: bay && bay.count > 0 ? String(bay.count) : "-", x: 82, y: 17, size: 15, color: CYAN_LIGHT, align: "right" },
        ],
        { border: 0xe8c15a },
      );
      this.signs.push({ x: r.x + r.w / 2, y: r.y + r.h / 2, z0: 56, w: 44, h: 12, tex });
    }
  }

  /** Rebuild the height grid and block list from the collision map plus the current crates. */
  private rebuild() {
    const gw = WORLD_W / CELL;
    const gh = WORLD_H / CELL;
    const grid = new Uint16Array(gw * gh);
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const x = cx * CELL + CELL / 2;
        const y = cy * CELL + CELL / 2;
        let open = false;
        for (const f of FLOORS) if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) open = true;
        grid[cy * gw + cx] = open ? 0 : GRID_WALL;
      }
    }
    const blocks: Block[] = [...this.staticBlocks];
    const connected = this.layout?.summary.connected ?? false;
    for (let i = 0; i < RACK.count; i++) {
      const t = terminalRect(i);
      const tex = connected ? this.terminalOn : this.terminalOff;
      blocks.push({ x: t.x, y: t.y, w: t.w, d: t.h, h: 20, side: tex.side, top: tex.top });
    }
    for (const c of this.layout?.crates ?? []) {
      const set = this.crateSets[crateTexIndex(c.tier, c.listed)];
      blocks.push({
        x: c.rect.x,
        y: c.rect.y,
        w: c.rect.w,
        d: c.rect.h,
        h: crateTop(c.shape.h),
        side: set.side,
        sideAlt: set.sideAlt,
        top: set.top,
        vRepeat: c.shape.stack,
      });
    }
    // the trader console wears the lamps of its state; render() flips between the two beats
    const lv = fixtureById("lever").rect;
    const look = this.leverLook[this.trader.running ? 2 : 0];
    this.leverBlock = { x: lv.x, y: lv.y, w: lv.w, d: lv.h, h: 16, side: look.side, sideAlt: this.leverLook[this.trader.running ? 3 : 1].side, top: look.top };
    blocks.push(this.leverBlock);
    for (const c of this.shop.crates) {
      const riven = c.kind === "riven";
      const set = tintedCrateTex(riven ? mixHex(RIVEN_HEX, statusHex(c.status), 0.35) : statusHex(c.status), c.hidden, riven);
      blocks.push({ x: c.rect.x, y: c.rect.y, w: c.rect.w, d: c.rect.h, h: crateTop(c.shape.h), side: set.side, top: set.top, vRepeat: c.shape.stack });
    }
    blocks.forEach((b, i) => {
      const x0 = Math.max(0, Math.round(b.x / CELL));
      const y0 = Math.max(0, Math.round(b.y / CELL));
      const x1 = Math.min(gw, Math.round((b.x + b.w) / CELL));
      const y1 = Math.min(gh, Math.round((b.y + b.d) / CELL));
      for (let cy = y0; cy < y1; cy++) for (let cx = x0; cx < x1; cx++) grid[cy * gw + cx] = i + 1;
    });
    this.scene.grid = grid;
    this.scene.blocks = blocks;
    this.scene.panels = this.staticPanels;
  }

  // -------------------------------------------------------------------------
  // Per frame
  // -------------------------------------------------------------------------

  render(cam: Camera, customers: readonly Customer[], time: number) {
    const caster = this.caster;
    if (!caster || !this.ctx || !this.image) return;
    // the trader's status line: redraw the plate a few times a second at most
    if (time - this.traderDrawn.at > 0.4) {
      this.drawTrader(false);
      this.traderDrawn.at = time;
    }
    const sprites: Billboard[] = [...this.signs, ...this.shopSigns];
    // name plates step aside once you are standing at the thing (the prompt names it then)
    for (const s of this.fixtureSigns) if (Math.hypot(s.x - cam.x, s.y - cam.y) > 34) sprites.push(s);
    // the manager behind the desk, and the lever handle standing in its slot
    const mtex = characterTex(MANAGER_PALETTE, "manager", "down", 0, false);
    sprites.push({ x: MANAGER_POS.x, y: MANAGER_POS.y, z0: 0, w: (PERSON_H * mtex.w) / mtex.h, h: PERSON_H, tex: mtex });
    const lv = fixtureById("lever").rect;
    const on = this.trader.running;
    sprites.push({ x: lv.x + lv.w / 2, y: lv.y + (on ? 4 : 12), z0: 16, w: 6, h: 10.5, tex: this.handleTex[on ? 1 : 0] });
    for (const c of customers) {
      // pick the art by which way the customer faces relative to the viewer
      const vx = c.x - cam.x;
      const vy = c.y - cam.y;
      const len = Math.hypot(vx, vy) || 1;
      const a = angleOfDir(c.sprite.dir);
      const fx = Math.cos(a);
      const fy = Math.sin(a);
      const right = (fx * -vy + fy * vx) / len;
      const away = (fx * vx + fy * vy) / len;
      const dir: Dir = right > 0.7 ? "right" : right < -0.7 ? "left" : away > 0 ? "up" : "down";
      const tex = characterTex(c.sprite.palette, c.buyer.name, dir, c.sprite.frame, c.sprite.walking);
      sprites.push({ x: c.x, y: c.y - 2, z0: 0, w: (PERSON_H * tex.w) / tex.h, h: PERSON_H, tex });
    }
    this.scene.sprites = sprites;
    caster.render(this.scene, cam, Math.floor(time * 2.5) % 2 === 1);
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** World point to station view coordinates (the 480x270 space the labels use), or null when not visible. */
  project(wx: number, wy: number, z: number): { x: number; y: number; dist: number } | null {
    const caster = this.caster;
    if (!caster) return null;
    const p = caster.project(wx, wy, z);
    if (!p) return null;
    return { x: (p.x / caster.w) * VIEW_W, y: (p.y / caster.h) * VIEW_H, dist: p.dist };
  }

  get lowPower() {
    return this.low;
  }

  destroy() {
    this.destroyed = true;
    this.canvas.remove();
    this.image = null;
    this.caster = null;
  }
}

export { PERSON_H };
