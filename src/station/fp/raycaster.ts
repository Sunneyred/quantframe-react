/**
 * Software raycaster for the first-person view. Pure: it reads a Scene and a
 * camera and writes pixels into a Uint32 frame buffer, with no DOM or Pixi.
 *
 * The world is a height grid (CELL-sized columns). Full-height cells are walls;
 * lower cells are boxes you can see over (counter, crates, terminals), drawn
 * with a side face and a textured top. A per-pixel depth buffer lets billboard
 * sprites be clipped correctly against both.
 */

export const CELL = 4;
export const WALL_H = 72;
export const EYE = 25;
/** tan(half horizontal fov). 0.9 is about 84 degrees across. */
const FOV_TAN = 0.9;
const FOG_R = 9;
const FOG_G = 7;
const FOG_B = 30;
const MAX_STEPS = 420;

/** Pixels are 0xAABBGGRR. Alpha 0 = transparent (sprites), 254 = emissive (ignores most fog), 255 = normal. */
export interface Tex {
  w: number;
  h: number;
  px: Uint32Array;
  /** Half-size copies (box filtered), smallest last. Used when the texture is drawn much smaller than it is, so text does not break up. */
  mips?: Tex[];
}

/** The copy of a texture that best fits being drawn at `ratio` texels per screen pixel. */
function mipFor(tex: Tex, ratio: number): Tex {
  const mips = tex.mips;
  if (!mips) return tex;
  let level = 0;
  while (ratio >= 1.7 && level < mips.length) {
    tex = mips[level++];
    ratio /= 2;
  }
  return tex;
}

/** A live image shown inside a rectangle of a face texture (the tank glass). */
export interface LiveInset {
  /** Rectangle in face texture coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** RGBA bytes of the source image, or null while it is not available. */
  src: Uint8ClampedArray | null;
  sw: number;
  sh: number;
  /** Source row to overlay a dashed line on (the goal line), or -1. */
  lineRow: number;
}

export interface Block {
  /** Footprint in world units (aligned to CELL). */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Height in world units; WALL_H or more is a full wall. */
  h: number;
  side: Tex;
  /** Shown instead of `side` on alternate pulse beats. */
  sideAlt?: Tex;
  top?: Tex;
  /** Vertical repeats of the side texture (stacked crates). */
  vRepeat?: number;
  /** Only on the south face. */
  live?: LiveInset;
}

/** A flat textured rectangle on a wall face (signs, displays). */
export interface Panel {
  /** True when the wall runs east-west (constant y). */
  horizontal: boolean;
  /** The constant coordinate of the wall face. */
  plane: number;
  a0: number;
  a1: number;
  z0: number;
  z1: number;
  tex: Tex;
  /** Mirror horizontally, for faces seen looking west or north (so text reads left to right). */
  flip?: boolean;
}

export interface Billboard {
  x: number;
  y: number;
  /** Height of the bottom edge above the floor. */
  z0: number;
  w: number;
  h: number;
  tex: Tex;
}

export const GRID_WALL = 0xffff;

export interface Scene {
  /** Per cell: 0 open, GRID_WALL plain wall, otherwise block index + 1. */
  grid: Uint16Array;
  gw: number;
  gh: number;
  blocks: Block[];
  panels: Panel[];
  wall: Tex;
  /** One texel per world unit, covering the whole world. */
  floor: Tex;
  ceiling: Tex;
  sprites: Billboard[];
}

export interface Camera {
  x: number;
  y: number;
  angle: number;
}

export class Raycaster {
  readonly depth: Float32Array;
  private proj: number;
  private hz: number;
  private colPanels: Panel[] = [];
  // camera of the last frame, for project()
  private cx = 0;
  private cy = 0;
  private dx = 1;
  private dy = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly buf: Uint32Array,
  ) {
    this.depth = new Float32Array(w * h);
    this.proj = w / 2 / FOV_TAN;
    this.hz = h / 2;
  }

  render(scene: Scene, cam: Camera, pulse: boolean) {
    const { w, h, buf, depth, proj, hz } = this;
    const dirX = Math.cos(cam.angle);
    const dirY = Math.sin(cam.angle);
    // y grows southwards on the map, so "right" is the direction rotated by +90 degrees
    const planeX = -dirY * FOV_TAN;
    const planeY = dirX * FOV_TAN;
    this.cx = cam.x;
    this.cy = cam.y;
    this.dx = dirX;
    this.dy = dirY;
    depth.fill(Infinity);

    // --- floor and ceiling, one row at a time
    const floor = scene.floor;
    const ceil = scene.ceiling;
    const cmx = ceil.w - 1;
    const cmy = ceil.h - 1;
    for (let y = 0; y < h; y++) {
      const p = y + 0.5 - hz;
      const isFloor = p > 0;
      const d = isFloor ? (EYE * proj) / p : ((WALL_H - EYE) * proj) / -p;
      const fog = fogOf(d);
      const stepX = (d * 2 * planeX) / w;
      const stepY = (d * 2 * planeY) / w;
      let wx = cam.x + d * (dirX - planeX) + stepX * 0.5;
      let wy = cam.y + d * (dirY - planeY) + stepY * 0.5;
      let i = y * w;
      for (let x = 0; x < w; x++, i++) {
        const ix = Math.floor(wx);
        const iy = Math.floor(wy);
        let c: number;
        if (isFloor) c = ix >= 0 && iy >= 0 && ix < floor.w && iy < floor.h ? floor.px[iy * floor.w + ix] : 0xff000000;
        else c = ceil.px[(iy & cmy) * ceil.w + (ix & cmx)];
        buf[i] = shade(c, fog, 256);
        wx += stepX;
        wy += stepY;
      }
    }

    // --- walls and boxes, one column at a time, front to back
    const { grid, gw, gh, blocks } = scene;
    for (let x = 0; x < w; x++) {
      const camX = (2 * (x + 0.5)) / w - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;
      let mapX = Math.floor(cam.x / CELL);
      let mapY = Math.floor(cam.y / CELL);
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      const stepX = rdx < 0 ? -1 : 1;
      const stepY = rdy < 0 ? -1 : 1;
      const px = cam.x / CELL;
      const py = cam.y / CELL;
      let sideX = rdx < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
      let sideY = rdy < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;

      let curIdx = 0;
      let curH = 0;
      let capStart = 0;
      for (let n = 0; n < MAX_STEPS; n++) {
        let side: number;
        let d: number;
        if (sideX < sideY) {
          d = sideX * CELL;
          sideX += ddx;
          mapX += stepX;
          side = 0;
        } else {
          d = sideY * CELL;
          sideY += ddy;
          mapY += stepY;
          side = 1;
        }
        const idx = mapX < 0 || mapY < 0 || mapX >= gw || mapY >= gh ? GRID_WALL : grid[mapY * gw + mapX];
        if (idx === curIdx) continue;
        if (d < 0.05) d = 0.05;
        if (curH > 0) this.drawCap(x, capStart, d, blocks[curIdx - 1], cam, rdx, rdy);
        const block = idx === 0 || idx === GRID_WALL ? null : blocks[idx - 1];
        const newH = idx === 0 ? 0 : block ? block.h : WALL_H;
        if (newH > curH) {
          const hitX = cam.x + rdx * d;
          const hitY = cam.y + rdy * d;
          this.drawFace(scene, x, d, curH, Math.min(newH, WALL_H), block, side, hitX, hitY, side === 0 ? stepX : stepY, pulse);
        }
        if (newH >= WALL_H) break;
        curIdx = idx;
        curH = newH;
        capStart = d;
      }
    }

    // --- billboards, far to near, clipped per pixel against the depth buffer
    const list: Array<{ s: Billboard; ty: number; tx: number }> = [];
    for (const s of scene.sprites) {
      const rx = s.x - cam.x;
      const ry = s.y - cam.y;
      const ty = rx * dirX + ry * dirY;
      if (ty < 3) continue;
      list.push({ s, ty, tx: rx * -dirY + ry * dirX });
    }
    list.sort((a, b) => b.ty - a.ty);
    for (const { s, ty, tx } of list) {
      const scale = proj / ty;
      const cxs = w / 2 + tx * scale;
      const wp = s.w * scale;
      const hp = s.h * scale;
      const yBot = hz + (EYE - s.z0) * scale;
      const yTop = yBot - hp;
      const x0 = Math.max(0, Math.round(cxs - wp / 2));
      const x1 = Math.min(w, Math.round(cxs + wp / 2));
      const y0 = Math.max(0, Math.round(yTop));
      const y1 = Math.min(h, Math.round(yBot));
      if (x0 >= x1 || y0 >= y1) continue;
      const fog = fogOf(ty);
      const tex = mipFor(s.tex, s.tex.w / wp);
      for (let sx = x0; sx < x1; sx++) {
        const u = Math.min(tex.w - 1, Math.max(0, Math.floor(((sx + 0.5 - (cxs - wp / 2)) / wp) * tex.w)));
        for (let sy = y0; sy < y1; sy++) {
          const i = sy * w + sx;
          if (depth[i] < ty) continue;
          const v = Math.min(tex.h - 1, Math.max(0, Math.floor(((sy + 0.5 - yTop) / hp) * tex.h)));
          const c = tex.px[v * tex.w + u];
          if (c >>> 24 === 0) continue;
          buf[i] = shade(c, fog, 256);
        }
      }
    }
  }

  /** One column of a vertical face between heights zLo and zHi at perpendicular distance d. */
  private drawFace(scene: Scene, x: number, d: number, zLo: number, zHi: number, block: Block | null, side: number, hitX: number, hitY: number, step: number, pulse: boolean) {
    const { w, h, buf, depth, proj, hz } = this;
    const scale = proj / d;
    const y0 = Math.max(0, Math.round(hz + (EYE - zHi) * scale));
    const y1 = Math.min(h, Math.round(hz + (EYE - zLo) * scale));
    if (y0 >= y1) return;
    const along = side === 0 ? hitY : hitX;
    const fog = fogOf(d);
    const lit = side === 0 ? 196 : 256;
    const inv = d / proj;

    if (!block) {
      // plain wall: world-periodic texture, plus any panels mounted on this face
      const tex = scene.wall;
      const u = Math.floor(along) & (tex.w - 1);
      const planeCoord = side === 0 ? hitX : hitY;
      const active = this.colPanels;
      active.length = 0;
      for (const p of scene.panels) {
        if (p.horizontal === (side === 1) && along >= p.a0 && along < p.a1 && Math.abs(planeCoord - p.plane) < 3) active.push(p);
      }
      for (let y = y0; y < y1; y++) {
        const i = y * w + x;
        if (depth[i] < d) continue;
        const z = EYE - (y + 0.5 - hz) * inv;
        let c = 0;
        for (const p of active) {
          if (z >= p.z0 && z < p.z1) {
            const t = mipFor(p.tex, (p.tex.w / (p.a1 - p.a0)) * inv);
            let pu = Math.min(t.w - 1, Math.floor(((along - p.a0) / (p.a1 - p.a0)) * t.w));
            if (p.flip) pu = t.w - 1 - pu;
            const pv = Math.min(t.h - 1, Math.max(0, Math.floor(((p.z1 - z) / (p.z1 - p.z0)) * t.h)));
            c = t.px[pv * t.w + pu];
            if (c >>> 24 !== 0) break;
            c = 0;
          }
        }
        if (c === 0) {
          const v = Math.min(tex.h - 1, Math.max(0, Math.floor(((WALL_H - z) / WALL_H) * tex.h)));
          c = tex.px[v * tex.w + u];
        }
        buf[i] = shade(c, fog, lit);
        depth[i] = d;
      }
      return;
    }

    const tex = pulse && block.sideAlt ? block.sideAlt : block.side;
    const frac = side === 0 ? (hitY - block.y) / block.d : (hitX - block.x) / block.w;
    const tu = Math.min(tex.w - 1, Math.max(0, Math.floor(frac * tex.w)));
    const rep = block.vRepeat ?? 1;
    const bh = Math.min(block.h, WALL_H);
    // the live inset only exists on the south face (hit while travelling north)
    const live = block.live && side === 1 && step < 0 && block.live.src ? block.live : null;
    const liveCol = live && tu >= live.x && tu < live.x + live.w ? Math.min(live.sw - 1, Math.floor(((tu - live.x) / live.w) * live.sw)) : -1;
    // the goal line is compared in texture rows, so it survives the inset being shorter than its source
    const lineTv = live && live.lineRow >= 0 ? live.y + Math.floor((live.lineRow / live.sh) * live.h) : -1;
    for (let y = y0; y < y1; y++) {
      const i = y * w + x;
      if (depth[i] < d) continue;
      const z = EYE - (y + 0.5 - hz) * inv;
      const tvf = ((bh - z) / bh) * rep;
      const tv = Math.min(tex.h - 1, Math.max(0, Math.floor((tvf - Math.floor(tvf)) * tex.h)));
      let c: number;
      if (live && liveCol >= 0 && tv >= live.y && tv < live.y + live.h) {
        const row = Math.min(live.sh - 1, Math.floor(((tv - live.y) / live.h) * live.sh));
        if (tv === lineTv && liveCol % 6 < 4) c = 0xfeb8f1ff;
        else {
          const k = (row * live.sw + liveCol) * 4;
          const src = live.src!;
          c = 0xfe000000 | (src[k + 2] << 16) | (src[k + 1] << 8) | src[k];
        }
      } else c = tex.px[tv * tex.w + tu];
      buf[i] = shade(c, fog, lit);
      depth[i] = d;
    }
  }

  /** The visible top of a low block between two distances along one column. */
  private drawCap(x: number, d0: number, d1: number, block: Block, cam: Camera, rdx: number, rdy: number) {
    if (block.h >= EYE) return;
    const { w, h, buf, depth, proj, hz } = this;
    const k = (EYE - block.h) * proj;
    const y0 = Math.max(0, Math.round(hz + k / d1));
    const y1 = Math.min(h, Math.round(hz + k / Math.max(d0, 0.05)));
    const top = block.top ?? block.side;
    for (let y = y0; y < y1; y++) {
      const i = y * w + x;
      const d = k / (y + 0.5 - hz);
      if (depth[i] < d) continue;
      const wx = cam.x + rdx * d;
      const wy = cam.y + rdy * d;
      const tu = Math.min(top.w - 1, Math.max(0, Math.floor(((wx - block.x) / block.w) * top.w)));
      const tv = Math.min(top.h - 1, Math.max(0, Math.floor(((wy - block.y) / block.d) * top.h)));
      buf[i] = shade(top.px[tv * top.w + tu], fogOf(d), 256);
      depth[i] = d;
    }
  }

  /**
   * Project a world point (z above the floor) with the last frame's camera.
   * Returns frame-buffer coordinates, or null when it is behind the camera,
   * off screen, or hidden by geometry.
   */
  project(wx: number, wy: number, z: number): { x: number; y: number; dist: number } | null {
    const rx = wx - this.cx;
    const ry = wy - this.cy;
    const ty = rx * this.dx + ry * this.dy;
    if (ty < 3) return null;
    const tx = rx * -this.dy + ry * this.dx;
    const scale = this.proj / ty;
    const sx = this.w / 2 + tx * scale;
    const sy = this.hz + (EYE - z) * scale;
    if (sx < 0 || sx >= this.w || sy < -this.h * 0.2 || sy >= this.h) return null;
    const iy = Math.min(this.h - 1, Math.max(0, Math.floor(sy)));
    if (this.depth[iy * this.w + Math.floor(sx)] < ty - 6) return null;
    return { x: sx, y: sy, dist: ty };
  }
}

/** Fog amount 0..256 for a distance in world units. */
function fogOf(d: number): number {
  const f = (d - 24) / 560;
  return f <= 0 ? 0 : f >= 0.84 ? 215 : Math.floor(f * 256);
}

/** Apply side lighting and indigo distance fog to an ABGR pixel. Emissive pixels keep most of their light. */
function shade(c: number, fog: number, lit: number): number {
  let r = c & 255;
  let g = (c >>> 8) & 255;
  let b = (c >>> 16) & 255;
  if (c >>> 24 === 254) {
    fog = fog >> 2;
  } else if (lit !== 256) {
    r = (r * lit) >> 8;
    g = (g * lit) >> 8;
    b = (b * lit) >> 8;
  }
  if (fog > 0) {
    const k = 256 - fog;
    r = (r * k + FOG_R * fog) >> 8;
    g = (g * k + FOG_G * fog) >> 8;
    b = (b * k + FOG_B * fog) >> 8;
  }
  return 0xff000000 | (b << 16) | (g << 8) | r;
}
