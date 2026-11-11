import {
  COUNTER_SOLID,
  CRATES,
  FLOORS,
  RACK,
  TANK_FILL_GOAL,
  TANK_GLASS,
  TANK_SOLID,
  VIEW_H,
  VIEW_W,
  WH_DISPLAY,
  WH_OX,
  WORLD_H,
  WORLD_W,
  rackPosts,
  rackRect,
  terminalRect,
  type Rect,
} from "../engine/constants";
import type { GoalSnapshot } from "../engine/logic";
import type { WarehouseLayout } from "../engine/warehouse";
import { angleOfDir, type Dir } from "../entities/character";
import type { Customer } from "../entities/customers";
import { CELL, GRID_WALL, Raycaster, WALL_H, type Billboard, type Block, type Camera, type LiveInset, type Panel, type Scene, type Tex } from "./raycaster";
import {
  TANK_FACE,
  ceilingTex,
  characterTex,
  counterSideTex,
  counterTopTex,
  crateTexIndex,
  crateTexSets,
  floorTex,
  frameTex,
  plainCrateTex,
  postTex,
  rackTex,
  shelvesTex,
  tankTex,
  terminalTex,
  textPlate,
  wallTex,
  type CrateTexSet,
} from "./textures";

const fmt = (n: number) => Math.round(n).toLocaleString();
const GOLD = "#f6dc8a";
const CYAN = "#2ad4e6";
const CYAN_LIGHT = "#b9fbff";
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
    this.drawReadout();
    this.drawDisplay();
    this.drawSigns();
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
  }

  setLayout(layout: WarehouseLayout) {
    this.layout = layout;
    this.drawDisplay();
    this.drawSigns();
    this.rebuild();
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
    const sprites: Billboard[] = [...this.signs];
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
