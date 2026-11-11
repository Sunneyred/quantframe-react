import { Graphics } from "pixi.js";
import { DOOR, PAL, SOUTH_DOOR, VIEW_H, VIEW_W, type Rect } from "./constants";

/** Shared top-down drawing: room shells, doors, terminals and wall plates. Everything is drawn at a room origin (ox, oy). */

export interface ShellDoors {
  /** Passage up through the back wall (to the room above). */
  north?: boolean;
  east?: boolean;
  west?: boolean;
}

export function shade(hex: number, f: number): number {
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((hex >>> s) & 255) * f))) << s;
  return ch(16) | ch(8) | ch(0);
}
export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >>> s) & 255) * (1 - t) + ((b >>> s) & 255) * t) << s;
  return ch(16) | ch(8) | ch(0);
}

/** Floor, back wall, side walls and doors of a standard room (the look of the warehouse shell). */
export function drawShell(g: Graphics, ox: number, oy: number, doors: ShellDoors) {
  g.rect(ox, oy, VIEW_W, VIEW_H).fill(PAL.void);
  const f = { x: ox + 8, y: oy + 70, w: 464, h: 192 };
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
      if ((tx * 5 + ty * 3) % 17 === 0) g.rect(x + 2, y + 2, 1, 1).fill({ color: PAL.gold, alpha: 0.5 });
    }
  }
  g.rect(f.x, f.y, f.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
  g.rect(f.x, f.y + 3, f.w, 2).fill({ color: PAL.shadow, alpha: 0.15 });

  // back wall
  g.rect(ox, oy, VIEW_W, 6).fill(PAL.wallTop);
  g.rect(ox, oy + 6, VIEW_W, 56).fill(PAL.wall);
  for (let x = 8; x < VIEW_W; x += 32) {
    g.rect(ox + x, oy + 6, 1, 56).fill(PAL.wallDark);
    g.rect(ox + x + 1, oy + 6, 1, 56).fill({ color: PAL.wallPanel, alpha: 0.8 });
    g.rect(ox + x + 4, oy + 28, 24, 1).fill({ color: PAL.wallPanel, alpha: 0.7 });
  }
  g.rect(ox, oy + 5, VIEW_W, 1).fill(PAL.goldDark);
  g.rect(ox, oy + 62, VIEW_W, 2).fill(PAL.gold);
  g.rect(ox, oy + 64, VIEW_W, 1).fill(PAL.goldDark);
  g.rect(ox, oy + 65, VIEW_W, 5).fill(PAL.wallDark);
  for (let x = 20; x < VIEW_W; x += 48) g.rect(ox + x, oy + 61, 6, 4).fill(PAL.goldLight);

  // side and bottom walls
  g.rect(ox, oy + 6, 8, VIEW_H).fill(PAL.wallTop);
  g.rect(ox + 7, oy + 70, 1, VIEW_H - 78).fill(PAL.goldDark);
  g.rect(ox + VIEW_W - 8, oy + 6, 8, VIEW_H).fill(PAL.wallTop);
  g.rect(ox + VIEW_W - 8, oy + 70, 1, VIEW_H - 78).fill(PAL.goldDark);
  g.rect(ox, oy + VIEW_H - 8, VIEW_W, 8).fill(PAL.wallTop);
  g.rect(ox + 8, oy + VIEW_H - 8, VIEW_W - 16, 1).fill(PAL.goldDark);
  for (let y = 90; y < VIEW_H - 20; y += 40) {
    const atDoor = y >= DOOR.y - 16 && y <= DOOR.y + DOOR.h;
    if (!(doors.west && atDoor)) g.rect(ox + 2, oy + y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
    if (!(doors.east && atDoor)) g.rect(ox + VIEW_W - 5, oy + y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
  }
  if (doors.west) {
    g.rect(ox, oy + DOOR.y - 3, 9, DOOR.h + 6).fill(PAL.gold);
    g.rect(ox, oy + DOOR.y, 8, DOOR.h).fill(0x02020a);
    g.rect(ox + 7, oy + DOOR.y, 1, DOOR.h).fill(PAL.cyan);
    g.rect(ox + 8, oy + DOOR.y + 2, 10, DOOR.h - 4).fill({ color: PAL.cyan, alpha: 0.16 });
    g.rect(ox + 18, oy + DOOR.y + 6, 12, DOOR.h - 12).fill({ color: PAL.cyan, alpha: 0.08 });
  }
  if (doors.east) {
    g.rect(ox + DOOR.x - 1, oy + DOOR.y - 3, DOOR.w + 1, DOOR.h + 6).fill(PAL.gold);
    g.rect(ox + DOOR.x, oy + DOOR.y, DOOR.w, DOOR.h).fill(0x02020a);
    g.rect(ox + DOOR.x, oy + DOOR.y, 1, DOOR.h).fill(PAL.cyan);
    g.rect(ox + DOOR.x - 10, oy + DOOR.y + 2, 10, DOOR.h - 4).fill({ color: PAL.cyan, alpha: 0.16 });
    g.rect(ox + DOOR.x - 22, oy + DOOR.y + 6, 12, DOOR.h - 12).fill({ color: PAL.cyan, alpha: 0.08 });
  }
  if (doors.north) drawNorthPassage(g, ox, oy);
}

/** The passage that comes down through the back wall from the room above. */
export function drawNorthPassage(g: Graphics, ox: number, oy: number) {
  const x = ox + SOUTH_DOOR.x;
  const w = SOUTH_DOOR.w;
  g.rect(x - 2, oy, w + 4, 70).fill(PAL.gold);
  g.rect(x - 1, oy, w + 2, 70).fill(PAL.goldDark);
  g.rect(x, oy, w, 70).fill(PAL.metalDark);
  for (let y = 2; y < 70; y += 4) g.rect(x, oy + y, w, 2).fill(PAL.metal);
  g.rect(x, oy, 2, 70).fill({ color: PAL.shadow, alpha: 0.45 });
  g.rect(x + w - 2, oy, 2, 70).fill({ color: PAL.shadow, alpha: 0.45 });
  g.rect(x + w / 2 - 1, oy, 2, 70).fill({ color: PAL.cyan, alpha: 0.55 });
  g.rect(x, oy + 62, w, 2).fill(PAL.cyan);
  g.rect(x + 2, oy + 70, w - 4, 10).fill({ color: PAL.cyan, alpha: 0.16 });
  g.rect(x + 6, oy + 80, w - 12, 12).fill({ color: PAL.cyan, alpha: 0.08 });
}

/** A door in the bottom wall of a top-row room, leading down. */
export function drawSouthDoor(g: Graphics, ox: number, oy: number) {
  const x = ox + SOUTH_DOOR.x;
  const w = SOUTH_DOOR.w;
  const y = oy + VIEW_H - 8;
  g.rect(x - 3, y - 1, w + 6, 9).fill(PAL.gold);
  g.rect(x, y, w, 8).fill(PAL.metalDark);
  for (let i = 0; i < w; i += 4) g.rect(x + i, y, 2, 8).fill(PAL.metal);
  g.rect(x, y, w, 1).fill(PAL.cyan);
  g.rect(x + 2, y - 10, w - 4, 10).fill({ color: PAL.cyan, alpha: 0.16 });
  g.rect(x + 6, y - 22, w - 12, 12).fill({ color: PAL.cyan, alpha: 0.08 });
}

/** Static body of a standing terminal (the screen is animated separately). */
export function drawTerminalBody(g: Graphics, t: Rect) {
  g.rect(t.x + 1, t.y + t.h, t.w, 2).fill({ color: PAL.shadow, alpha: 0.35 });
  g.rect(t.x, t.y - 8, t.w, 8 + t.h).fill(PAL.metalDark);
  g.rect(t.x, t.y - 8, t.w, 1).fill(PAL.gold);
  g.rect(t.x + 1, t.y - 6, t.w - 2, 7).fill(PAL.void);
  g.rect(t.x + 6, t.y + 4, 4, 2).fill(PAL.goldDark);
}

export function drawTerminalScreen(s: Graphics, k: Rect, t: number, seed: number, alert: boolean) {
  const a = alert ? 0.6 + 0.4 * Math.sin(t * 7) : 0.75;
  s.rect(k.x + 2, k.y - 5, k.w - 4, 5).fill({ color: alert ? 0x6b4a10 : PAL.cyanDark, alpha: 0.95 });
  const row = Math.floor(t * 3 + seed) % 3;
  for (let r = 0; r < 3; r++) {
    s.rect(k.x + 3, k.y - 5 + r * 2, r === row ? k.w - 6 : 5 + ((r * 3 + seed) % 4), 1).fill({ color: alert ? PAL.goldLight : PAL.cyanLight, alpha: r === row ? a : a * 0.6 });
  }
}

/** Framed dark plate on a wall (the base of every readout). */
export function drawPlate(g: Graphics, r: Rect, border: number = PAL.cyanDark) {
  g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).fill(PAL.metalDark);
  g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).fill(border);
  g.rect(r.x, r.y, r.w, r.h).fill(0x07061a);
  for (let y = r.y + 1; y < r.y + r.h; y += 3) g.rect(r.x, y, r.w, 1).fill({ color: PAL.cyan, alpha: 0.05 });
  g.rect(r.x - 2, r.y - 2, 4, 1).fill(PAL.gold);
  g.rect(r.x - 2, r.y - 2, 1, 4).fill(PAL.gold);
  g.rect(r.x + r.w - 2, r.y + r.h + 1, 4, 1).fill(PAL.gold);
  g.rect(r.x + r.w + 1, r.y + r.h - 2, 1, 4).fill(PAL.gold);
}

/** A shelving unit like the warehouse racks: pallet deck, spine, marked slots, four uprights. */
export function drawRack(g: Graphics, k: Rect, rows: number, rowPitch: number, colW: number, accent: number = PAL.cyanDark) {
  g.rect(k.x + 2, k.y + k.h, k.w, 2).fill({ color: PAL.shadow, alpha: 0.35 });
  g.rect(k.x, k.y, k.w, k.h).fill(PAL.metalDark);
  g.rect(k.x + 1, k.y + 1, k.w - 2, k.h - 2).fill(0x121029);
  g.rect(k.x + colW + 3, k.y, 2, k.h).fill(PAL.metal);
  for (let row = 0; row < rows; row++) {
    const y = k.y + row * rowPitch;
    g.rect(k.x, y, k.w, 1).fill(PAL.metal);
    for (const x of [k.x + 1, k.x + k.w - colW - 1]) {
      g.rect(x, y + 11, colW, 1).fill({ color: accent, alpha: 0.7 });
      g.rect(x, y + 24, colW, 1).fill({ color: accent, alpha: 0.7 });
    }
  }
  for (const [px, py] of [
    [k.x, k.y],
    [k.x + k.w - 4, k.y],
    [k.x, k.y + k.h - 4],
    [k.x + k.w - 4, k.y + k.h - 4],
  ]) {
    g.rect(px, py, 4, 4).fill(PAL.metalLight);
    g.rect(px + 1, py + 1, 2, 2).fill(PAL.gold);
  }
  g.rect(k.x - 3, k.y, 1, k.h).fill({ color: PAL.gold, alpha: 0.3 });
  g.rect(k.x + k.w + 2, k.y, 1, k.h).fill({ color: PAL.gold, alpha: 0.3 });
}

export interface CrateLook {
  top: number;
  front: number;
  band: number;
  edge: number;
}
export const lookOf = (color: number, dim = false): CrateLook =>
  dim
    ? { top: 0x34325a, front: 0x24223f, band: mixHex(0x4a4873, color, 0.35), edge: 0x1a1933 }
    : { top: mixHex(shade(color, 0.55), 0x45447a, 0.35), front: mixHex(shade(color, 0.36), 0x2b2a4d, 0.35), band: color, edge: shade(color, 0.2) };

/** A crate (or stack) on a shelf: `lift` is how far its top rises on screen. */
export function drawCrateBox(g: Graphics, r: Rect, lift: number, stack: number, look: CrateLook) {
  const { x, y, w, h: d } = r;
  const fy = y + d - lift;
  g.rect(x + 1, y + d, w, 2).fill({ color: PAL.shadow, alpha: 0.4 });
  g.rect(x, y - lift, w, d).fill(look.top);
  g.rect(x, y - lift, w, 1).fill({ color: 0xffffff, alpha: 0.22 });
  g.rect(x, y - lift, 1, d).fill(look.band);
  g.rect(x + w - 1, y - lift, 1, d).fill(look.band);
  if (w >= 12) g.rect(x + w / 2 - 1, y - lift + d / 2 - 2, 2, 2).fill(look.band);
  g.rect(x, fy, w, lift).fill(look.front);
  g.rect(x, fy, w, 1).fill(look.edge);
  const per = lift / stack;
  for (let i = 0; i < stack; i++) {
    const by = Math.round(fy + i * per);
    if (i > 0) g.rect(x, by, w, 1).fill(look.edge);
    g.rect(x + 1, by + Math.max(1, Math.floor(per / 2) - 1), w - 2, per >= 5 ? 2 : 1).fill(look.band);
  }
  g.rect(x, fy, 1, lift).fill(look.edge);
  g.rect(x + w - 1, fy, 1, lift).fill(look.edge);
}
