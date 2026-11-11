import type { FluidState } from "./sim";

/**
 * Software renderer for the tank: writes straight into an ImageData at the
 * tank's low internal resolution (about 10k pixels, so this is far cheaper
 * than it sounds and has no shader/WebGPU portability concerns).
 */

type RGB = readonly [number, number, number];

// Depth ramp from the bright meniscus down to deep amber. Banded on purpose for a pixel-art read.
const RAMP: RGB[] = [
  [255, 244, 196],
  [255, 226, 130],
  [240, 200, 96],
  [226, 178, 74],
  [200, 148, 52],
  [168, 116, 36],
  [132, 86, 24],
  [100, 62, 16],
];
const CYAN: RGB = [42, 212, 230];
const CYAN_LIGHT: RGB = [185, 251, 255];
const DROP: RGB = [255, 222, 120];
const DROP_CORE: RGB = [255, 248, 214];

export interface FluidRenderer {
  image: ImageData;
  density: Float32Array;
}

export function createFluidRenderer(image: ImageData): FluidRenderer {
  return { image, density: new Float32Array(image.width * image.height) };
}

const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function renderFluid(r: FluidRenderer, s: FluidState, lowPower: boolean) {
  const { w, h } = s;
  const px = r.image.data;
  const den = r.density;
  den.fill(0);

  // --- splat droplets into a density field; thresholding it merges them (metaballs)
  for (const d of s.droplets) {
    const rad = d.r + 1.6;
    const x0 = Math.max(0, Math.floor(d.x - rad));
    const x1 = Math.min(w - 1, Math.ceil(d.x + rad));
    const y0 = Math.max(0, Math.floor(d.y - rad));
    const y1 = Math.min(h - 1, Math.ceil(d.y + rad));
    const rr = rad * rad;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - d.x;
        const dy = y - d.y;
        const q = 1 - (dx * dx + dy * dy) / rr;
        if (q > 0) den[y * w + x] += q * q;
      }
    }
  }

  const t = s.time;
  for (let x = 0; x < w; x++) {
    const surf = h - s.height[x];
    const surfI = Math.floor(surf);
    // slope gives a specular glint on wave faces
    const slope = s.height[Math.min(w - 1, x + 1)] - s.height[Math.max(0, x - 1)];
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (y >= surfI) {
        const depth = y - surf;
        let c: RGB;
        if (depth < 1) {
          c = slope > 0.6 || slope < -0.6 ? CYAN_LIGHT : RAMP[0];
        } else if (depth < 2.2) {
          c = RAMP[1];
        } else {
          const f = Math.min(1, depth / (h * 0.75));
          const dither = (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;
          const band = Math.min(RAMP.length - 1, Math.max(2, Math.floor(2 + f * (RAMP.length - 2) + dither)));
          c = RAMP[band];
          if (!lowPower || ((x + y) & 1) === 0) {
            // drifting cyan caustic ribbons
            const a = Math.sin(x * 0.21 + t * 1.1 + Math.sin(y * 0.17 + t * 0.7) * 1.8);
            const b = Math.sin(y * 0.24 - t * 0.9 + x * 0.06);
            const k = a * b;
            if (k > 0.85) c = k > 0.95 ? CYAN_LIGHT : CYAN;
            else if (k < -0.9) c = RAMP[Math.max(1, band - 2)];
          }
        }
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = 255;
      } else {
        const dv = den[y * w + x];
        if (dv > 0.34) {
          const c = dv > 0.95 ? DROP_CORE : dv > 0.5 ? DROP : CYAN;
          px[i] = c[0];
          px[i + 1] = c[1];
          px[i + 2] = c[2];
          px[i + 3] = 255;
        } else {
          // empty glass: dark indigo, with a warm glow hovering over the surface
          const above = surf - y;
          const glow = above < 10 ? (1 - above / 10) * 0.55 : 0;
          const shade = 1 - y / h;
          px[i] = 12 + glow * 150 + shade * 6;
          px[i + 1] = 10 + glow * 110 + shade * 4;
          px[i + 2] = 34 + glow * 30 + shade * 14;
          px[i + 3] = 235;
        }
      }
    }
  }

  // --- bubbles: a light pixel with a cyan rim
  for (const b of s.bubbles) {
    const bx = Math.round(b.x);
    const by = Math.round(b.y);
    if (bx < 1 || bx >= w - 1 || by < 1 || by >= h) continue;
    const i = (by * w + bx) * 4;
    px[i] = CYAN_LIGHT[0];
    px[i + 1] = CYAN_LIGHT[1];
    px[i + 2] = CYAN_LIGHT[2];
    const j = ((by - 1) * w + bx) * 4;
    if (px[j + 3] === 255) {
      px[j] = CYAN[0];
      px[j + 1] = CYAN[1];
      px[j + 2] = CYAN[2];
    }
  }
}
