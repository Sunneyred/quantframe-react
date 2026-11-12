import { Rack, mulberry, softClipCurve, type Env } from "./util";

/**
 * The bus graph, the same live and offline:
 *
 *   music ─┐
 *   sfx ───┤                                   ┌─ limiter (compressor) ─ trim ─ soft clip ─ out
 *   market ┼──► master (volume/mute) ─ highpass 22 Hz ┘
 *   ambience┘                     ▲
 *   reverb.send ─► convolver (vault) ─► return ─┤   per-room returns are crossfaded by setRoom()
 *               └► convolver (observatory) ─► return
 */

export type BusName = "music" | "sfx" | "market" | "ambience";
export type Where = "vault" | "corridor" | "observatory";

/** Bus gains at rest. Balance is checked by tools/harness/audio_render.py. */
export const BUS_GAIN: Record<BusName, number> = { music: 0.5, sfx: 0.8, market: 0.6, ambience: 0.5 };
/** Dial positions on a fresh install, and the taper from a dial position (0..1) to a gain. */
export const DEFAULT_VOLUME = { master: 0.8, music: 0.7 };
export const taper = (v: number) => v * v;
/** The music's way into the world when you stand at the deck: direct (through the panner), the bleed through the ship, the reverb send. */
export const MUSIC_PATH = { direct: 0.8, bleed: 0.3, send: 0.1 };
/** Never exceeded by the output (the soft clip's asymptote), about -1.4 dBFS. */
export const CEILING = 0.85;
/**
 * Chromium's DynamicsCompressorNode adds make-up gain that depends on threshold, knee and ratio.
 * This trim takes it out again so that quiet material passes the master chain at unity
 * (measured by audio_render.py, which fails if the small-signal gain drifts from 0 dB).
 */
export const LIMITER = { threshold: -9, knee: 6, ratio: 14, attack: 0.003, release: 0.22, trim: 0.641 };

export interface Graph {
  ctx: BaseAudioContext;
  buses: Record<BusName, GainNode>;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  out: GainNode;
  reverb: { send: GainNode; returns: Record<"vault" | "observatory", GainNode> };
  setRoom(where: Where, t: number, tau?: number): void;
  rack: Rack;
}

interface IR {
  seconds: number;
  rt60: number;
  predelay: number;
  /** Lowpass cutoff of the tail at its start and end (the tail darkens). */
  bright: number;
  dark: number;
  /** Early reflections: count within `early` seconds. */
  taps: number;
  early: number;
  seed: number;
}

export const ROOM_IR: Record<"vault" | "observatory", IR> = {
  // a twelve-sided hall under a dome, hard pearl walls: lively but warm
  vault: { seconds: 2.6, rt60: 2.1, predelay: 0.012, bright: 5200, dark: 1300, taps: 9, early: 0.07, seed: 71 },
  // larger and darker, the sound takes longer to come back
  observatory: { seconds: 4.2, rt60: 3.5, predelay: 0.034, bright: 3800, dark: 800, taps: 7, early: 0.12, seed: 97 },
};

/** A generated impulse response: early taps, then decaying noise that darkens over time, unit energy. */
export function impulseResponse(ctx: BaseAudioContext, ir: IR): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(ir.seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(ir.predelay * sr);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry(ir.seed * 7 + ch * 131);
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const cutoff = ir.dark + (ir.bright - ir.dark) * Math.exp(-t * (3.2 / ir.rt60));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      lp += a * (rnd() * 2 - 1 - lp);
      // the tail builds over the first 30 ms (diffusion), then decays 60 dB in rt60
      const build = Math.min(1, t / 0.03);
      d[i] = lp * build * Math.exp((-6.91 * t) / ir.rt60);
    }
    for (let k = 0; k < ir.taps; k++) {
      const at = pre + Math.floor((0.004 + rnd() * ir.early) * sr);
      const amp = (0.5 + rnd() * 0.5) * (rnd() < 0.5 ? -1 : 1) * Math.exp(-k * 0.25) * 0.35;
      if (at < n - 2) {
        d[at] += amp;
        d[at + 1] += amp * 0.5;
      }
    }
    // fade the very end to zero, remove DC, normalise to unit energy
    const f = Math.floor(sr * 0.05);
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += d[i];
    mean /= n;
    let e = 0;
    for (let i = 0; i < n; i++) {
      d[i] -= mean;
      e += d[i] * d[i];
    }
    const g = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

const RETURN: Record<Where, [number, number]> = { vault: [1, 0], corridor: [0.4, 0.4], observatory: [0, 1] };

export function buildGraph(env: Env, destination: AudioNode): Graph {
  const { ctx } = env;
  const r = new Rack(env);
  const master = r.gain(1);
  const limiter = r.add(ctx.createDynamicsCompressor());
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  const trim = r.gain(LIMITER.trim);
  const clip = r.shaper(softClipCurve(0.6, CEILING), "4x");
  const out = r.gain(1);
  // nothing below hearing reaches the limiter (noise-based rumble, thumps), and no DC
  const rumbleCut = r.filter("highpass", 22, 0.707);
  master.connect(rumbleCut).connect(limiter).connect(trim).connect(clip).connect(out).connect(destination);

  const buses = {} as Record<BusName, GainNode>;
  for (const name of Object.keys(BUS_GAIN) as BusName[]) {
    buses[name] = r.gain(BUS_GAIN[name]);
    buses[name].connect(master);
  }

  const send = r.gain(1);
  const returns = {} as Record<"vault" | "observatory", GainNode>;
  for (const room of ["vault", "observatory"] as const) {
    const conv = r.add(ctx.createConvolver());
    conv.normalize = false;
    conv.buffer = impulseResponse(ctx, ROOM_IR[room]);
    const ret = r.gain(room === "vault" ? 1 : 0);
    send.connect(conv).connect(ret).connect(master);
    returns[room] = ret;
  }

  return {
    ctx,
    buses,
    master,
    limiter,
    out,
    reverb: { send, returns },
    rack: r,
    setRoom(where, t, tau = 0.35) {
      const [v, o] = RETURN[where];
      returns.vault.gain.setTargetAtTime(v, t, tau);
      returns.observatory.gain.setTargetAtTime(o, t, tau);
    },
  };
}
