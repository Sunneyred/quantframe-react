/**
 * Cheap 2D liquid for the vault tank.
 *
 * The body of liquid is a height field: one spring-coupled column per pixel
 * (the classic "2D water" model), which gives waves, sloshing and splashes.
 * Anything airborne (the pour from the pipe, splash droplets) is a particle
 * that is absorbed into the surface on contact and kicks the columns it lands
 * on. The renderer merges particles with a metaball threshold so the pour
 * reads as one stream. Pure data + functions; no DOM or Pixi.
 */

export interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Splash droplets cannot spawn further splashes. */
  splash: boolean;
}

export interface Bubble {
  x: number;
  y: number;
  vy: number;
  phase: number;
}

export interface FluidState {
  w: number;
  h: number;
  /** Liquid height per column, pixels from the tank floor. */
  height: Float32Array;
  vel: Float32Array;
  /** Rest height the columns spring toward, in pixels. */
  target: number;
  droplets: Droplet[];
  bubbles: Bubble[];
  /** Droplets still to pour, and pour rate per second. */
  pourLeft: number;
  pourRate: number;
  pourCarry: number;
  /** X of the inlet pipe, in pixels. */
  inletX: number;
  time: number;
  acc: number;
  maxDroplets: number;
  maxBubbles: number;
  seed: number;
}

const STEP = 1 / 60;
const TENSION = 0.018;
const DAMPING = 0.018;
const SPREAD = 0.2;
const GRAVITY = 260;

// scratch buffers for the spread pass
let left = new Float32Array(0);
let right = new Float32Array(0);

export function createFluid(w: number, h: number, fill: number): FluidState {
  const target = fill * h;
  return {
    w,
    h,
    height: new Float32Array(w).fill(target),
    vel: new Float32Array(w),
    target,
    droplets: [],
    bubbles: [],
    pourLeft: 0,
    pourRate: 0,
    pourCarry: 0,
    inletX: w / 2,
    time: 0,
    acc: 0,
    maxDroplets: 420,
    maxBubbles: 14,
    seed: 1234567,
  };
}

/** Deterministic PRNG so the sim is testable. */
export function rand(s: FluidState): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

export function setFill(s: FluidState, fill: number) {
  s.target = Math.min(s.h - 2, Math.max(1, fill * s.h));
}

/** Tilt the whole surface: one side up, the other down. */
export function slosh(s: FluidState, strength: number) {
  for (let i = 0; i < s.w; i++) s.vel[i] += strength * ((i / (s.w - 1)) * 2 - 1);
}

/** Local push on the surface around xFrac (0..1). Positive pushes the surface up. */
export function disturb(s: FluidState, xFrac: number, strength: number, radius = 9) {
  const cx = xFrac * (s.w - 1);
  const lo = Math.max(0, Math.floor(cx - radius * 2));
  const hi = Math.min(s.w - 1, Math.ceil(cx + radius * 2));
  for (let i = lo; i <= hi; i++) {
    const d = (i - cx) / radius;
    s.vel[i] += strength * Math.exp(-d * d);
  }
}

export function startPour(s: FluidState, particles: number, duration: number) {
  s.pourLeft += particles;
  s.pourRate = Math.max(s.pourRate, s.pourLeft / Math.max(0.2, duration));
}

export const isPouring = (s: FluidState) => s.pourLeft > 0;

function stepOnce(s: FluidState) {
  const { w, h, height, vel } = s;
  if (left.length < w) {
    left = new Float32Array(w);
    right = new Float32Array(w);
  }
  s.time += STEP;

  // --- surface springs (velocities are px/s; constants are the usual per-frame ones at 60 Hz)
  for (let i = 0; i < w; i++) {
    vel[i] += TENSION * (s.target - height[i]) * 60;
    vel[i] *= 1 - DAMPING;
    height[i] += vel[i] * STEP;
  }
  // --- neighbour spread: each column drags its neighbours toward its own height
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < w; i++) {
      left[i] = i > 0 ? SPREAD * (height[i] - height[i - 1]) : 0;
      right[i] = i < w - 1 ? SPREAD * (height[i] - height[i + 1]) : 0;
    }
    for (let i = 0; i < w; i++) {
      if (i > 0) {
        vel[i - 1] += left[i] * 60;
        height[i - 1] += left[i];
      }
      if (i < w - 1) {
        vel[i + 1] += right[i] * 60;
        height[i + 1] += right[i];
      }
    }
  }
  for (let i = 0; i < w; i++) {
    if (height[i] < 0.5) {
      height[i] = 0.5;
      vel[i] = Math.abs(vel[i]) * 0.3;
    } else if (height[i] > h - 1) {
      height[i] = h - 1;
      vel[i] = -Math.abs(vel[i]) * 0.3;
    }
  }

  // --- pour from the inlet
  if (s.pourLeft > 0) {
    s.pourCarry += s.pourRate * STEP;
    while (s.pourCarry >= 1 && s.pourLeft > 0) {
      s.pourCarry -= 1;
      s.pourLeft -= 1;
      if (s.droplets.length < s.maxDroplets) {
        s.droplets.push({
          x: s.inletX + (rand(s) - 0.5) * 6,
          y: 1 + rand(s) * 3,
          vx: (rand(s) - 0.5) * 14,
          vy: 50 + rand(s) * 40,
          r: 2.2 + rand(s) * 1.4,
          splash: false,
        });
      }
    }
    if (s.pourLeft <= 0) {
      s.pourLeft = 0;
      s.pourRate = 0;
      s.pourCarry = 0;
    }
  }

  // --- droplets
  const ds = s.droplets;
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i];
    d.vy += GRAVITY * STEP;
    d.x += d.vx * STEP;
    d.y += d.vy * STEP;
    if (d.x < 1) {
      d.x = 1;
      d.vx = Math.abs(d.vx) * 0.4;
    } else if (d.x > w - 2) {
      d.x = w - 2;
      d.vx = -Math.abs(d.vx) * 0.4;
    }
    const col = Math.min(w - 1, Math.max(0, Math.round(d.x)));
    const surfaceY = h - height[col];
    if (d.y >= surfaceY && d.vy > 0) {
      // absorbed: push the surface down where it lands so a ring wave spreads out
      const impact = Math.min(60, d.vy * 0.09) * (d.r / 3);
      disturb(s, col / (w - 1), -impact, 3);
      if (!d.splash && ds.length < s.maxDroplets && rand(s) < 0.35) {
        ds.push({
          x: d.x + (rand(s) - 0.5) * 4,
          y: surfaceY - 1,
          vx: (rand(s) - 0.5) * 70,
          vy: -(40 + rand(s) * 60),
          r: 1.2 + rand(s) * 0.8,
          splash: true,
        });
      }
      ds[i] = ds[ds.length - 1];
      ds.pop();
    } else if (d.y > h + 4) {
      ds[i] = ds[ds.length - 1];
      ds.pop();
    }
  }

  // --- bubbles drifting up through the liquid
  if (s.bubbles.length < s.maxBubbles && rand(s) < 0.06) {
    s.bubbles.push({ x: 3 + rand(s) * (w - 6), y: h - 1, vy: 8 + rand(s) * 12, phase: rand(s) * 6.28 });
  }
  for (let i = s.bubbles.length - 1; i >= 0; i--) {
    const b = s.bubbles[i];
    b.y -= b.vy * STEP;
    b.x += Math.sin(s.time * 3 + b.phase) * 6 * STEP;
    const col = Math.min(w - 1, Math.max(0, Math.round(b.x)));
    if (b.y <= h - height[col] + 1) {
      vel[col] += 5;
      s.bubbles[i] = s.bubbles[s.bubbles.length - 1];
      s.bubbles.pop();
    }
  }
}

/** Advance by dt seconds using fixed 60 Hz substeps (max 4 per call). */
export function stepFluid(s: FluidState, dt: number) {
  s.acc += Math.min(dt, 0.1);
  let n = 0;
  while (s.acc >= STEP && n < 4) {
    stepOnce(s);
    s.acc -= STEP;
    n++;
  }
  if (n === 4) s.acc = 0;
}

/** Mean surface height as a fraction of the tank (for labels and glow). */
export function meanFill(s: FluidState): number {
  let sum = 0;
  for (let i = 0; i < s.w; i++) sum += s.height[i];
  return sum / s.w / s.h;
}

/** Total surface motion, used to drive the glow on the floor. */
export function agitation(s: FluidState): number {
  let sum = 0;
  for (let i = 0; i < s.w; i++) sum += Math.abs(s.vel[i]);
  return sum / s.w;
}
