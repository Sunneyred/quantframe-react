import type { Rect } from "./constants";

/** Pure helpers for axis-aligned collision of a small body against the room. */

export interface Body {
  /** Centre x of the feet box. */
  x: number;
  /** Bottom y of the feet box. */
  y: number;
}

export const BODY_HALF_W = 4;
export const BODY_H = 5;

export const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const bodyRect = (x: number, y: number): Rect => ({ x: x - BODY_HALF_W, y: y - BODY_H, w: BODY_HALF_W * 2, h: BODY_H });

export function isBlocked(x: number, y: number, floor: Rect, solids: Rect[]): boolean {
  const r = bodyRect(x, y);
  if (r.x < floor.x || r.y < floor.y || r.x + r.w > floor.x + floor.w || r.y + r.h > floor.y + floor.h) return true;
  for (const s of solids) if (rectsOverlap(r, s)) return true;
  return false;
}

/** Move with per-axis sliding. Returns the new position and whether any axis was blocked. */
export function moveBody(body: Body, dx: number, dy: number, floor: Rect, solids: Rect[]): { x: number; y: number; hitX: boolean; hitY: boolean } {
  let { x, y } = body;
  let hitX = false;
  let hitY = false;
  if (dx !== 0) {
    if (!isBlocked(x + dx, y, floor, solids)) x += dx;
    else hitX = true;
  }
  if (dy !== 0) {
    if (!isBlocked(x, y + dy, floor, solids)) y += dy;
    else hitY = true;
  }
  return { x, y, hitX, hitY };
}

export function distToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export const pointInRect = (px: number, py: number, r: Rect, pad = 0) =>
  px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;
