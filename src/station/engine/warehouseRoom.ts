import { Container, Graphics } from "pixi.js";
import { DOOR, PAL, RACK, VIEW_H, VIEW_W, WH_DISPLAY, WH_FLOOR, WH_OX, rackPosts, rackRect, terminalRect } from "./constants";
import type { LabelLayer } from "./labels";
import { drawSouthDoor } from "./shell";
import { LISTED_CSS, TIER_CSS, type Crate, type WarehouseLayout } from "./warehouse";

const fmt = (n: number) => Math.round(n).toLocaleString();

/** How far (in screen pixels) a crate of a given 3D height rises in the top-down view. */
export const crateLift = (h: number) => Math.round(h * 0.62);

interface CrateLook {
  top: number;
  front: number;
  band: number;
  edge: number;
}
const LOOKS: CrateLook[] = [
  { top: 0x34325a, front: 0x24223f, band: 0x4a4873, edge: 0x1a1933 },
  { top: PAL.metalLight, front: PAL.metal, band: PAL.cyan, edge: PAL.metalDark },
  { top: 0x8a6a2f, front: 0x6b5220, band: PAL.gold, edge: PAL.goldDeep },
  { top: PAL.gold, front: 0xb8862b, band: PAL.goldLight, edge: PAL.goldDark },
];
const LISTED_LOOK: CrateLook = { top: 0x1a8a72, front: 0x0f5a4c, band: 0x35e0b4, edge: 0x083a32 };

/**
 * Top-down drawing of the warehouse: shell and racks drawn once, crates and
 * their price tags rebuilt whenever the sell finder layout changes. Positions
 * are world coordinates (the room starts at WH_OX); labels are room-local.
 */
export class WarehouseRoom {
  /** Everything below the characters. */
  readonly back = new Container();
  private glow = new Graphics();
  private screens = new Graphics();
  private crateViews: Graphics[] = [];
  private terminalViews: Graphics[] = [];
  private tags: HTMLDivElement[] = [];
  private layout: WarehouseLayout | null = null;
  private time = 0;

  private elValue: HTMLDivElement;
  private elValueSub: HTMLDivElement;
  private elStats: HTMLDivElement[];
  private elSigns: HTMLDivElement[] = [];
  private elMore: HTMLDivElement[] = [];

  constructor(
    private sorted: Container,
    private labels: LabelLayer,
  ) {
    this.back.addChild(this.drawShell(), this.glow);
    for (let i = 0; i < RACK.count; i++) {
      const g = this.drawTerminal(i);
      this.terminalViews.push(g);
      this.sorted.addChild(g);
    }
    this.sorted.addChild(this.screens);
    this.screens.zIndex = terminalRect(0).y + terminalRect(0).h + 0.5;

    const d = WH_DISPLAY;
    const title = labels.add("vt-station-readout-title", "WAREHOUSE");
    labels.place(title, d.x + 5, d.y + 3);
    this.elValue = labels.add("vt-station-readout-plat vt-station-wh-value", "--");
    labels.place(this.elValue, d.x + 5, d.y + 9);
    this.elValueSub = labels.add("vt-station-wh-sub", "");
    labels.place(this.elValueSub, d.x + 5, d.y + 27);
    this.elStats = [0, 1, 2].map((i) => {
      const el = labels.add("vt-station-wh-stat", "");
      labels.place(el, d.x + d.w - 5, d.y + 4 + i * 9);
      return el;
    });
    for (let i = 0; i < RACK.count; i++) {
      const r = rackRect(i);
      const sign = labels.add("vt-station-sign vt-station-wh-sign", "");
      labels.place(sign, r.x - WH_OX + r.w / 2, 53);
      this.elSigns.push(sign);
      const t = terminalRect(i);
      const more = labels.add("vt-station-wh-more", "");
      labels.place(more, t.x - WH_OX + t.w / 2, t.y + t.h + 2);
      this.elMore.push(more);
    }
    this.setLayout({ bays: [], crates: [], summary: { connected: false, sellable: 0, listedValue: 0, types: 0, listedTypes: 0, trades: 0, mastery: 0, unpriced: 0 } }, true);
  }

  private drawShell(): Graphics {
    const g = new Graphics();
    const ox = WH_OX;
    g.rect(ox, 0, VIEW_W, VIEW_H).fill(PAL.void);

    // --- floor tiles (same pattern as the vault)
    const f = WH_FLOOR;
    const T = 16;
    for (let ty = 0; ty * T < f.h; ty++) {
      for (let tx = 0; tx * T < f.w; tx++) {
        const x = f.x + tx * T;
        const y = f.y + ty * T;
        const w = Math.min(T, f.x + f.w - x);
        const h = Math.min(T, f.y + f.h - y);
        g.rect(x, y, w, h).fill((tx + ty) % 2 === 0 ? PAL.floorA : PAL.floorB);
        g.rect(x, y, w, 1).fill(PAL.floorLine);
        g.rect(x, y, 1, h).fill(PAL.floorLine);
        if ((tx * 7 + ty * 13) % 11 === 0) g.rect(x + 7, y + 7, 2, 2).fill({ color: PAL.cyan, alpha: 0.35 });
      }
    }
    g.rect(f.x, f.y, f.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
    g.rect(f.x, f.y + 3, f.w, 2).fill({ color: PAL.shadow, alpha: 0.15 });

    // --- back wall
    g.rect(ox, 0, VIEW_W, 6).fill(PAL.wallTop);
    g.rect(ox, 6, VIEW_W, 56).fill(PAL.wall);
    for (let x = 8; x < VIEW_W; x += 32) {
      g.rect(ox + x, 6, 1, 56).fill(PAL.wallDark);
      g.rect(ox + x + 1, 6, 1, 56).fill({ color: PAL.wallPanel, alpha: 0.8 });
      g.rect(ox + x + 4, 28, 24, 1).fill({ color: PAL.wallPanel, alpha: 0.7 });
    }
    g.rect(ox, 5, VIEW_W, 1).fill(PAL.goldDark);
    g.rect(ox, 62, VIEW_W, 2).fill(PAL.gold);
    g.rect(ox, 64, VIEW_W, 1).fill(PAL.goldDark);
    g.rect(ox, 65, VIEW_W, 5).fill(PAL.wallDark);
    for (let x = 20; x < VIEW_W; x += 48) g.rect(ox + x, 61, 6, 4).fill(PAL.goldLight);
    // light strips either side of the display
    for (const [x, w] of [
      [24, 110],
      [346, 110],
    ]) {
      g.rect(ox + x, 12, w, 2).fill({ color: PAL.cyan, alpha: 0.8 });
      g.rect(ox + x, 12, w, 1).fill({ color: PAL.cyanLight, alpha: 0.7 });
      g.rect(ox + x - 2, 14, w + 4, 3).fill({ color: PAL.cyan, alpha: 0.1 });
    }

    // wall display plate
    const r = { x: ox + WH_DISPLAY.x, y: WH_DISPLAY.y, w: WH_DISPLAY.w, h: WH_DISPLAY.h };
    g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).fill(PAL.metalDark);
    g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).fill(PAL.cyanDark);
    g.rect(r.x, r.y, r.w, r.h).fill(0x07061a);
    for (let y = r.y + 1; y < r.y + r.h; y += 3) g.rect(r.x, y, r.w, 1).fill({ color: PAL.cyan, alpha: 0.05 });
    g.rect(r.x - 2, r.y - 2, 4, 1).fill(PAL.gold);
    g.rect(r.x - 2, r.y - 2, 1, 4).fill(PAL.gold);
    g.rect(r.x + r.w - 2, r.y + r.h + 1, 4, 1).fill(PAL.gold);
    g.rect(r.x + r.w + 1, r.y + r.h - 2, 1, 4).fill(PAL.gold);

    // --- side and bottom walls, door on the left
    g.rect(ox, 6, 8, VIEW_H).fill(PAL.wallTop);
    g.rect(ox + 7, 70, 1, VIEW_H - 78).fill(PAL.goldDark);
    g.rect(ox + VIEW_W - 8, 6, 8, VIEW_H).fill(PAL.wallTop);
    g.rect(ox + VIEW_W - 8, 70, 1, VIEW_H - 78).fill(PAL.goldDark);
    g.rect(ox, VIEW_H - 8, VIEW_W, 8).fill(PAL.wallTop);
    g.rect(ox + 8, VIEW_H - 8, VIEW_W - 16, 1).fill(PAL.goldDark);
    for (let y = 90; y < VIEW_H - 20; y += 40) {
      g.rect(ox + VIEW_W - 5, y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
      if (y < DOOR.y - 16 || y > DOOR.y + DOOR.h) g.rect(ox + 2, y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
    }
    g.rect(ox, DOOR.y - 3, 9, DOOR.h + 6).fill(PAL.gold);
    g.rect(ox, DOOR.y, 8, DOOR.h).fill(0x02020a);
    g.rect(ox + 7, DOOR.y, 1, DOOR.h).fill(PAL.cyan);
    g.rect(ox + 8, DOOR.y + 2, 10, DOOR.h - 4).fill({ color: PAL.cyan, alpha: 0.16 });
    g.rect(ox + 18, DOOR.y + 6, 12, DOOR.h - 12).fill({ color: PAL.cyan, alpha: 0.08 });

    // --- door down to the Shop Floor
    drawSouthDoor(g, ox, 0);

    // --- racks: a low pallet deck with a spine, a marked slot per crate and four uprights
    for (let i = 0; i < RACK.count; i++) {
      const k = rackRect(i);
      g.rect(k.x + 2, k.y + k.h, k.w, 2).fill({ color: PAL.shadow, alpha: 0.35 });
      g.rect(k.x, k.y, k.w, k.h).fill(PAL.metalDark);
      g.rect(k.x + 1, k.y + 1, k.w - 2, k.h - 2).fill(0x121029);
      g.rect(k.x + RACK.colW + 3, k.y, 2, k.h).fill(PAL.metal);
      for (let row = 0; row < RACK.rows; row++) {
        const y = k.y + row * RACK.rowPitch;
        g.rect(k.x, y, k.w, 1).fill(PAL.metal);
        for (const x of [k.x + 1, k.x + k.w - RACK.colW - 1]) {
          g.rect(x, y + 11, RACK.colW, 1).fill({ color: PAL.cyanDark, alpha: 0.7 });
          g.rect(x, y + 24, RACK.colW, 1).fill({ color: PAL.cyanDark, alpha: 0.7 });
        }
      }
      for (const [px, py] of rackPosts(i)) {
        g.rect(px, py, 4, 4).fill(PAL.metalLight);
        g.rect(px + 1, py + 1, 2, 2).fill(PAL.gold);
      }
      // aisle guide lines
      g.rect(k.x - 3, k.y, 1, k.h).fill({ color: PAL.gold, alpha: 0.3 });
      g.rect(k.x + k.w + 2, k.y, 1, k.h).fill({ color: PAL.gold, alpha: 0.3 });
      // bay sign plate on the back wall
      g.rect(k.x - 7, 46, k.w + 14, 13).fill(PAL.gold);
      g.rect(k.x - 6, 47, k.w + 12, 11).fill(0x0a0920);
      g.rect(k.x + k.w / 2 - 1, 59, 2, 3).fill(PAL.goldDark);
    }
    return g;
  }

  private drawTerminal(bay: number): Graphics {
    const t = terminalRect(bay);
    const g = new Graphics();
    g.rect(t.x + 1, t.y + t.h, t.w, 2).fill({ color: PAL.shadow, alpha: 0.35 });
    g.rect(t.x, t.y - 8, t.w, 8 + t.h).fill(PAL.metalDark);
    g.rect(t.x, t.y - 8, t.w, 1).fill(PAL.gold);
    g.rect(t.x + 1, t.y - 6, t.w - 2, 7).fill(PAL.void);
    g.rect(t.x + 6, t.y + 4, 4, 2).fill(PAL.goldDark);
    g.zIndex = t.y + t.h;
    return g;
  }

  /** Rebuild crates and labels for a new layout. */
  setLayout(layout: WarehouseLayout, force = false) {
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
      const g = this.drawCrate(c);
      this.crateViews.push(g);
      this.sorted.addChild(g);
      const tag = this.labels.add(`vt-station-wh-tag ${c.col === 0 ? "vt-station-wh-tag-left" : ""}`, c.listed ? "LISTED" : `${fmt(c.item.total)}p`);
      tag.style.color = c.listed ? LISTED_CSS : TIER_CSS[c.tier];
      if (c.tier === 0 && !c.listed) tag.style.opacity = "0.75";
      const lift = crateLift(c.shape.h);
      // tags of the two bays that share an aisle sit at different heights so they never run into each other
      const mid = c.rect.y + c.rect.h - (c.rect.h + lift) / 2;
      this.labels.place(tag, (c.col === 0 ? c.rect.x - 3 : c.rect.x + c.rect.w + 3) - WH_OX, c.col === 0 ? mid - 5 : mid + 2);
      this.tags.push(tag);
    }

    const s = layout.summary;
    this.labels.text(this.elValue, s.connected ? `${fmt(s.sellable)}p` : "NO LINK");
    this.elValue.classList.toggle("vt-station-wh-value-off", !s.connected);
    this.labels.text(
      this.elValueSub,
      s.connected ? (s.listedTypes > 0 ? `sellable · ${s.listedTypes} listed (${fmt(s.listedValue)}p)` : "sellable at current prices") : "Use a terminal to see how to connect",
    );
    this.labels.text(this.elStats[0], s.connected ? `${s.types} ITEM TYPES` : "");
    this.labels.text(this.elStats[1], s.connected ? `${s.trades} TRADES LEFT` : "");
    this.labels.text(this.elStats[2], s.connected ? `MR ${s.mastery}` : "");
    for (let i = 0; i < RACK.count; i++) {
      const bay = layout.bays[i];
      this.labels.text(this.elSigns[i], bay ? (bay.count > 0 ? `${bay.label.toUpperCase()} ${bay.count}` : bay.label.toUpperCase()) : "");
      this.labels.text(this.elMore[i], bay && bay.overflow > 0 ? `+${bay.overflow} more` : "");
    }
  }

  private drawCrate(c: Crate): Graphics {
    const g = new Graphics();
    const { x, y, w, h: d } = c.rect;
    const lift = crateLift(c.shape.h);
    const look = c.listed ? LISTED_LOOK : LOOKS[c.tier];
    const fy = y + d - lift; // top of the front face
    g.rect(x + 1, y + d, w, 2).fill({ color: PAL.shadow, alpha: 0.4 });
    // top face
    g.rect(x, y - lift, w, d).fill(look.top);
    g.rect(x, y - lift, w, 1).fill({ color: 0xffffff, alpha: 0.22 });
    g.rect(x, y - lift, 1, d).fill(look.band);
    g.rect(x + w - 1, y - lift, 1, d).fill(look.band);
    if (w >= 12) g.rect(x + w / 2 - 1, y - lift + d / 2 - 2, 2, 2).fill(look.band);
    // front face, one band per stacked crate
    g.rect(x, fy, w, lift).fill(look.front);
    g.rect(x, fy, w, 1).fill(look.edge);
    const per = lift / c.shape.stack;
    for (let i = 0; i < c.shape.stack; i++) {
      const by = Math.round(fy + i * per);
      if (i > 0) g.rect(x, by, w, 1).fill(look.edge);
      g.rect(x + 1, by + Math.max(1, Math.floor(per / 2) - 1), w - 2, per >= 5 ? 2 : 1).fill(look.band);
    }
    g.rect(x, fy, 1, lift).fill(look.edge);
    g.rect(x + w - 1, fy, 1, lift).fill(look.edge);
    if (c.listed) {
      // tick on the top face
      g.rect(x + 2, y - lift + d / 2, 1, 1).fill(0xffffff);
      g.rect(x + 3, y - lift + d / 2 + 1, 1, 1).fill(0xffffff);
      g.rect(x + 4, y - lift + d / 2, 1, 1).fill(0xffffff);
      g.rect(x + 5, y - lift + d / 2 - 1, 1, 1).fill(0xffffff);
    }
    g.zIndex = y + d;
    return g;
  }

  /** The crate drawn under a world point, front-most first. */
  crateAt(wx: number, wy: number): Crate | null {
    let best: Crate | null = null;
    for (const c of this.layout?.crates ?? []) {
      const lift = crateLift(c.shape.h);
      if (wx < c.rect.x - 1 || wx > c.rect.x + c.rect.w + 1 || wy < c.rect.y - lift - 1 || wy > c.rect.y + c.rect.h + 1) continue;
      if (!best || c.rect.y > best.rect.y) best = c;
    }
    return best;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const layout = this.layout;
    const connected = layout?.summary.connected ?? false;

    // value glow under the crates: steady for gold, breathing for the big ones
    const g = this.glow;
    g.clear();
    for (const c of layout?.crates ?? []) {
      if (c.listed) {
        g.rect(c.rect.x - 2, c.rect.y - 1, c.rect.w + 4, c.rect.h + 3).fill({ color: 0x35e0b4, alpha: 0.14 });
        continue;
      }
      if (c.tier < 2) continue;
      const lift = crateLift(c.shape.h);
      const a = c.tier === 3 ? 0.2 + 0.16 * Math.sin(t * 4 + c.slot) : 0.1;
      g.rect(c.rect.x - 2, c.rect.y - lift - 2, c.rect.w + 4, c.rect.h + lift + 4).fill({ color: PAL.gold, alpha: a });
      if (c.tier === 3) g.rect(c.rect.x - 4, c.rect.y - lift - 4, c.rect.w + 8, c.rect.h + lift + 8).fill({ color: PAL.goldLight, alpha: a * 0.4 });
    }

    // terminal screens
    const s = this.screens;
    s.clear();
    for (let i = 0; i < RACK.count; i++) {
      const k = terminalRect(i);
      const more = (layout?.bays[i]?.overflow ?? 0) > 0;
      const a = connected ? (more ? 0.75 + 0.25 * Math.sin(t * 5 + i) : 0.7) : 0.3 + 0.1 * Math.sin(t * 2 + i);
      s.rect(k.x + 2, k.y - 5, k.w - 4, 5).fill({ color: connected ? PAL.cyanDark : 0x5a3a12, alpha: 0.95 });
      const row = Math.floor(t * 3 + i) % 3;
      for (let r = 0; r < 3; r++) {
        s.rect(k.x + 3, k.y - 5 + r * 2, r === row ? k.w - 6 : 5 + ((r * 3 + i) % 4), 1).fill({ color: connected ? PAL.cyanLight : 0xffb86b, alpha: r === row ? a : a * 0.6 });
      }
    }
  }

  destroy() {
    for (const g of this.crateViews) g.destroy();
    for (const g of this.terminalViews) g.destroy();
    this.screens.destroy();
    this.back.destroy({ children: true });
  }
}
