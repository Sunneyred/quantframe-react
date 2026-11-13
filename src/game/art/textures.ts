import * as THREE from "three";

/**
 * Every texture in the game is drawn in code, on canvases: no image files. This file holds the
 * shared plumbing (noise, canvases, glyphs, labels); the material surfaces are in surfaces.ts and
 * the art-glass patterns in glass.ts. Material maps come in pairs: a colour map and a "metal/rough" map (G = roughness, B = metalness),
 * the channel layout three.js reads for roughnessMap and metalnessMap.
 */

export const GOLD = "#e8c15a";
export const CYAN = "#2ad4e6";
export const VOID = "#050412";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

export function tex(c: HTMLCanvasElement, color: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise on a grid, smoothed. */
export function noiseField(w: number, h: number, cells: number, seed: number, cellsY = cells): Float32Array {
  const r = rng(seed);
  const cx = cells;
  const g = new Float32Array(cx * cellsY).map(() => r());
  const out = new Float32Array(w * h);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cellsY;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      const a = g[(y0 % cellsY) * cx + (x0 % cx)];
      const b = g[(y0 % cellsY) * cx + ((x0 + 1) % cx)];
      const c = g[((y0 + 1) % cellsY) * cx + (x0 % cx)];
      const d = g[((y0 + 1) % cellsY) * cx + ((x0 + 1) % cx)];
      out[y * w + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

export function fbm(w: number, h: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 0.5;
  for (const [cells, k] of [
    [4, 0],
    [8, 1],
    [16, 2],
    [32, 3],
  ]) {
    const n = noiseField(w, h, cells, seed + k * 97);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    amp *= 0.5;
  }
  return out;
}

export interface MapPair {
  map: THREE.CanvasTexture;
  mr: THREE.CanvasTexture;
}

/** Radial soft shadow, used as a cheap contact shadow under props and figures. */
export function softShadow(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.5, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return tex(c, false, false);
}

/** Small round glow sprite for motes and particles. */
export function glowDot(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return tex(c, false, false);
}

// ---------------------------------------------------------------------------
// The invented glyph script: each glyph is a few strokes on a 3x4 lattice,
// picked deterministically from a seed. Decorative only; it spells nothing.
// ---------------------------------------------------------------------------

export function drawGlyph(ctx: CanvasRenderingContext2D, seed: number, x: number, y: number, size: number) {
  const r = rng(seed * 7919 + 13);
  const pts: Array<[number, number]> = [];
  for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 3; gx++) pts.push([x + (gx / 2) * size * 0.6, y + (gy / 3) * size]);
  const strokes = 2 + Math.floor(r() * 3);
  ctx.beginPath();
  // a spine every glyph shares, so the script reads as one family
  ctx.moveTo(pts[1][0], pts[1][1]);
  ctx.lineTo(pts[10][0], pts[10][1]);
  for (let s = 0; s < strokes; s++) {
    const a = pts[Math.floor(r() * pts.length)];
    const b = pts[Math.floor(r() * pts.length)];
    ctx.moveTo(a[0], a[1]);
    if (r() < 0.4) ctx.quadraticCurveTo(x + size * 0.3, y + size * 0.5, b[0], b[1]);
    else ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
  if (r() < 0.5) {
    const p = pts[Math.floor(r() * pts.length)];
    ctx.beginPath();
    ctx.arc(p[0], p[1], size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A strip of glyphs as a data URL, for decorating DOM screens. */
const stripCache = new Map<string, string>();
export function glyphStripURL(count: number, color: string, height = 24, seed = 1): string {
  const key = `${count}|${color}|${height}|${seed}`;
  const hit = stripCache.get(key);
  if (hit) return hit;
  const size = height * 0.8;
  const step = size * 0.85;
  const [c, ctx] = canvas(Math.ceil(count * step + 8), height);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, height / 14);
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) drawGlyph(ctx, seed * 131 + i, 4 + i * step, (height - size) / 2, size);
  const url = c.toDataURL();
  stripCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Text on canvases (labels, holograms, the ticker)
// ---------------------------------------------------------------------------

export const FONT_DISPLAY = "Orbitron, Rajdhani, sans-serif";
export const FONT_BODY = "Rajdhani, sans-serif";

/** Resolves once the app fonts are usable on canvases (or after a short wait). */
export function fontsReady(): Promise<void> {
  try {
    const f = document.fonts;
    return Promise.race([
      Promise.all([f.load(`600 48px Orbitron`), f.load(`700 48px Rajdhani`), f.load(`600 48px Rajdhani`)]).then(() => undefined),
      new Promise<void>((r) => setTimeout(r, 1500)),
    ]).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

export class CanvasLabel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  constructor(w: number, h: number) {
    [this.canvas, this.ctx] = canvas(w, h);
    this.texture = tex(this.canvas, true, false);
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.save();
    fn(this.ctx, this.canvas.width, this.canvas.height);
    this.ctx.restore();
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}
