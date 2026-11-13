import * as THREE from "three";
import { canvas, fbm, noiseField, rng, tex, type MapPair } from "./textures";

/**
 * The surface kit of the trading ship, all drawn on canvases: chipped enamel panels, worn brass,
 * tufted leather (with a normal map), walnut, a riveted brass band, the instrument faces
 * (dials, meters, switches), tape reels, the lounge floor and the painted environment the metals
 * and the glass reflect.
 *
 * Colour maps of tintable surfaces are near white on purpose: the material's `color` supplies the
 * candy colour, so every enamel hue shares one pair of maps.
 */

/** The candy palette (sRGB hex), used by materials, floors and the environment painting. */
export const CANDY = {
  teal: 0x18a39b,
  tangerine: 0xdc682a,
  mustard: 0xe2aa2c,
  raspberry: 0xc93a66,
  cream: 0xf1e3c6,
  plum: 0x3a1c3e,
  navy: 0x16264a,
  cobalt: 0x2a57d8,
  oxblood: 0x7c2a22,
  cognac: 0xa5622f,
} as const;

const css = (hex: number, a = 1) => `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${a})`;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Pen = (ctx: CanvasRenderingContext2D, mr: boolean) => void;
function both(cc: CanvasRenderingContext2D, mc: CanvasRenderingContext2D, pen: Pen) {
  cc.save();
  pen(cc, false);
  cc.restore();
  mc.save();
  pen(mc, true);
  mc.restore();
}
/** Metal/rough ink: G = roughness, B = metalness. */
const mrInk = (rough: number, metal: number) => `rgb(0, ${Math.round(rough * 255)}, ${Math.round(metal * 255)})`;

/** An irregular blob (chipped paint, patina spots). */
function blob(ctx: CanvasRenderingContext2D, r: () => number, x: number, y: number, rad: number) {
  const n = 7 + Math.floor(r() * 4);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = rad * (0.55 + r() * 0.6);
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * A 2 m enamel wall panel, near white (tinted by the material): a pressed panel with a soft inset,
 * screws in the corners, and paint chipped along the edges down to primer and bare metal.
 */
export function enamelPanel(seed = 7): MapPair {
  const S = 512;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const n = fbm(S, S, seed);
  const n2 = noiseField(S, S, 48, seed + 5);
  const img = cc.createImageData(S, S);
  const mimg = mc.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 232 + (n[i] - 0.5) * 22 + (n2[i] - 0.5) * 5;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v - 1;
    img.data[i * 4 + 2] = v - 3;
    img.data[i * 4 + 3] = 255;
    mimg.data[i * 4 + 1] = 62 + (n[i] - 0.5) * 60 + (n2[i] - 0.5) * 24; // gloss with an orange-peel wobble
    mimg.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  mc.putImageData(mimg, 0, 0);
  const r = rng(seed * 31 + 3);
  // grime rising from the bottom edge, a faint sun-fade at the top
  const g = cc.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "rgba(255,250,235,0.10)");
  g.addColorStop(0.6, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(50,30,14,0.16)");
  cc.fillStyle = g;
  cc.fillRect(0, 0, S, S);
  both(cc, mc, (ctx, mr) => {
    // the gap between panels
    ctx.strokeStyle = mr ? mrInk(0.85, 0) : "rgba(24, 18, 16, 0.92)";
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, S, S);
    // rolled edge: a light line inside the gap, a soft shadow inside that
    if (!mr) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(5, 5, S - 10, S - 10);
      ctx.strokeStyle = "rgba(0,0,0,0.10)";
      ctx.lineWidth = 3;
      ctx.strokeRect(8.5, 8.5, S - 17, S - 17);
    }
    // the pressed field
    const i0 = 46;
    ctx.lineWidth = 3;
    ctx.strokeStyle = mr ? mrInk(0.5, 0) : "rgba(0,0,0,0.17)";
    ctx.beginPath();
    ctx.roundRect(i0, i0, S - i0 * 2, S - i0 * 2, 30);
    ctx.stroke();
    if (!mr) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(i0 + 2.5, i0 + 2.5, S - i0 * 2 - 5, S - i0 * 2 - 5, 28);
      ctx.stroke();
    }
  });
  // chips: mostly along the edges and near the screws, a few in the field
  for (let k = 0; k < 54; k++) {
    const edge = r() < 0.92;
    let x = r() * S;
    let y = r() * S;
    if (edge) {
      const d = 4 + r() * r() * 26;
      const side = Math.floor(r() * 4);
      if (side === 0) y = d;
      else if (side === 1) y = S - d;
      else if (side === 2) x = d;
      else x = S - d;
    }
    const rad = 2 + r() * r() * (edge ? 10 : 4);
    const k0 = 1 + Math.floor(r() * 1e6);
    cc.fillStyle = "rgba(38, 30, 27, 0.95)";
    mc.fillStyle = mrInk(0.8, 0);
    blob(cc, rng(k0), x, y, rad);
    blob(mc, rng(k0), x, y, rad);
    if (r() < 0.45 && rad > 5) {
      cc.fillStyle = "rgba(150, 146, 140, 0.95)";
      mc.fillStyle = mrInk(0.42, 1);
      blob(cc, rng(k0 + 1), x, y, rad * 0.5);
      blob(mc, rng(k0 + 1), x, y, rad * 0.5);
    }
  }
  // screws
  both(cc, mc, (ctx, mr) => {
    for (const [x, y] of [
      [25, 25],
      [S - 25, 25],
      [25, S - 25],
      [S - 25, S - 25],
    ]) {
      ctx.fillStyle = mr ? mrInk(0.35, 1) : "#c9c2b2";
      ctx.beginPath();
      ctx.arc(x, y, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mr ? mrInk(0.7, 1) : "rgba(40,32,26,0.85)";
      ctx.lineWidth = 2;
      const a = r() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * 5.5, y - Math.sin(a) * 5.5);
      ctx.lineTo(x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5);
      ctx.stroke();
      if (!mr) {
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 8.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });
  return { map: tex(c, true), mr: tex(m, false) };
}

/** Worn brass, tileable: brushed streaks, rubbed-bright patches and a green-brown patina in the lows. */
export function brassWorn(seed = 3): MapPair {
  const S = 512;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const n = fbm(S, S, seed);
  const streak = noiseField(S, S, 5, seed + 9, 160);
  const fine = noiseField(S, S, 96, seed + 17);
  const img = cc.createImageData(S, S);
  const mimg = mc.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const pat = smooth(0.5, 0.3, n[i] + (fine[i] - 0.5) * 0.12);
    const rub = smooth(0.56, 0.74, n[i]);
    const s = (streak[i] - 0.5) * 26;
    let rr = 226 + s + rub * 22;
    let gg = 178 + s + rub * 30;
    let bb = 86 + s * 0.6 + rub * 38;
    rr += (104 - rr) * pat * 0.8;
    gg += (100 - gg) * pat * 0.8;
    bb += (66 - bb) * pat * 0.8;
    img.data[i * 4] = rr;
    img.data[i * 4 + 1] = gg;
    img.data[i * 4 + 2] = bb;
    img.data[i * 4 + 3] = 255;
    mimg.data[i * 4 + 1] = (0.2 + streak[i] * 0.14 + pat * 0.42 - rub * 0.06) * 255;
    mimg.data[i * 4 + 2] = (1 - pat * 0.4) * 255;
    mimg.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  mc.putImageData(mimg, 0, 0);
  return { map: tex(c, true), mr: tex(m, false) };
}

/**
 * Diamond-tufted leather, near white (tinted by the material), tileable: a colour map with pores,
 * creases and worn pillows, a metal/rough map, and a normal map of the pillows, seams, stitches and
 * buttons. One tile is two diamonds wide.
 */
export function leatherTufted(seed = 5): MapPair & { normal: THREE.CanvasTexture } {
  const S = 512;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const [nc, nx] = canvas(S, S);
  const pores = noiseField(S, S, 128, seed);
  const cloud = fbm(S, S, seed + 3);
  const h = new Float32Array(S * S);
  const btn = new Float32Array(S * S);
  const stitch = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const U = (x / S) * 2;
      const V = (y / S) * 2;
      const a = U + V;
      const b = U - V;
      const sa = Math.abs(Math.sin(Math.PI * a));
      const sb = Math.abs(Math.sin(Math.PI * b));
      let hh = Math.pow(sa * sb, 0.42);
      // buttons where the seams cross
      const fa = a - Math.round(a);
      const fb = b - Math.round(b);
      const d = Math.hypot(fa, fb) * 0.7071;
      const bt = smooth(0.062, 0.048, d);
      hh = hh * (1 - bt) + bt * (0.55 + 0.25 * Math.sqrt(Math.max(0, 1 - (d / 0.062) ** 2)));
      // a stitch line just beside each seam
      const da = Math.min(Math.abs(fa), Math.abs(fb));
      const along = (Math.abs(fa) < Math.abs(fb) ? b : a) * 14;
      const st = smooth(0.05, 0.04, da) * smooth(0.024, 0.034, da) * (along - Math.floor(along) < 0.62 ? 1 : 0) * (1 - bt);
      h[y * S + x] = hh + st * 0.05 + (pores[y * S + x] - 0.5) * 0.035;
      btn[y * S + x] = bt;
      stitch[y * S + x] = st;
    }
  }
  const img = cc.createImageData(S, S);
  const mimg = mc.createImageData(S, S);
  const nimg = nx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
      const hy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      const k = 3.4;
      const nxv = -hx * k * S * 0.02;
      const nyv = hy * k * S * 0.02; // canvas y runs down, the normal map's green runs up
      const l = Math.hypot(nxv, nyv, 1);
      nimg.data[i * 4] = (nxv / l) * 127 + 128;
      nimg.data[i * 4 + 1] = (nyv / l) * 127 + 128;
      nimg.data[i * 4 + 2] = (1 / l) * 127 + 128;
      nimg.data[i * 4 + 3] = 255;
      const hh = h[i];
      // creases are darker, the top of each pillow is rubbed lighter
      let v = 150 + smooth(0.0, 0.7, hh) * 62 + smooth(0.75, 1.0, hh) * 22 + (pores[i] - 0.5) * 20 + (cloud[i] - 0.5) * 30;
      v += stitch[i] * 46;
      const b = btn[i];
      img.data[i * 4] = v * (1 - b) + 214 * b;
      img.data[i * 4 + 1] = v * 0.97 * (1 - b) + 176 * b;
      img.data[i * 4 + 2] = v * 0.93 * (1 - b) + 96 * b;
      img.data[i * 4 + 3] = 255;
      mimg.data[i * 4 + 1] = (0.62 - smooth(0.6, 1.0, hh) * 0.2 + (pores[i] - 0.5) * 0.16) * (1 - b) * 255 + b * 0.3 * 255;
      mimg.data[i * 4 + 2] = b * 255;
      mimg.data[i * 4 + 3] = 255;
    }
  }
  cc.putImageData(img, 0, 0);
  mc.putImageData(mimg, 0, 0);
  nx.putImageData(nimg, 0, 0);
  return { map: tex(c, true), mr: tex(m, false), normal: tex(nc, false) };
}

/** Walnut planks, tileable: grain along v, four planks to a tile. */
export function walnut(seed = 11): MapPair {
  const S = 512;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const warp = fbm(S, S, seed);
  const grain = noiseField(S, S, 200, seed + 2, 6);
  const img = cc.createImageData(S, S);
  const mimg = mc.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const plank = Math.floor((x / S) * 4);
      const pu = (x / S) * 4 - plank;
      const tone = ((plank * 37) % 5) / 5;
      const ring = 0.5 + 0.5 * Math.sin((pu * 5 + warp[(y * S + ((x + plank * 97) % S)) | 0] * 4.2 + plank * 1.7) * Math.PI * 2);
      const t = ring * 0.55 + grain[i] * 0.45;
      const seam = smooth(0.03, 0.0, Math.min(pu, 1 - pu));
      const k = (0.8 + tone * 0.3) * (1 - seam * 0.65);
      img.data[i * 4] = (72 + t * 74) * k;
      img.data[i * 4 + 1] = (42 + t * 46) * k;
      img.data[i * 4 + 2] = (24 + t * 24) * k;
      img.data[i * 4 + 3] = 255;
      mimg.data[i * 4 + 1] = (0.36 + (1 - t) * 0.2 + seam * 0.3) * 255;
      mimg.data[i * 4 + 3] = 255;
    }
  }
  cc.putImageData(img, 0, 0);
  mc.putImageData(mimg, 0, 0);
  return { map: tex(c, true), mr: tex(m, false) };
}

/** A riveted brass trim band (1 tile = 2 m long, 0.25 m tall): grooves, rivets and a row of vent slots. */
export function brassBand(seed = 3): MapPair {
  const W = 1024;
  const H = 128;
  const [c, cc] = canvas(W, H);
  const [m, mc] = canvas(W, H);
  const n = fbm(W, W, seed);
  const streak = noiseField(W, H, 6, seed + 4, 60);
  const img = cc.createImageData(W, H);
  const mimg = mc.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const pat = smooth(0.5, 0.32, n[y * 4 * W + x]);
      const s = (streak[i] - 0.5) * 24;
      img.data[i * 4] = (214 + s) * (1 - pat * 0.5);
      img.data[i * 4 + 1] = (166 + s) * (1 - pat * 0.42);
      img.data[i * 4 + 2] = (78 + s * 0.5) * (1 - pat * 0.25);
      img.data[i * 4 + 3] = 255;
      mimg.data[i * 4 + 1] = (0.26 + streak[i] * 0.12 + pat * 0.4) * 255;
      mimg.data[i * 4 + 2] = (1 - pat * 0.35) * 255;
      mimg.data[i * 4 + 3] = 255;
    }
  cc.putImageData(img, 0, 0);
  mc.putImageData(mimg, 0, 0);
  both(cc, mc, (ctx, mr) => {
    // rolled beads top and bottom
    for (const y of [0, H - 12]) {
      const g = ctx.createLinearGradient(0, y, 0, y + 12);
      if (mr) {
        g.addColorStop(0, mrInk(0.3, 1));
        g.addColorStop(1, mrInk(0.3, 1));
      } else {
        g.addColorStop(0, "rgba(90,60,20,0.55)");
        g.addColorStop(0.45, "rgba(255,236,170,0.6)");
        g.addColorStop(1, "rgba(70,44,14,0.6)");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, 12);
    }
    // vent slots between rivets
    for (let k = 0; k < 8; k++) {
      const x0 = k * 128;
      ctx.fillStyle = mr ? mrInk(0.28, 1) : "#f1d590";
      ctx.beginPath();
      ctx.arc(x0 + 14, H / 2, 6, 0, Math.PI * 2);
      ctx.fill();
      if (!mr) {
        ctx.strokeStyle = "rgba(60,36,10,0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = mr ? mrInk(0.9, 0.2) : "rgba(26,16,8,0.9)";
        ctx.beginPath();
        ctx.roundRect(x0 + 36 + j * 21, 34, 9, H - 68, 4.5);
        ctx.fill();
        if (!mr) {
          ctx.strokeStyle = "rgba(255,232,160,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  });
  const pair = { map: tex(c, true), mr: tex(m, false) };
  pair.map.wrapT = pair.mr.wrapT = THREE.ClampToEdgeWrapping;
  return pair;
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export interface DialSpot {
  /** Centre in panel units: x in -0.5..0.5 of the width, y in -0.5..0.5 of the height (up). */
  x: number;
  y: number;
  /** Needle length as a fraction of the panel height. */
  len: number;
  /** Needle sweep: centre angle and half range (radians, 0 = up, positive = clockwise). */
  mid: number;
  range: number;
}

/** Where the needles sit on `instrumentFace` (the texture draws the faces, meshes draw the needles). */
export const INSTRUMENT_DIALS: DialSpot[] = [
  { x: -0.33, y: 0.03, len: 0.3, mid: 0, range: 1.9 },
  { x: -0.045, y: 0.115, len: 0.2, mid: 0, range: 1.7 },
  { x: 0.31, y: -0.03, len: 0.3, mid: 0, range: 0.75 },
];

/**
 * The face of an instrument cluster (2:1): a bakelite panel with a brass edge, two round dials,
 * a VU meter, jewel lamps and a row of toggle switches. Needles are separate meshes (see props.ts).
 * Returns the colour map and an emissive map (the back-lit faces and the lamps).
 */
export function instrumentFace(seed = 1): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const [e, ex] = canvas(W, H);
  const r = rng(seed * 77 + 5);
  ex.fillStyle = "#000";
  ex.fillRect(0, 0, W, H);
  // bakelite
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#3a241a");
  g.addColorStop(1, "#22130e");
  ctx.fillStyle = "#b8904a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(7, 7, W - 14, H - 14, 18);
  ctx.fill();
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(${90 + r() * 60}, ${50 + r() * 30}, ${30 + r() * 20}, 0.10)`;
    ctx.fillRect(10 + r() * (W - 20), 10 + r() * (H - 20), 1 + r() * 26, 1);
  }
  const face = (cx: number, cy: number, rad: number, zone: [number, number], col: string) => {
    for (const k of [ctx, ex]) {
      const lit = k === ex;
      // brass bezel
      if (!lit) {
        const bz = k.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
        bz.addColorStop(0, "#f6dc9a");
        bz.addColorStop(0.5, "#a8782c");
        bz.addColorStop(1, "#e2bd68");
        k.fillStyle = bz;
        k.beginPath();
        k.arc(cx, cy, rad + 7, 0, Math.PI * 2);
        k.fill();
      }
      const fg = k.createRadialGradient(cx, cy + rad * 0.2, rad * 0.1, cx, cy, rad);
      fg.addColorStop(0, lit ? "#b98a48" : "#f6ecd2");
      fg.addColorStop(1, lit ? "#5e3a14" : "#d9c9a2");
      k.fillStyle = fg;
      k.beginPath();
      k.arc(cx, cy, rad, 0, Math.PI * 2);
      k.fill();
      // coloured zone arc and ticks
      k.strokeStyle = lit ? "#7a2a12" : col;
      k.lineWidth = rad * 0.11;
      k.beginPath();
      k.arc(cx, cy, rad * 0.8, -Math.PI / 2 + zone[0], -Math.PI / 2 + zone[1]);
      k.stroke();
      k.strokeStyle = lit ? "#1a0e04" : "#2a1d14";
      for (let i = 0; i <= 20; i++) {
        const a = -Math.PI / 2 - 1.9 + (i / 20) * 3.8;
        const long = i % 5 === 0;
        k.lineWidth = long ? 2.4 : 1.2;
        k.beginPath();
        k.moveTo(cx + Math.cos(a) * rad * 0.92, cy + Math.sin(a) * rad * 0.92);
        k.lineTo(cx + Math.cos(a) * rad * (long ? 0.68 : 0.8), cy + Math.sin(a) * rad * (long ? 0.68 : 0.8));
        k.stroke();
      }
      // hub
      k.fillStyle = lit ? "#000" : "#2a1d14";
      k.beginPath();
      k.arc(cx, cy, rad * 0.12, 0, Math.PI * 2);
      k.fill();
    }
  };
  const d0 = INSTRUMENT_DIALS[0];
  face(W * (0.5 + d0.x), H * (0.5 - d0.y), 66, [0.9, 1.9], "#d2452e");
  const d1 = INSTRUMENT_DIALS[1];
  face(W * (0.5 + d1.x), H * (0.5 - d1.y), 40, [-1.9, -1.0], "#1c9b93");
  // VU meter: a wide window, needle pivot below the visible arc
  const d2 = INSTRUMENT_DIALS[2];
  const vx = W * (0.5 + d2.x);
  const vy = H * (0.5 - d2.y);
  for (const k of [ctx, ex]) {
    const lit = k === ex;
    if (!lit) {
      k.fillStyle = "#c79a4c";
      k.beginPath();
      k.roundRect(vx - 86, vy - 92, 172, 112, 10);
      k.fill();
    }
    const fg = k.createLinearGradient(0, vy - 86, 0, vy + 14);
    fg.addColorStop(0, lit ? "#c9953f" : "#f8ecc8");
    fg.addColorStop(1, lit ? "#7c4a12" : "#e6cf98");
    k.fillStyle = fg;
    k.beginPath();
    k.roundRect(vx - 80, vy - 86, 160, 100, 6);
    k.fill();
    k.save();
    k.beginPath();
    k.rect(vx - 80, vy - 86, 160, 100);
    k.clip();
    k.lineWidth = 3;
    k.strokeStyle = lit ? "#1a0e04" : "#2a1d14";
    k.beginPath();
    k.arc(vx, vy, 66, -Math.PI / 2 - 0.75, -Math.PI / 2 + 0.3);
    k.stroke();
    k.strokeStyle = lit ? "#8a2410" : "#d2452e";
    k.lineWidth = 6;
    k.beginPath();
    k.arc(vx, vy, 66, -Math.PI / 2 + 0.3, -Math.PI / 2 + 0.75);
    k.stroke();
    k.lineWidth = 1.6;
    k.strokeStyle = lit ? "#1a0e04" : "#2a1d14";
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 - 0.75 + (i / 10) * 1.5;
      k.beginPath();
      k.moveTo(vx + Math.cos(a) * 70, vy + Math.sin(a) * 70);
      k.lineTo(vx + Math.cos(a) * (i % 5 === 0 ? 84 : 78), vy + Math.sin(a) * (i % 5 === 0 ? 84 : 78));
      k.stroke();
    }
    k.restore();
  }
  // jewel lamps and toggles along the bottom of the middle
  const lamps = ["#ff5a3c", "#ffc24a", "#3fe0b0"];
  lamps.forEach((col, i) => {
    const x = W * 0.385 + i * 30;
    const y = H * 0.66;
    for (const k of [ctx, ex]) {
      const on = (seed + i) % 3 !== 0;
      if (k === ctx) {
        k.fillStyle = "#c79a4c";
        k.beginPath();
        k.arc(x, y, 10, 0, Math.PI * 2);
        k.fill();
      }
      const lg = k.createRadialGradient(x - 2, y - 2, 1, x, y, 8);
      lg.addColorStop(0, on || k === ctx ? "#ffffff" : "#000");
      lg.addColorStop(0.35, on || k === ctx ? col : "#000");
      lg.addColorStop(1, on ? col : "#111");
      k.fillStyle = lg;
      k.beginPath();
      k.arc(x, y, 7, 0, Math.PI * 2);
      k.fill();
    }
  });
  for (let i = 0; i < 4; i++) {
    const x = W * 0.375 + i * 26;
    const y = H * 0.84;
    ctx.fillStyle = "#c79a4c";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ece6da";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    const up = (seed * 3 + i) % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (up ? 2 : -2), y + (up ? -13 : 11));
    ctx.stroke();
  }
  const map = tex(c, true, false);
  const glow = tex(e, true, false);
  return { map, glow };
}

/** A tape reel seen face on: a spoked aluminium flange over dark tape. Transparent outside the rim. */
export function tapeReel(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const m = S / 2;
  ctx.fillStyle = "#2a1a12";
  ctx.beginPath();
  ctx.arc(m, m, m - 22, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(120, 78, 50, ${0.1 + (i % 3) * 0.06})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(m, m, 34 + i * 2.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, "#f2f0ea");
  g.addColorStop(0.5, "#9c9a96");
  g.addColorStop(1, "#e4e2dc");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(m, m, m - 3, 0, Math.PI * 2);
  ctx.arc(m, m, 30, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
  // three windows cut through the flange
  ctx.globalCompositeOperation = "destination-out";
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(m, m, m - 20, a + 0.32, a + Math.PI * 2 / 3 - 0.32);
    ctx.arc(m, m, 46, a + Math.PI * 2 / 3 - 0.5, a + 0.5, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#2a1a12";
  ctx.beginPath();
  ctx.arc(m, m, m - 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#d8b25c";
  ctx.beginPath();
  ctx.arc(m, m, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a2616";
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    ctx.beginPath();
    ctx.arc(m + Math.cos(a) * 11, m + Math.sin(a) * 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, true, false);
}

// ---------------------------------------------------------------------------
// Floors (drawn once, not tiled) with the room's light baked in
// ---------------------------------------------------------------------------

/**
 * The lounge floor of the Vault: a ring of millefiori terrazzo around the reservoir, a round
 * sunburst rug, brass inlay rings and a studded rubber walkway. The light of the room is baked in:
 * a warm pool under the chandelier, contact shade around the pedestal and along the walls.
 */
export function loungeFloor(radius: number): MapPair {
  const S = 2048;
  const [c, cc] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const px = S / 2 / radius;
  const ctr = S / 2;
  const r = rng(977);
  const ring = (ctx: CanvasRenderingContext2D, r0: number, r1: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(ctr, ctr, r1 * px, 0, Math.PI * 2);
    ctx.arc(ctr, ctr, r0 * px, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  };
  // --- walkway: studded rubber
  cc.fillStyle = "#1d2a33";
  cc.fillRect(0, 0, S, S);
  mc.fillStyle = mrInk(0.62, 0);
  mc.fillRect(0, 0, S, S);
  both(cc, mc, (ctx, mr) => {
    for (let ringK = 0; ringK < 9; ringK++) {
      const rr = 9.3 + ringK * 0.36;
      const n = Math.round((rr * Math.PI * 2) / 0.36);
      for (let k = 0; k < n; k++) {
        const a = ((k + (ringK % 2) * 0.5) / n) * Math.PI * 2;
        const x = ctr + Math.cos(a) * rr * px;
        const y = ctr + Math.sin(a) * rr * px;
        if (mr) {
          ctx.fillStyle = mrInk(0.42, 0);
          ctx.beginPath();
          ctx.arc(x, y, 0.085 * px, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 0.095 * px);
          g.addColorStop(0, "rgba(96, 122, 138, 0.9)");
          g.addColorStop(0.7, "rgba(40, 56, 68, 0.9)");
          g.addColorStop(1, "rgba(8, 12, 16, 0.6)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 0.095 * px, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  // scuffs where people walk
  for (let i = 0; i < 700; i++) {
    const a = r() * Math.PI * 2;
    const rr = 9.2 + r() * 2.6;
    cc.strokeStyle = `rgba(150, 170, 180, ${0.02 + r() * 0.04})`;
    cc.lineWidth = 1 + r() * 2;
    cc.beginPath();
    cc.arc(ctr, ctr, rr * px, a, a + 0.02 + r() * 0.08);
    cc.stroke();
  }
  // --- the rug: concentric bands and a sunburst of rounded petals
  const bands: Array<[number, number, number]> = [
    [4.5, 4.66, CANDY.cream],
    [4.66, 5.3, 0x3a1c3e],
    [5.3, 5.42, CANDY.mustard],
    [5.42, 8.0, 0x7a2c26],
    [8.0, 8.12, CANDY.mustard],
    [8.12, 8.62, 0x3a1c3e],
    [8.62, 8.75, CANDY.cream],
  ];
  for (const [r0, r1, col] of bands) ring(cc, r0, r1, css(col));
  ring(mc, 4.5, 8.75, mrInk(0.96, 0));
  // petals: 16 rounded arches rising from the inner band, tone on tone with a mustard outline
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    cc.save();
    cc.translate(ctr, ctr);
    cc.rotate(a);
    for (const [w, r0, r1, col] of [
      [0.9, 5.42, 7.75, CANDY.mustard],
      [0.83, 5.42, 7.68, 0xb4502a],
      [0.5, 5.42, 7.2, 0x8f2c48],
      [0.2, 5.42, 6.7, CANDY.cream],
      [0.13, 5.42, 6.63, 0x8f2c48],
    ] as Array<[number, number, number, number]>) {
      cc.fillStyle = css(col);
      cc.beginPath();
      cc.moveTo(r0 * px, -w * px);
      cc.lineTo((r1 - w) * px, -w * px);
      cc.arc((r1 - w) * px, 0, w * px, -Math.PI / 2, Math.PI / 2);
      cc.lineTo(r0 * px, w * px);
      cc.closePath();
      cc.fill();
    }
    cc.restore();
  }
  // pile: fine speckle over the rug
  const pile = cc.getImageData(0, 0, S, S);
  const pn = noiseField(512, 512, 128, 53);
  const pn2 = fbm(512, 512, 71);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - ctr, y - ctr) / px;
      if (d < 4.5 || d > 8.75) continue;
      const i = (y * S + x) * 4;
      const ni = (y & 511) * 512 + (x & 511);
      const k = 0.84 + pn[ni] * 0.22 + (pn2[((y >> 2) & 511) * 512 + ((x >> 2) & 511)] - 0.5) * 0.18;
      pile.data[i] *= k;
      pile.data[i + 1] *= k;
      pile.data[i + 2] *= k;
    }
  cc.putImageData(pile, 0, 0);
  // --- terrazzo with millefiori chips around the reservoir
  ring(cc, 0, 4.5, "#2a2030");
  ring(mc, 0, 4.5, mrInk(0.16, 0));
  const chips = [CANDY.tangerine, CANDY.mustard, CANDY.teal, CANDY.raspberry, CANDY.cream, CANDY.cobalt];
  for (let i = 0; i < 1100; i++) {
    const a = r() * Math.PI * 2;
    const rr = 2.3 + Math.sqrt(r()) * 2.15;
    const x = ctr + Math.cos(a) * rr * px;
    const y = ctr + Math.sin(a) * rr * px;
    const s = (0.012 + r() * r() * 0.04) * px;
    const col = chips[Math.floor(r() * chips.length)];
    cc.fillStyle = css(col, 0.78);
    cc.beginPath();
    cc.arc(x, y, s, 0, Math.PI * 2);
    cc.fill();
    if (s > 3.2) {
      cc.fillStyle = css(chips[Math.floor(r() * chips.length)], 0.95);
      cc.beginPath();
      cc.arc(x, y, s * 0.55, 0, Math.PI * 2);
      cc.fill();
      cc.fillStyle = "rgba(255,250,235,0.9)";
      cc.beginPath();
      cc.arc(x, y, s * 0.2, 0, Math.PI * 2);
      cc.fill();
    }
  }
  // --- brass inlays
  both(cc, mc, (ctx, mr) => {
    ctx.strokeStyle = mr ? mrInk(0.3, 1) : "#d9b05a";
    for (const [rr, w] of [
      [2.32, 9],
      [2.52, 3],
      [4.5, 7],
      [8.75, 7],
      [9.02, 3],
      [12.2, 5],
    ]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(ctr, ctr, rr * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    // twelve short rays in the terrazzo
    ctx.lineWidth = 3;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ctr + Math.cos(a) * 2.6 * px, ctr + Math.sin(a) * 2.6 * px);
      ctx.lineTo(ctr + Math.cos(a) * (k % 2 ? 3.3 : 4.42) * px, ctr + Math.sin(a) * (k % 2 ? 3.3 : 4.42) * px);
      ctx.stroke();
    }
  });
  // --- baked light
  cc.globalCompositeOperation = "multiply";
  const shade = cc.createRadialGradient(ctr, ctr, 0, ctr, ctr, radius * px);
  shade.addColorStop(0, "#5a4c44");
  shade.addColorStop(0.16, "#6a5a4e");
  shade.addColorStop(0.24, "#bdb1a3");
  shade.addColorStop(0.62, "#b4a898");
  shade.addColorStop(0.86, "#9c8e8a");
  shade.addColorStop(0.95, "#6c6068");
  shade.addColorStop(1, "#3a3440");
  cc.fillStyle = shade;
  cc.fillRect(0, 0, S, S);
  cc.globalCompositeOperation = "source-over";
  return { map: tex(c, true, false), mr: tex(m, false, false) };
}

/**
 * The painted environment (equirectangular) that the metals and the glass reflect and that lights
 * the room softly from every side: a dark padded ceiling with the chandelier's glow, candy-coloured
 * panels between bright brass uprights, windows onto deep space, and the rug's warm bounce below.
 */
export function loungeEnvironment(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#f7d69a");
  g.addColorStop(0.07, "#8a5a3a");
  g.addColorStop(0.2, "#2c1630");
  g.addColorStop(0.36, "#3a2230");
  g.addColorStop(0.5, "#40302c");
  g.addColorStop(0.62, "#1c1820");
  g.addColorStop(0.8, "#5a3018");
  g.addColorStop(1, "#8a4a1c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const cols = [CANDY.teal, CANDY.cream, CANDY.tangerine, CANDY.cream, CANDY.mustard, -1, CANDY.teal, CANDY.cream, CANDY.raspberry, -1, CANDY.cream, CANDY.tangerine];
  const sw = W / cols.length;
  cols.forEach((col, i) => {
    const x = i * sw;
    if (col < 0) {
      // a window: deep space with a nebula and stars
      const wg = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.56);
      wg.addColorStop(0, "#1a0b3a");
      wg.addColorStop(0.5, "#5a1e7a");
      wg.addColorStop(1, "#0a2a4a");
      ctx.fillStyle = wg;
      ctx.beginPath();
      ctx.roundRect(x + 10, H * 0.3, sw - 20, H * 0.26, [sw * 0.4, sw * 0.4, 0, 0]);
      ctx.fill();
      for (let k = 0; k < 14; k++) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillRect(x + 14 + ((k * 37) % (sw - 28)), H * 0.31 + ((k * 53) % (H * 0.23)), 2, 2);
      }
    } else {
      const pg = ctx.createLinearGradient(0, H * 0.27, 0, H * 0.56);
      pg.addColorStop(0, css(col, 0.55));
      pg.addColorStop(0.4, css(col, 0.95));
      pg.addColorStop(1, css(col, 0.6));
      ctx.fillStyle = pg;
      ctx.fillRect(x + 6, H * 0.27, sw - 12, H * 0.29);
    }
    // leather wainscot, brass upright with a sconce
    ctx.fillStyle = "#4a1814";
    ctx.fillRect(x, H * 0.56, sw, H * 0.05);
    const bg = ctx.createLinearGradient(x - 5, 0, x + 5, 0);
    bg.addColorStop(0, "#6a4a1a");
    bg.addColorStop(0.5, "#ffe7a6");
    bg.addColorStop(1, "#6a4a1a");
    ctx.fillStyle = bg;
    ctx.fillRect(x - 5, H * 0.22, 10, H * 0.39);
    const sg = ctx.createRadialGradient(x, H * 0.38, 0, x, H * 0.38, 26);
    sg.addColorStop(0, "rgba(255,244,214,1)");
    sg.addColorStop(0.3, "rgba(255,196,110,0.8)");
    sg.addColorStop(1, "rgba(255,160,60,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(x - 26, H * 0.38 - 26, 52, 52);
  });
  // the chandelier's corona high up, in glass colours
  for (let k = 0; k < 16; k++) {
    const x = (k + 0.5) * (W / 16);
    const col = [0xffc46a, 0x58e0d4, 0xff7a9c, 0xffe9b8][k % 4];
    const sg = ctx.createRadialGradient(x, H * 0.13, 0, x, H * 0.13, 22);
    sg.addColorStop(0, "rgba(255,255,255,1)");
    sg.addColorStop(0.3, css(col, 0.9));
    sg.addColorStop(1, css(col, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(x - 22, H * 0.13 - 22, 44, 44);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** A vertical shade gradient (dark at both ends, clear in the middle) for the walls' baked occlusion. */
export function wallShade(): THREE.CanvasTexture {
  const [c, ctx] = canvas(4, 128);
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(0.16, "rgba(0,0,0,0.22)");
  g.addColorStop(0.34, "rgba(0,0,0,0)");
  g.addColorStop(0.72, "rgba(0,0,0,0)");
  g.addColorStop(0.9, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  return tex(c, false, false);
}
