/**
 * Small building blocks for the synthesised audio: a seeded PRNG, noise buffers, envelopes and the
 * `Rack`, which owns the nodes of one voice and releases them when the voice ends.
 * Everything works on a BaseAudioContext, so the same code renders live and offline (render.ts).
 */

export type Rng = () => number;

export function mulberry(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dB = (d: number) => Math.pow(10, d / 20);
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Live node and voice counts of one audio system (dev counters, see AudioSystem.debug). */
export interface Stats {
  nodes: number;
  voices: number;
  started: number;
}

/** Counts across every AudioSystem ever made on this page: proves that a remount leaks nothing. */
export const GLOBAL = { created: 0, closed: 0, open: 0, nodes: 0, voices: 0 };

export interface Env {
  ctx: BaseAudioContext;
  stats: Stats;
  /** Every rack that is alive, so a teardown can stop them all. */
  racks: Set<Rack>;
}

export function makeEnv(ctx: BaseAudioContext): Env {
  return { ctx, stats: { nodes: 0, voices: 0, started: 0 }, racks: new Set() };
}

export type NoiseKind = "white" | "pink" | "brown";
const NOISE_SECONDS = 4;
const noiseCache = new WeakMap<BaseAudioContext, Partial<Record<NoiseKind, AudioBuffer>>>();

/** A 4 s stereo (decorrelated) noise buffer per context and colour, generated once. */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let set = noiseCache.get(ctx);
  if (!set) noiseCache.set(ctx, (set = {}));
  const have = set[kind];
  if (have) return have;
  const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry(kind === "white" ? 11 + ch : kind === "pink" ? 23 + ch : 37 + ch);
    const d = buf.getChannelData(ch);
    if (kind === "white") {
      for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    } else if (kind === "pink") {
      // Paul Kellet's economy pink filter
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
      }
    } else {
      let y = 0;
      for (let i = 0; i < n; i++) {
        y = (y + (rnd() * 2 - 1) * 0.02) * 0.999;
        d[i] = y * 9;
      }
      // remove what little DC a leaky integrator leaves
      let mean = 0;
      for (let i = 0; i < n; i++) mean += d[i];
      mean /= n;
      for (let i = 0; i < n; i++) d[i] -= mean;
    }
    // loop seam: fade the last 20 ms into the first sample's neighbourhood
    const f = Math.floor(ctx.sampleRate * 0.02);
    for (let i = 0; i < f; i++) {
      const k = i / f;
      d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k;
    }
  }
  set[kind] = buf;
  return buf;
}

/** Attack to `peak`, then an exponential fall with time constant `tau` (about -60 dB after 7 tau). */
export function perc(p: AudioParam, t: number, peak: number, attack: number, tau: number) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, tau);
}

/** Linear breakpoints: [seconds after t, value]. */
export function ramp(p: AudioParam, t: number, start: number, points: Array<[number, number]>) {
  p.setValueAtTime(start, t);
  for (const [dt, v] of points) p.linearRampToValueAtTime(v, t + dt);
}

/**
 * The nodes of one voice (or one persistent chain). Sources are started when they are made;
 * `finish(t)` stops them all at t and releases every node when they have ended; `kill()` does
 * it now. Counts go to the owning system's stats and to GLOBAL.
 */
export class Rack {
  readonly ctx: BaseAudioContext;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private dead = false;
  /** Called once when the rack is released. */
  onfree: (() => void) | null = null;

  constructor(
    private env: Env,
    private group?: Set<Rack>,
  ) {
    this.ctx = env.ctx;
    env.stats.voices++;
    env.stats.started++;
    GLOBAL.voices++;
    env.racks.add(this);
    group?.add(this);
  }

  get size() {
    return this.nodes.length;
  }

  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    this.env.stats.nodes++;
    GLOBAL.nodes++;
    return n;
  }

  osc(type: OscillatorType, freq: number, start: number, detune = 0): OscillatorNode {
    const o = this.add(this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start(start);
    this.sources.push(o);
    return o;
  }

  noise(kind: NoiseKind, start: number, offset = 0, rate = 1): AudioBufferSourceNode {
    const s = this.add(this.ctx.createBufferSource());
    s.buffer = noiseBuffer(this.ctx, kind);
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(start, (((offset % 1) + 1) % 1) * NOISE_SECONDS);
    this.sources.push(s);
    return s;
  }

  gain(v = 1): GainNode {
    const g = this.add(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.add(this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  pan(v: number): StereoPannerNode {
    const p = this.add(this.ctx.createStereoPanner());
    p.pan.value = v;
    return p;
  }

  delay(max: number, time: number): DelayNode {
    const d = this.add(this.ctx.createDelay(max));
    d.delayTime.value = time;
    return d;
  }

  shaper(curve: Float32Array, oversample: OverSampleType = "none"): WaveShaperNode {
    const w = this.add(this.ctx.createWaveShaper());
    w.curve = curve as Float32Array<ArrayBuffer>;
    w.oversample = oversample;
    return w;
  }

  /** Stop every source at `t` and release the rack when they have ended. */
  finish(t: number) {
    if (this.dead) return;
    if (this.sources.length === 0) {
      this.kill();
      return;
    }
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* already stopped */
      }
    }
    this.sources[0].onended = () => this.kill();
  }

  /** Stop and disconnect everything now. */
  kill() {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* never started or already stopped */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* not connected */
      }
    }
    this.env.stats.nodes -= this.nodes.length;
    GLOBAL.nodes -= this.nodes.length;
    this.env.stats.voices--;
    GLOBAL.voices--;
    this.nodes = [];
    this.sources = [];
    this.env.racks.delete(this);
    this.group?.delete(this);
    const cb = this.onfree;
    this.onfree = null;
    cb?.();
  }
}

/** A symmetric soft-clip curve: linear up to `knee`, then bending toward `ceiling`. */
export function softClipCurve(knee: number, ceiling: number, n = 4097): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export function tanhCurve(drive: number, n = 2049): Float32Array {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  return c;
}
