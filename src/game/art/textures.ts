import * as THREE from "three";

/**
 * Every texture in the game is drawn here, in code, on canvases: no image files.
 * Material maps come in pairs: a colour map and a "metal/rough" map (G = roughness, B = metalness),
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

function tex(c: HTMLCanvasElement, color: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Tileable value noise on a grid, smoothed. */
function noiseField(w: number, h: number, cells: number, seed: number): Float32Array {
  const r = rng(seed);
  const g = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(w * h);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cells;
    const y0 = Math.floor(fy);
    const ty = sm(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const x0 = Math.floor(fx);
      const tx = sm(fx - x0);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * w + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

function fbm(w: number, h: number, seed: number): Float32Array {
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

/** Paint the noise into a canvas as a soft pearl base colour. */
function pearlBase(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, base: [number, number, number], spread = 14) {
  const img = ctx.createImageData(w, h);
  const n = fbm(w, h, seed);
  const n2 = noiseField(w, h, 6, seed + 11);
  for (let i = 0; i < w * h; i++) {
    const v = (n[i] - 0.47) * spread;
    const tint = (n2[i] - 0.5) * 10; // pearl: cool and warm drifts
    img.data[i * 4] = base[0] + v + tint;
    img.data[i * 4 + 1] = base[1] + v;
    img.data[i * 4 + 2] = base[2] + v - tint;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function metalRoughBase(ctx: CanvasRenderingContext2D, w: number, h: number, rough: number) {
  ctx.fillStyle = `rgb(0, ${Math.round(rough * 255)}, 0)`;
  ctx.fillRect(0, 0, w, h);
}

/** Draws on both the colour and the metal/rough canvas at once. */
type Pen = (ctx: CanvasRenderingContext2D, kind: "color" | "mr") => void;
function both(cc: CanvasRenderingContext2D, mc: CanvasRenderingContext2D, pen: Pen) {
  cc.save();
  pen(cc, "color");
  cc.restore();
  mc.save();
  pen(mc, "mr");
  mc.restore();
}
const goldInk = (kind: "color" | "mr") => (kind === "color" ? GOLD : "rgb(0, 70, 255)");
const seamInk = (kind: "color" | "mr", a = 0.35) => (kind === "color" ? `rgba(120, 104, 84, ${a})` : "rgb(0, 200, 0)");

/** A filigree scroll: a spiral with leaves, the motif used on every gold trim. */
function scroll(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flip: number) {
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const a = flip * (t * Math.PI * 2.6);
    const r = s * (1 - t * 0.82);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

export interface MapPair {
  map: THREE.CanvasTexture;
  mr: THREE.CanvasTexture;
}

/** A 2 m x 2 m pearl wall tile: soft panels, recessed seams, one thin gold inlay line. */
export function pearlPanel(seed = 7): MapPair {
  const S = 512;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  pearlBase(cc, S, S, seed, [214, 207, 192]);
  metalRoughBase(mc, S, S, 0.38);
  both(cc, mc, (ctx, kind) => {
    ctx.strokeStyle = seamInk(kind, 0.55);
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
    ctx.strokeStyle = seamInk(kind, 0.28);
    ctx.lineWidth = 2;
    const r = 26;
    const i0 = 40;
    ctx.beginPath();
    ctx.roundRect(i0, i0, S - i0 * 2, S - i0 * 2, r);
    ctx.stroke();
    ctx.strokeStyle = goldInk(kind);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(i0 + 12, i0 + 12, S - i0 * 2 - 24, S - i0 * 2 - 24, r - 8);
    ctx.stroke();
    // corner scrolls
    ctx.lineWidth = 2;
    for (const [x, y, f] of [
      [i0 + 46, i0 + 46, 1],
      [S - i0 - 46, i0 + 46, -1],
      [i0 + 46, S - i0 - 46, -1],
      [S - i0 - 46, S - i0 - 46, 1],
    ])
      scroll(ctx, x, y, 22, f);
  });
  return { map: tex(c, true), mr: tex(m, false) };
}

/** Repeating gold filigree band (1 tile = 2 m long, 0.25 m tall) on a pale ivory ground. */
export function filigreeBand(seed = 3): MapPair {
  const W = 1024;
  const H = 128;
  const [c, cc] = canvas(W, H);
  const [m, mc] = canvas(W, H);
  pearlBase(cc, W, H, seed, [214, 204, 184], 10);
  metalRoughBase(mc, W, H, 0.45);
  both(cc, mc, (ctx, kind) => {
    ctx.strokeStyle = goldInk(kind);
    ctx.fillStyle = goldInk(kind);
    ctx.fillRect(0, 0, W, 10);
    ctx.fillRect(0, H - 10, W, 10);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H / 2 + Math.sin((x / W) * Math.PI * 8) * 26;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let k = 0; k < 8; k++) {
      const x = (k + 0.5) * (W / 8);
      const up = k % 2 === 0;
      scroll(ctx, x, H / 2 + (up ? -18 : 18), 20, up ? 1 : -1);
      ctx.beginPath();
      ctx.arc(x + W / 16, H / 2, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const pair = { map: tex(c, true), mr: tex(m, false) };
  pair.map.wrapT = pair.mr.wrapT = THREE.ClampToEdgeWrapping;
  return pair;
}

/** The whole vault floor, drawn once (not tiled): rings, radial spokes, a medallion, gold inlay. */
export function vaultFloor(radius: number): MapPair {
  const S = 2048;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  pearlBase(cc, S, S, 41, [104, 94, 90], 18);
  metalRoughBase(mc, S, S, 0.22);
  const px = S / 2 / radius; // pixels per metre
  const ctr = S / 2;
  both(cc, mc, (ctx, kind) => {
    // darker outer walkway ring
    if (kind === "color") {
      const g = ctx.createRadialGradient(ctr, ctr, px * 3, ctr, ctr, px * radius);
      g.addColorStop(0, "rgba(255,250,240,0.10)");
      g.addColorStop(0.55, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(40,30,30,0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    // stone joints: rings and spokes
    ctx.strokeStyle = seamInk(kind, 0.5);
    ctx.lineWidth = 3;
    for (const r of [2.6, 4.4, 6.6, 9, 11.2]) {
      ctx.beginPath();
      ctx.arc(ctr, ctr, r * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r0 = (k % 2 ? 6.6 : 4.4) * px;
      ctx.beginPath();
      ctx.moveTo(ctr + Math.cos(a) * r0, ctr + Math.sin(a) * r0);
      ctx.lineTo(ctr + Math.cos(a) * radius * px, ctr + Math.sin(a) * radius * px);
      ctx.stroke();
    }
    // gold inlay rings around the reservoir and on the walkway
    ctx.strokeStyle = goldInk(kind);
    for (const [r, w] of [
      [2.35, 7],
      [2.5, 2.5],
      [4.25, 3],
      [8.8, 4],
      [9.05, 2],
    ]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(ctr, ctr, r * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the medallion: a twelve-point star of arcs between 2.5 m and 4.25 m
    ctx.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const b = a + Math.PI / 12;
      ctx.beginPath();
      ctx.moveTo(ctr + Math.cos(a) * 2.5 * px, ctr + Math.sin(a) * 2.5 * px);
      ctx.quadraticCurveTo(ctr + Math.cos(b) * 3.0 * px, ctr + Math.sin(b) * 3.0 * px, ctr + Math.cos(b) * 4.25 * px, ctr + Math.sin(b) * 4.25 * px);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ctr + Math.cos(a + Math.PI / 6) * 2.5 * px, ctr + Math.sin(a + Math.PI / 6) * 2.5 * px);
      ctx.quadraticCurveTo(ctr + Math.cos(b) * 3.0 * px, ctr + Math.sin(b) * 3.0 * px, ctr + Math.cos(b) * 4.25 * px, ctr + Math.sin(b) * 4.25 * px);
      ctx.stroke();
    }
    // scrolls between the walkway rings
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 24; k++) {
      const a = ((k + 0.5) / 24) * Math.PI * 2;
      const r = 9.9 * px;
      scroll(ctx, ctr + Math.cos(a) * r, ctr + Math.sin(a) * r, 0.32 * px, k % 2 ? 1 : -1);
    }
  });
  const pair = { map: tex(c, true, false), mr: tex(m, false, false) };
  return pair;
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
