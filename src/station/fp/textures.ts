import { CHAR_ART, paintCharacter, type CharacterPalette, type Dir } from "../entities/character";
import {
  BR_FLOOR,
  COUNTER_SOLID,
  CORRIDOR,
  CORRIDOR_LOW,
  CORRIDOR_SV,
  CORRIDOR_SW,
  FIXTURES,
  FLOOR,
  PAL,
  QUEUE_SLOTS,
  RACK,
  ROW_H,
  SHOP_FLOOR,
  SHOP_RACK,
  TANK_SOLID,
  WH_FLOOR,
  WH_OX,
  WORLD_H,
  WORLD_W,
  fixtureById,
  queueSlot,
  rackRect,
  rivenCaseRect,
  shopRackRect,
  terminalRect,
  type Rect,
} from "../engine/constants";
import type { Tier } from "../engine/warehouse";
import { WALL_H, type Tex } from "./raycaster";

/** Procedural textures for the first-person view. Everything is drawn in code, in the station palette. */

/** 0xRRGGBB to the frame buffer's 0xAABBGGRR. `glow` marks the pixel emissive. */
export const rgb = (hex: number, glow = false): number => ((glow ? 0xfe : 0xff) << 24) | ((hex & 255) << 16) | (hex & 0xff00) | ((hex >>> 16) & 255) | 0;

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >>> s) & 255) * (1 - t) + ((b >>> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
}

class Paint {
  readonly px: Uint32Array;
  constructor(
    readonly w: number,
    readonly h: number,
    fill = 0,
  ) {
    this.px = new Uint32Array(w * h);
    if (fill) this.px.fill(fill >>> 0);
  }
  rect(x: number, y: number, w: number, h: number, hex: number, glow = false) {
    const c = rgb(hex, glow) >>> 0;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.w + x0, yy * this.w + x1);
  }
  /** Blend a colour over what is there. */
  tint(x: number, y: number, w: number, h: number, hex: number, alpha: number) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    const sr = (hex >>> 16) & 255;
    const sg = (hex >>> 8) & 255;
    const sb = hex & 255;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * this.w + xx;
        const c = this.px[i];
        const r = Math.round((c & 255) * (1 - alpha) + sr * alpha);
        const g = Math.round(((c >>> 8) & 255) * (1 - alpha) + sg * alpha);
        const b = Math.round(((c >>> 16) & 255) * (1 - alpha) + sb * alpha);
        this.px[i] = ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  }
  tex(): Tex {
    return { w: this.w, h: this.h, px: this.px };
  }
}

/** Add box-filtered half-size copies to a texture (see Tex.mips). */
export function withMips(tex: Tex): Tex {
  const mips: Tex[] = [];
  let src = tex;
  while (src.w >= 16 && src.h >= 8) {
    const w = src.w >> 1;
    const h = src.h >> 1;
    const px = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        let glow = false;
        for (let k = 0; k < 4; k++) {
          const c = src.px[(y * 2 + (k >> 1)) * src.w + x * 2 + (k & 1)];
          const a = c >>> 24;
          if (a === 0) continue;
          if (a === 254) glow = true;
          r += c & 255;
          g += (c >>> 8) & 255;
          b += (c >>> 16) & 255;
          n++;
        }
        if (n >= 2) px[y * w + x] = (((glow ? 0xfe : 0xff) << 24) | (Math.round(b / n) << 16) | (Math.round(g / n) << 8) | Math.round(r / n)) >>> 0;
      }
    }
    src = { w, h, px };
    mips.push(src);
  }
  tex.mips = mips;
  return tex;
}

// ---------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------

/** Wall panel, 64 units wide and repeating: indigo plating, gold trim top and bottom, a cyan light strip. */
export function wallTex(): Tex {
  const p = new Paint(64, WALL_H, rgb(PAL.wall));
  // plating seams
  for (const x of [0, 32]) {
    p.rect(x, 0, 1, WALL_H, PAL.wallDark);
    p.rect(x + 1, 0, 1, WALL_H, PAL.wallPanel);
  }
  p.rect(4, 26, 24, 1, PAL.wallPanel);
  p.rect(36, 26, 24, 1, PAL.wallPanel);
  p.rect(4, 44, 24, 1, PAL.wallDark);
  p.rect(36, 44, 24, 1, PAL.wallDark);
  // upper band with the light strip
  p.rect(0, 0, 64, 5, PAL.wallTop);
  p.rect(0, 5, 64, 1, PAL.goldDark);
  p.rect(10, 9, 44, 2, PAL.cyan, true);
  p.rect(10, 9, 44, 1, PAL.cyanLight, true);
  p.tint(6, 11, 52, 4, PAL.cyan, 0.14);
  // skirting: gold trim over a dark base
  p.rect(0, WALL_H - 12, 64, 2, PAL.gold, true);
  p.rect(0, WALL_H - 10, 64, 1, PAL.goldDark);
  p.rect(0, WALL_H - 9, 64, 9, PAL.wallDark);
  p.rect(26, WALL_H - 13, 6, 4, PAL.goldLight, true);
  // rivets
  p.rect(3, 20, 1, 1, PAL.goldDark);
  p.rect(35, 38, 1, 1, PAL.goldDark);
  return p.tex();
}

/** Gold and cyan frame used for the doorway jambs and rack posts. */
export function frameTex(): Tex {
  const p = new Paint(16, WALL_H, rgb(PAL.metalDark));
  p.rect(1, 0, 14, WALL_H, PAL.metal);
  p.rect(0, 0, 1, WALL_H, PAL.gold, true);
  p.rect(15, 0, 1, WALL_H, PAL.gold, true);
  p.rect(7, 4, 2, WALL_H - 16, PAL.cyanDark);
  p.rect(7, 10, 2, WALL_H - 34, PAL.cyan, true);
  p.rect(0, 0, 16, 3, PAL.goldDark);
  p.rect(0, WALL_H - 10, 16, 2, PAL.gold, true);
  p.rect(0, WALL_H - 8, 16, 8, PAL.wallDark);
  for (let y = 18; y < WALL_H - 14; y += 18) p.rect(2, y, 12, 1, PAL.metalDark);
  return p.tex();
}

export function postTex(): Tex {
  const p = new Paint(4, WALL_H, rgb(PAL.metal));
  p.rect(0, 0, 1, WALL_H, PAL.metalLight);
  p.rect(3, 0, 1, WALL_H, PAL.metalDark);
  for (let y = 4; y < WALL_H; y += 12) p.rect(0, y, 4, 1, PAL.goldDark);
  p.rect(0, WALL_H - 24, 4, 2, PAL.gold, true);
  return p.tex();
}

export function ceilingTex(): Tex {
  const p = new Paint(64, 64, rgb(0x0a0820));
  p.rect(0, 0, 64, 2, PAL.wallDark);
  p.rect(0, 0, 2, 64, PAL.wallDark);
  p.rect(2, 2, 62, 1, 0x0d0a26);
  // recessed light bar
  p.rect(22, 30, 20, 3, PAL.cyanDark);
  p.rect(24, 31, 16, 1, PAL.cyan, true);
  p.rect(31, 2, 1, 62, 0x0d0b28);
  p.rect(50, 50, 2, 2, PAL.goldDark);
  return p.tex();
}

/** Floor of the whole world at one texel per unit: tiles, inlay, queue marks, rack pallets, door threshold. */
export function floorTex(): Tex {
  const p = new Paint(WORLD_W, WORLD_H, rgb(PAL.void));
  const tiles = (f: Rect) => {
    const T = 16;
    for (let ty = 0; ty * T < f.h; ty++) {
      for (let tx = 0; tx * T < f.w; tx++) {
        const x = f.x + tx * T;
        const y = f.y + ty * T;
        const w = Math.min(T, f.x + f.w - x);
        const h = Math.min(T, f.y + f.h - y);
        p.rect(x, y, w, h, (tx + ty) % 2 === 0 ? PAL.floorA : PAL.floorB);
        p.rect(x, y, w, 1, PAL.floorLine);
        p.rect(x, y, 1, h, PAL.floorLine);
        if ((tx * 7 + ty * 13) % 11 === 0) p.rect(x + 7, y + 7, 2, 2, mix(PAL.floorA, PAL.cyan, 0.4));
        if ((tx * 5 + ty * 3) % 17 === 0) p.rect(x + 2, y + 2, 1, 1, mix(PAL.floorA, PAL.gold, 0.5));
      }
    }
  };
  // fill a little past the edges so no void shows at the foot of the walls
  tiles({ x: FLOOR.x - 8, y: FLOOR.y - 8, w: FLOOR.w + 16, h: FLOOR.h + 16 });
  tiles({ x: WH_FLOOR.x - 8, y: WH_FLOOR.y - 8, w: WH_FLOOR.w + 16, h: WH_FLOOR.h + 16 });
  tiles({ x: BR_FLOOR.x - 8, y: BR_FLOOR.y - 8, w: BR_FLOOR.w + 16, h: BR_FLOOR.h + 16 });
  tiles({ x: SHOP_FLOOR.x - 8, y: SHOP_FLOOR.y - 8, w: SHOP_FLOOR.w + 16, h: SHOP_FLOOR.h + 16 });
  // door thresholds between rooms on the same row
  for (const c of [CORRIDOR, CORRIDOR_LOW]) {
    p.rect(c.x, c.y - 2, c.w, c.h + 2, PAL.metalDark);
    for (let x = c.x; x < c.x + c.w; x += 4) p.rect(x, c.y - 2, 2, c.h + 2, PAL.metal);
    p.rect(c.x, c.y + 15, c.w, 2, PAL.cyan, true);
    p.tint(c.x - 24, c.y, 24, c.h, PAL.cyan, 0.12);
    p.tint(c.x + c.w, c.y, 24, c.h, PAL.cyan, 0.12);
  }
  // the two passages between the rows: grated deck with a light line down the middle
  for (const c of [CORRIDOR_SV, CORRIDOR_SW]) {
    const y0 = 262;
    const y1 = ROW_H + 70;
    p.rect(c.x - 4, y0, c.w + 8, y1 - y0, PAL.metalDark);
    for (let y = y0; y < y1; y += 4) p.rect(c.x - 4, y, c.w + 8, 2, PAL.metal);
    p.rect(c.x + c.w / 2 - 1, y0, 2, y1 - y0, PAL.cyan, true);
    p.tint(c.x, y0 - 22, c.w, 22, PAL.cyan, 0.12);
    p.tint(c.x, y1, c.w, 22, PAL.cyan, 0.12);
  }
  // diamond inlay in the vault
  const cx = 236;
  const cy = 198;
  for (const [rx, ry, a] of [
    [44, 26, 0.55],
    [28, 16, 0.4],
  ] as const) {
    for (let i = 0; i <= rx; i++) {
      const dy = Math.round(ry * (1 - i / rx));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.tint(cx + sx * i, cy + sy * dy, 1, 1, PAL.gold, a);
    }
  }
  p.rect(cx - 2, cy - 2, 4, 4, mix(PAL.floorA, PAL.gold, 0.6));
  // queue marks
  for (let i = 0; i < QUEUE_SLOTS; i++) {
    const s = queueSlot(i);
    p.rect(s.x - 5, s.y + 2, 10, 1, i === 0 ? PAL.cyan : PAL.cyanDark, i === 0);
  }
  // warm pool in front of the tank, cool pool in front of the counter
  p.tint(TANK_SOLID.x - 4, TANK_SOLID.y + TANK_SOLID.h, TANK_SOLID.w + 8, 6, PAL.gold, 0.2);
  p.tint(TANK_SOLID.x + 6, TANK_SOLID.y + TANK_SOLID.h + 6, TANK_SOLID.w - 12, 5, PAL.gold, 0.1);
  p.tint(COUNTER_SOLID.x, COUNTER_SOLID.y + COUNTER_SOLID.h, COUNTER_SOLID.w, 4, PAL.cyan, 0.1);
  // aisle guide lines between the racks
  for (let i = 0; i < RACK.count; i++) {
    const r = rackRect(i);
    p.tint(r.x - 3, r.y, 1, r.h, PAL.gold, 0.35);
    p.tint(r.x + r.w + 2, r.y, 1, r.h, PAL.gold, 0.35);
    const t = terminalRect(i);
    p.tint(t.x - 4, t.y + t.h, t.w + 8, 5, PAL.cyan, 0.16);
  }
  // --- shop floor: aisle lines by the shelves, a gold diamond in the open floor
  for (let i = 0; i <= SHOP_RACK.count; i++) {
    const r = i < SHOP_RACK.count ? shopRackRect(i) : rivenCaseRect();
    p.tint(r.x - 3, r.y, 1, r.h, PAL.gold, 0.35);
    p.tint(r.x + r.w + 2, r.y, 1, r.h, PAL.gold, 0.35);
  }
  const diamond = (dx: number, dy: number, rx: number, ry: number, hex: number, a: number) => {
    for (let i = 0; i <= rx; i++) {
      const off = Math.round(ry * (1 - i / rx));
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.tint(dx + sx * i, dy + sy * off, 1, 1, hex, a);
    }
  };
  diamond(WH_OX + 406, ROW_H + 150, 36, 22, PAL.gold, 0.55);
  diamond(WH_OX + 406, ROW_H + 150, 20, 12, PAL.gold, 0.4);
  // --- control deck: compass inlay, the pad at the lever, the maintenance hatch
  diamond(238, ROW_H + 176, 44, 26, PAL.cyan, 0.45);
  diamond(238, ROW_H + 176, 24, 14, PAL.gold, 0.45);
  const lv = fixtureById("lever").rect;
  p.rect(lv.x + 6, lv.y + lv.h + 6, lv.w - 12, 1, PAL.gold, true);
  p.tint(lv.x, lv.y + lv.h, lv.w, 6, 0x35e0b4, 0.14);
  const h = fixtureById("hatch").rect;
  p.rect(h.x - 1, h.y - 1, h.w + 2, h.h + 2, PAL.goldDark);
  p.rect(h.x, h.y, h.w, h.h, PAL.metalDark);
  for (let x = h.x; x < h.x + h.w; x += 4) {
    p.rect(x, h.y, 2, 3, PAL.gold, true);
    p.rect(x + 2, h.y + h.h - 3, 2, 3, PAL.gold, true);
  }
  p.rect(h.x + 3, h.y + 4, h.w - 6, h.h - 8, PAL.metal);
  p.rect(h.x + h.w / 2 - 3, h.y + h.h / 2 - 1, 6, 2, PAL.metalLight);
  // a pool of light in front of every terminal
  for (const f of FIXTURES) if (f.kind === "terminal") p.tint(f.rect.x - 4, f.rect.y + f.rect.h, f.rect.w + 8, 5, PAL.cyan, 0.16);
  return p.tex();
}

// ---------------------------------------------------------------------------
// Vault props
// ---------------------------------------------------------------------------

/** Tank casing. The glass rectangle is replaced by the live fluid image at draw time. */
export const TANK_FACE = { w: 120, h: WALL_H, glass: { x: 10, y: 7, w: 100, h: 54 } } as const;
export function tankTex(): Tex {
  const p = new Paint(TANK_FACE.w, TANK_FACE.h, rgb(PAL.metal));
  const g = TANK_FACE.glass;
  p.rect(0, 0, TANK_FACE.w, TANK_FACE.h, PAL.metalDark);
  p.rect(2, 2, TANK_FACE.w - 4, TANK_FACE.h - 4, PAL.metal);
  // cap and plinth
  p.rect(0, 0, TANK_FACE.w, 2, PAL.gold, true);
  p.rect(0, 5, TANK_FACE.w, 1, PAL.goldDark);
  p.rect(0, g.y + g.h + 3, TANK_FACE.w, 2, PAL.gold, true);
  p.rect(0, TANK_FACE.h - 3, TANK_FACE.w, 3, PAL.metalDark);
  for (let x = 8; x < TANK_FACE.w - 6; x += 16) p.rect(x, g.y + g.h + 7, 6, 2, PAL.cyan, true);
  // glass recess
  p.rect(g.x - 2, g.y - 2, g.w + 4, g.h + 4, PAL.goldDark);
  p.rect(g.x - 1, g.y - 1, g.w + 2, g.h + 2, PAL.void);
  // side rivets
  for (let y = 12; y < g.y + g.h; y += 14) {
    p.rect(3, y, 2, 2, PAL.goldLight);
    p.rect(TANK_FACE.w - 5, y, 2, 2, PAL.goldLight);
  }
  return p.tex();
}

export function counterSideTex(): Tex {
  const p = new Paint(120, 16, rgb(PAL.metalDark));
  p.rect(0, 0, 120, 2, PAL.gold, true);
  p.rect(0, 2, 120, 1, PAL.goldDark);
  p.rect(6, 6, 108, 1, PAL.cyan, true);
  p.rect(0, 3, 2, 13, PAL.goldDark);
  p.rect(118, 3, 2, 13, PAL.goldDark);
  for (let x = 12; x < 110; x += 24) p.rect(x, 9, 14, 4, PAL.metal);
  return p.tex();
}

export function counterTopTex(): Tex {
  const p = new Paint(120, 24, rgb(PAL.metalLight));
  p.rect(2, 2, 116, 20, PAL.metal);
  p.rect(0, 0, 120, 1, PAL.goldLight);
  p.rect(0, 23, 120, 1, PAL.gold);
  // terminal, trade mat, bell
  p.rect(8, 4, 16, 10, PAL.metalDark);
  p.rect(9, 5, 14, 8, PAL.cyanDark, true);
  p.rect(10, 7, 12, 1, PAL.cyanLight, true);
  p.rect(10, 10, 7, 1, PAL.cyanLight, true);
  p.rect(44, 6, 30, 12, 0x221c52);
  p.rect(44, 6, 30, 1, PAL.goldDark);
  p.rect(56, 11, 6, 2, PAL.gold, true);
  p.rect(104, 8, 8, 8, PAL.goldDark);
  p.rect(105, 9, 6, 6, PAL.gold, true);
  p.rect(107, 11, 2, 2, PAL.goldLight, true);
  return p.tex();
}

/** Plain cargo crate (the decorative ones in the vault, and the base look for stock). */
function crateBase(body: number, light: number, dark: number): Paint {
  const p = new Paint(16, 12, rgb(body));
  p.rect(0, 0, 16, 1, light);
  p.rect(0, 11, 16, 1, dark);
  p.rect(0, 0, 1, 12, dark);
  p.rect(15, 0, 1, 12, dark);
  p.rect(0, 0, 2, 2, PAL.gold);
  p.rect(14, 0, 2, 2, PAL.gold);
  return p;
}

export function plainCrateTex(): { side: Tex; top: Tex } {
  const side = crateBase(PAL.metal, PAL.metalLight, PAL.metalDark);
  side.rect(2, 5, 12, 2, PAL.goldDark);
  const top = new Paint(8, 8, rgb(PAL.metalLight));
  top.rect(0, 0, 8, 1, PAL.metal);
  top.rect(0, 7, 8, 1, PAL.metal);
  top.rect(3, 3, 2, 2, PAL.goldDark);
  return { side: side.tex(), top: top.tex() };
}

export interface CrateTexSet {
  side: Tex;
  sideAlt?: Tex;
  top: Tex;
}

/** Stock crate looks: index 0-3 by value tier, 4 = listed (teal). Tier 3 has an alternate frame to pulse with. */
export function crateTexSets(): CrateTexSet[] {
  const make = (body: number, light: number, dark: number, band: number, glow: boolean, bright = false): CrateTexSet => {
    const side = crateBase(body, light, dark);
    side.rect(1, 4, 14, 3, band, glow);
    side.rect(1, 4, 14, 1, bright ? PAL.goldLight : mix(band, 0xffffff, 0.3), glow);
    side.rect(7, 8, 2, 2, band, glow);
    const top = new Paint(8, 8, rgb(light));
    top.rect(0, 0, 8, 1, band, glow);
    top.rect(0, 7, 8, 1, band, glow);
    top.rect(0, 0, 1, 8, band, glow);
    top.rect(7, 0, 1, 8, band, glow);
    top.rect(3, 3, 2, 2, bright ? PAL.goldLight : band, glow);
    return { side: side.tex(), top: top.tex() };
  };
  const dim = make(0x24223f, 0x34325a, PAL.metalDark, 0x4a4873, false);
  const cyan = make(PAL.metal, PAL.metalLight, PAL.metalDark, PAL.cyan, true);
  const gold = make(0x6b5220, 0x8a6a2f, PAL.goldDeep, PAL.gold, true);
  const bright = make(0xb8862b, PAL.gold, PAL.goldDark, PAL.goldLight, true, true);
  // the pulse frame: the whole crate lights up
  const hot = new Paint(16, 12, rgb(PAL.gold, true));
  hot.rect(0, 0, 16, 1, PAL.goldLight, true);
  hot.rect(1, 4, 14, 3, 0xffffff, true);
  hot.rect(0, 11, 16, 1, PAL.goldDark, true);
  bright.sideAlt = hot.tex();
  const listed = make(0x0f5a4c, 0x1a8a72, 0x083a32, 0x35e0b4, true);
  // tick mark
  const lp = new Paint(16, 12);
  lp.px.set(listed.side.px);
  lp.rect(5, 8, 1, 1, 0xffffff, true);
  lp.rect(6, 9, 1, 1, 0xffffff, true);
  lp.rect(7, 8, 1, 1, 0xffffff, true);
  lp.rect(8, 7, 1, 1, 0xffffff, true);
  lp.rect(9, 6, 1, 1, 0xffffff, true);
  listed.side = lp.tex();
  return [dim, cyan, gold, bright, listed];
}
export const crateTexIndex = (tier: Tier, listed: boolean) => (listed ? 4 : tier);

const tintedCache = new Map<string, CrateTexSet>();
/** A shelf crate in one colour (a stock status), cached. `dim` is the look of a hidden entry. */
export function tintedCrateTex(color: number, dim = false, card = false): CrateTexSet {
  const key = `${color}:${dim ? 1 : 0}:${card ? 1 : 0}`;
  let set = tintedCache.get(key);
  if (!set) {
    const body = dim ? 0x24223f : mix(mix(color, 0x000000, 0.62), 0x2b2a4d, 0.35);
    const light = dim ? 0x34325a : mix(mix(color, 0x000000, 0.42), 0x45447a, 0.35);
    const dark = dim ? PAL.metalDark : mix(color, 0x000000, 0.8);
    const band = dim ? mix(0x4a4873, color, 0.35) : color;
    const side = crateBase(body, light, dark);
    side.rect(1, 4, 14, 3, band, !dim);
    side.rect(1, 4, 14, 1, mix(band, 0xffffff, 0.3), !dim);
    side.rect(7, 8, 2, 2, band, !dim);
    if (card) {
      // riven card on the front
      side.rect(5, 2, 6, 8, 0x2a1a55);
      side.rect(6, 3, 4, 6, 0xb388ff, true);
      side.rect(7, 5, 2, 2, 0xf3e8ff, true);
    }
    const top = new Paint(8, 8, rgb(light));
    top.rect(0, 0, 8, 1, band, !dim);
    top.rect(0, 7, 8, 1, band, !dim);
    top.rect(0, 0, 1, 8, band, !dim);
    top.rect(7, 0, 1, 8, band, !dim);
    top.rect(3, 3, 2, 2, card ? 0xf3e8ff : band, !dim);
    set = { side: side.tex(), top: top.tex() };
    if (tintedCache.size > 80) tintedCache.clear();
    tintedCache.set(key, set);
  }
  return set;
}

/** The trader console: lamps along the front, the lever slot on top. */
export function leverTex(on: boolean, beat: boolean): { side: Tex; top: Tex } {
  const side = new Paint(48, 16, rgb(PAL.metalDark));
  side.rect(0, 0, 48, 2, PAL.gold, true);
  side.rect(0, 2, 48, 1, PAL.goldDark);
  side.rect(0, 3, 2, 13, PAL.goldDark);
  side.rect(46, 3, 2, 13, PAL.goldDark);
  for (let i = 0; i < 9; i++) {
    const lit = on ? (i + (beat ? 1 : 0)) % 3 !== 0 : i === 0 && beat;
    side.rect(5 + i * 4.5, 7, 3, 3, on ? (lit ? 0x3ddcb0 : 0x0f5a4c) : lit ? 0xff4d6d : PAL.metal, lit);
  }
  side.rect(8, 12, 32, 1, on ? 0x35e0b4 : PAL.cyanDark, on);
  const top = new Paint(48, 16, rgb(PAL.metalLight));
  top.rect(2, 2, 44, 12, PAL.metal);
  top.rect(0, 0, 48, 1, PAL.goldLight);
  top.rect(4, 4, 10, 8, on ? PAL.cyanDark : 0x24223f, on);
  top.rect(34, 4, 10, 8, on ? 0x0f5a4c : 0x3a1420);
  top.rect(36, 7, 4, 2, on ? 0x35e0b4 : 0xff4d6d, true);
  top.rect(21, 2, 6, 12, PAL.void);
  top.rect(23, 3, 2, 10, PAL.goldDeep);
  top.rect(20, on ? 2 : 9, 8, 5, on ? 0x35e0b4 : PAL.gold, true);
  return { side: side.tex(), top: top.tex() };
}

/** The lever handle, as a small billboard standing on the console. */
export function leverHandleTex(on: boolean): Tex {
  const p = new Paint(8, 14, 0);
  p.rect(3, 5, 2, 9, PAL.goldDark);
  p.rect(0, 0, 8, 6, on ? 0x35e0b4 : PAL.gold, true);
  p.rect(0, 0, 8, 1, on ? 0xeafff6 : PAL.goldLight, true);
  p.rect(0, 5, 8, 1, on ? 0x0f5a4c : PAL.goldDark);
  return p.tex();
}

export function deskTex(): { side: Tex; top: Tex } {
  const side = new Paint(56, 15, rgb(PAL.metalDark));
  side.rect(0, 0, 56, 2, PAL.gold, true);
  side.rect(0, 2, 56, 1, PAL.goldDark);
  side.rect(6, 6, 44, 1, PAL.gold, true);
  side.rect(0, 3, 2, 12, PAL.goldDark);
  side.rect(54, 3, 2, 12, PAL.goldDark);
  const top = new Paint(56, 16, rgb(PAL.metalLight));
  top.rect(2, 2, 52, 12, PAL.metal);
  top.rect(0, 0, 56, 1, PAL.goldLight);
  top.rect(6, 4, 14, 8, 0x221c52);
  top.rect(7, 6, 8, 1, PAL.goldDark);
  top.rect(7, 9, 11, 1, PAL.goldDark);
  top.rect(34, 3, 16, 9, PAL.void);
  top.rect(35, 4, 14, 7, PAL.cyanDark, true);
  for (let i = 0; i < 4; i++) top.rect(36 + i * 3, 10 - [2, 4, 3, 5][i], 2, [2, 4, 3, 5][i], PAL.cyanLight, true);
  return { side: side.tex(), top: top.tex() };
}

/** Deck of the riven display case. */
export function caseTex(rows: number, rowPitch: number): { side: Tex; top: Tex } {
  const side = new Paint(8, 4, rgb(PAL.metalDark));
  side.rect(0, 0, 8, 1, 0xb388ff, true);
  const h = rows * rowPitch;
  const top = new Paint(40, h, rgb(PAL.metalDark));
  top.rect(1, 1, 38, h - 2, 0x1a1436);
  top.rect(19, 0, 2, h, PAL.metal);
  top.rect(0, 0, 40, 1, 0xb388ff, true);
  top.rect(0, h - 1, 40, 1, 0xb388ff, true);
  for (let r = 0; r < rows; r++) {
    const y = r * rowPitch;
    top.rect(0, y, 40, 1, PAL.metal);
    for (const x of [1, 23]) {
      top.rect(x, y + 11, 16, 1, 0x6a4fb8);
      top.rect(x, y + 24, 16, 1, 0x6a4fb8);
    }
  }
  return { side: side.tex(), top: top.tex() };
}

export function rackTex(): { side: Tex; top: Tex } {
  const side = new Paint(8, 4, rgb(PAL.metalDark));
  side.rect(0, 0, 8, 1, PAL.goldDark);
  const top = new Paint(RACK.w, RACK.rows * RACK.rowPitch, rgb(0x100e26));
  top.rect(0, 0, RACK.w, RACK.rows * RACK.rowPitch, PAL.metalDark);
  top.rect(1, 1, RACK.w - 2, RACK.rows * RACK.rowPitch - 2, 0x121029);
  // spine down the middle and a marked slot per crate
  top.rect(RACK.colW + 3, 0, 2, RACK.rows * RACK.rowPitch, PAL.metal);
  for (let r = 0; r < RACK.rows; r++) {
    const y = r * RACK.rowPitch;
    top.rect(0, y, RACK.w, 1, PAL.metal);
    for (const x of [1, RACK.w - RACK.colW - 1]) {
      top.rect(x, y + 11, RACK.colW, 1, PAL.cyanDark);
      top.rect(x, y + 24, RACK.colW, 1, PAL.cyanDark);
    }
  }
  return { side: side.tex(), top: top.tex() };
}

export function terminalTex(active: boolean): { side: Tex; top: Tex } {
  const side = new Paint(16, 24, rgb(PAL.metalDark));
  side.rect(0, 0, 16, 1, PAL.gold, true);
  side.rect(1, 2, 14, 11, PAL.void);
  side.rect(2, 3, 12, 9, active ? PAL.cyanDark : 0x0a2c38, true);
  for (let i = 0; i < 4; i++) side.rect(3, 4 + i * 2, [10, 6, 8, 4][i], 1, active ? PAL.cyanLight : PAL.cyanDark, true);
  side.rect(2, 16, 12, 1, PAL.metal);
  side.rect(6, 19, 4, 2, active ? PAL.gold : PAL.goldDark, active);
  const top = new Paint(8, 4, rgb(PAL.metal));
  top.rect(1, 1, 6, 2, active ? PAL.cyan : PAL.cyanDark, true);
  return { side: side.tex(), top: top.tex() };
}

/** Decorative stock shelves behind the trade desk (the same boxes the top-down wall shows). */
export function shelvesTex(): Tex {
  const p = new Paint(112, 34, 0);
  for (let row = 0; row < 2; row++) {
    const y = row * 16;
    p.rect(0, y + 14, 112, 2, PAL.metalLight);
    p.rect(0, y + 16, 112, 1, PAL.metalDark);
    for (let i = 0; i < 9; i++) {
      const bx = 3 + i * 12;
      const tall = 6 + ((i * 3 + row * 5) % 5);
      const k = (i + row * 2) % 5;
      const hue = [PAL.gold, PAL.cyanDark, PAL.metalLight, PAL.goldDark, PAL.cyan][k];
      p.rect(bx, y + 14 - tall, 8, tall, hue, k === 0 || k === 4);
      p.rect(bx, y + 14 - tall, 8, 1, mix(hue, 0xffffff, 0.3));
      p.rect(bx + 3, y + 14 - tall + 2, 2, 1, PAL.void);
    }
  }
  return withMips(p.tex());
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const charCache = new Map<string, Tex>();

/** A character frame as a billboard texture, from the same painter the top-down sprite uses. */
export function characterTex(palette: CharacterPalette, key: string, dir: Dir, frame: number, walking: boolean): Tex {
  const id = `${key}:${dir}:${frame}:${walking ? 1 : 0}`;
  let tex = charCache.get(id);
  if (!tex) {
    const p = new Paint(CHAR_ART.w + 2, CHAR_ART.h + 1, 0);
    paintCharacter((x, y, w, h, color) => p.rect(x - CHAR_ART.x + 1, y - CHAR_ART.y + 1, w, h, color), palette, dir, frame, walking);
    // the visor glows in the dark
    const visor = rgb(palette.visor) >>> 0;
    const glow = rgb(palette.visor, true) >>> 0;
    for (let i = 0; i < p.px.length; i++) if (p.px[i] === visor) p.px[i] = glow;
    tex = p.tex();
    if (charCache.size > 400) charCache.clear();
    charCache.set(id, tex);
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Text plates (signs and displays): the only textures that go through a canvas, for the font
// ---------------------------------------------------------------------------

export interface TextLine {
  text: string;
  /** Left edge (or centre / right edge, see align) and baseline, in texels. */
  x: number;
  y: number;
  size: number;
  color: string;
  align?: CanvasTextAlign;
  font?: string;
}

export function textPlate(w: number, h: number, lines: TextLine[], opts: { bg?: number; border?: number } = {}): Tex {
  const p = new Paint(w, h, rgb(opts.bg ?? 0x07061a));
  if (opts.border !== undefined) {
    p.rect(0, 0, w, h, opts.border, true);
    p.rect(1, 1, w - 2, h - 2, opts.bg ?? 0x07061a);
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      for (const l of lines) {
        ctx.font = `${l.font ?? "700"} ${l.size}px Rajdhani, "Segoe UI", sans-serif`;
        ctx.textAlign = l.align ?? "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, l.x, l.y);
      }
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h; i++) {
        const a = data[i * 4 + 3];
        if (a < 90) continue;
        // emissive text over the plate; partial coverage is blended once, here, so edges stay crisp when scaled
        const bg = p.px[i];
        const t = a / 255;
        const r = Math.round((bg & 255) * (1 - t) + data[i * 4] * t);
        const g = Math.round(((bg >>> 8) & 255) * (1 - t) + data[i * 4 + 1] * t);
        const b = Math.round(((bg >>> 16) & 255) * (1 - t) + data[i * 4 + 2] * t);
        p.px[i] = (0xfe000000 | (b << 16) | (g << 8) | r) >>> 0;
      }
    }
  } catch {
    /* no canvas text: the plate stays blank */
  }
  return withMips(p.tex());
}
