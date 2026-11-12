import { chime } from "./voices";
import { Rack, clamp, mtof, mulberry, perc, ramp, tanhCurve, type Env, type Rng } from "./util";

/**
 * The ship's tapes: original generative music, composed live by a seeded generator and played by
 * synthesised instruments through a cassette-like chain. Nothing is sampled and nothing loops:
 * the chord walk, the melody and the sections come from a PRNG that keeps running.
 *
 *   Composer   (pure)  bar by bar: chord (walk over the degrees of a mode, voiced close to the
 *                      previous chord), plucked notes, drums, where the pads "breathe"
 *   TapePlayer         schedules those bars a little ahead of the clock:
 *                        pads ─ lowpass (two slow LFOs) ─ duck ┐
 *                        sub bass ───────────────────── duck ┤
 *                        plucks ─ slow auto-pan (+ echo) ────┼ sum ─ wow/flutter delay ─ tape
 *                        brushed drums ──────────────────────┘        saturation ─ lowpass x2 ─ out
 *                        hiss ─────────────────────────────────────────────────────┘
 */

export interface TapeDef {
  id: string;
  /** Shown on the deck's display. */
  name: string;
  seed: number;
  bpm: number;
  /** MIDI note of the tonic (octave 2..3). */
  root: number;
  mode: number[];
  barsPerChord: number;
  pad: "saw" | "tri" | "mix";
  pluck: "ep" | "bell" | "glass";
  /** How busy the plucked line is, 0..1. */
  density: number;
  /** Chance that a section plays an arpeggio instead of a free line. */
  arp: number;
  /** Chance that a section has drums (0 = never). */
  drums: number;
  swing: number;
  /** Pad lowpass cutoff in Hz. */
  cutoff: number;
  hiss: number;
  /** Wow and flutter depth, 1 = a well-kept deck. */
  wow: number;
  echo: number;
  /** Trim so that all tapes sit at the same loudness (audio_render.py reports it). */
  level: number;
}

const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const IONIAN = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

export const TAPES: TapeDef[] = [
  { id: "brass-starlight", name: "Brass & Starlight", seed: 1971, bpm: 72, root: 50, mode: LYDIAN, barsPerChord: 2, pad: "saw", pluck: "ep", density: 0.42, arp: 0, drums: 0.6, swing: 0.12, cutoff: 950, hiss: 0.006, wow: 1, echo: 0.22, level: 0.78 },
  { id: "slow-orbit", name: "Slow Orbit", seed: 1977, bpm: 58, root: 45, mode: DORIAN, barsPerChord: 2, pad: "tri", pluck: "bell", density: 0.3, arp: 0, drums: 0, swing: 0, cutoff: 1300, hiss: 0.005, wow: 0.8, echo: 0.3, level: 0.46 },
  { id: "chrome-lagoon", name: "Chrome Lagoon", seed: 1984, bpm: 84, root: 41, mode: AEOLIAN, barsPerChord: 2, pad: "saw", pluck: "ep", density: 0.35, arp: 0.6, drums: 0.8, swing: 0, cutoff: 1100, hiss: 0.005, wow: 0.7, echo: 0.26, level: 0.76 },
  { id: "glassblower", name: "Glassblower's Lullaby", seed: 1968, bpm: 52, root: 43, mode: IONIAN, barsPerChord: 2, pad: "mix", pluck: "glass", density: 0.34, arp: 0, drums: 0, swing: 0, cutoff: 1050, hiss: 0.004, wow: 0.9, echo: 0.28, level: 0.58 },
  { id: "cassette-dusk", name: "Cassette Dusk", seed: 1981, bpm: 66, root: 48, mode: MIXOLYDIAN, barsPerChord: 2, pad: "mix", pluck: "ep", density: 0.38, arp: 0.2, drums: 0.7, swing: 0.2, cutoff: 900, hiss: 0.009, wow: 1.6, echo: 0.2, level: 0.59 },
];

export const tapeById = (id: string) => TAPES.find((t) => t.id === id) ?? TAPES[0];

// ---------------------------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------------------------

export interface Note {
  beat: number;
  midi: number;
  vel: number;
}

export interface Bar {
  index: number;
  chord: { start: boolean; barsLeft: number; degree: number; pad: number[]; bass: number };
  plucks: Note[];
  drums: Array<{ beat: number; kind: "kick" | "snare" | "hat"; vel: number }>;
  ducks: Array<{ beat: number; depth: number }>;
}

/** Weight of moving by this many scale degrees upward (mod 7): fourths and fifths lead. */
const MOVE = [0, 1.5, 1.2, 4, 2.5, 2.5, 1.5];
const SLOT_WEIGHT = [1, 0.35, 0.6, 0.35, 0.8, 0.35, 0.6, 0.45];

export class Composer {
  private rnd: Rng;
  private bar = 0;
  private degree = 0;
  private chordLeft = 0;
  private chordCount = 0;
  private pad: number[] = [];
  private bass = 0;
  private tones: number[] = [];
  private melody = 16;
  private section = { left: 0, len: 0, drums: false, arp: false, pluck: 0.6, fresh: false, count: 0 };
  private dim: number;

  constructor(
    readonly def: TapeDef,
    seed = def.seed,
  ) {
    this.rnd = mulberry(seed);
    // the degree whose triad is diminished (a tritone above its root) is passed over
    this.dim = [0, 1, 2, 3, 4, 5, 6].find((d) => (this.scale(d + 4) - this.scale(d)) % 12 === 6) ?? -1;
  }

  /** MIDI note of scale index i (0 = tonic, 7 = an octave up). */
  private scale(i: number): number {
    const o = Math.floor(i / 7);
    return this.def.root + 12 * o + this.def.mode[i - o * 7];
  }

  private pick(weights: number[]): number {
    let sum = 0;
    for (const w of weights) sum += w;
    let x = this.rnd() * sum;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i];
      if (x <= 0) return i;
    }
    return weights.length - 1;
  }

  private nextChord() {
    const r = this.rnd;
    if (this.chordCount > 0) {
      const w = MOVE.map((m, step) => {
        const to = (this.degree + step) % 7;
        let v = m;
        if (to === this.dim) v *= 0.08;
        if (to === 0 && this.chordCount % 4 === 3) v += 2.5;
        return v;
      });
      this.degree = (this.degree + this.pick(w)) % 7;
    }
    this.chordCount++;
    const d = this.degree;
    const ninth = r() < 0.4;
    this.tones = [d, d + 2, d + 4, d + 6];
    const voiced = [d + 2, d + 4, d + 6, ninth ? d + 8 : d + 7];
    const centre = 62 + Math.round((r() - 0.5) * 4);
    const pad = new Set<number>();
    for (const i of voiced) {
      const n = this.scale(i);
      pad.add(n + 12 * Math.round((centre - n) / 12));
    }
    this.pad = [...pad].sort((a, b) => a - b);
    const root = this.scale(d);
    this.bass = root + 12 * Math.round((39 - root) / 12);
    this.chordLeft = this.def.barsPerChord * (r() < 0.18 ? 2 : 1);
  }

  private nextSection() {
    const r = this.rnd;
    const s = this.section;
    s.count++;
    s.left = s.len = r() < 0.3 ? 4 : 8;
    const drums = s.count > 1 && r() < this.def.drums;
    s.fresh = drums && !s.drums;
    s.drums = drums;
    s.arp = s.count > 1 && r() < this.def.arp;
    s.pluck = 0.45 + r() * 0.55;
  }

  /** Nearest chord tone (as a scale index) to scale index i. */
  private snap(i: number): number {
    let best = i;
    let bestD = 99;
    for (const tone of this.tones) {
      const pc = ((tone % 7) + 7) % 7;
      for (let o = -1; o <= 5; o++) {
        const c = pc + o * 7;
        const dist = Math.abs(c - i);
        if (dist < bestD) {
          bestD = dist;
          best = c;
        }
      }
    }
    return best;
  }

  next(): Bar {
    const r = this.rnd;
    const def = this.def;
    if (this.section.left <= 0) this.nextSection();
    const start = this.chordLeft <= 0;
    if (start) this.nextChord();
    const s = this.section;
    const swing = (slot: number) => slot * 0.5 + (slot % 2 === 1 ? def.swing * 0.25 : 0);

    const plucks: Note[] = [];
    if (s.arp) {
      // an eighth-note arpeggio over the chord, rising then falling, quiet
      const up = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let slot = 0; slot < 8; slot++) {
        if (r() < 0.08) continue;
        const idx = this.tones[up[slot]] + 14 + (slot >= 4 && r() < 0.3 ? 7 : 0);
        plucks.push({ beat: swing(slot), midi: this.scale(idx), vel: 0.3 + r() * 0.15 + (slot % 4 === 0 ? 0.12 : 0) });
      }
    } else if (r() > 0.28) {
      // a free line: a walk over the scale that lands on chord tones on the strong beats
      const phrase = 0.55 + 0.45 * Math.sin(this.bar * 0.458 + def.seed);
      for (let slot = 0; slot < 8; slot++) {
        if (r() >= def.density * s.pluck * SLOT_WEIGHT[slot] * (0.6 + phrase)) continue;
        this.melody += [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)];
        if (slot % 4 === 0) this.melody = this.snap(this.melody);
        // keep the line between about D4 and D6
        while (this.scale(this.melody) > 86) this.melody -= 1;
        while (this.scale(this.melody) < 62) this.melody += 1;
        plucks.push({ beat: swing(slot), midi: this.scale(this.melody), vel: 0.35 + r() * 0.45 });
      }
    }

    const drums: Bar["drums"] = [];
    const ducks: Bar["ducks"] = [];
    if (s.drums) {
      const soft = s.fresh && s.left === s.len ? 0.55 : 1; // drums come in quietly
      drums.push({ beat: 0, kind: "kick", vel: 0.9 * soft }, { beat: 2, kind: "kick", vel: 0.75 * soft });
      if (r() < 0.25) drums.push({ beat: r() < 0.5 ? 2.5 + def.swing * 0.25 : 3.5 + def.swing * 0.25, kind: "kick", vel: 0.4 * soft });
      drums.push({ beat: 1, kind: "snare", vel: (0.6 + r() * 0.2) * soft }, { beat: 3, kind: "snare", vel: (0.65 + r() * 0.2) * soft });
      for (let slot = 0; slot < 8; slot++) if (r() < 0.86) drums.push({ beat: swing(slot), kind: "hat", vel: (slot % 2 === 0 ? 0.5 : 0.3) * (0.8 + r() * 0.4) * soft });
      for (const d of drums) if (d.kind === "kick") ducks.push({ beat: d.beat, depth: 0.34 * d.vel });
    } else {
      ducks.push({ beat: 0, depth: 0.16 }, { beat: 2, depth: 0.1 });
    }

    const bar: Bar = { index: this.bar, chord: { start, barsLeft: this.chordLeft, degree: this.degree, pad: this.pad, bass: this.bass }, plucks, drums, ducks };
    this.bar++;
    this.chordLeft--;
    s.left--;
    return bar;
  }
}

// ---------------------------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------------------------

function padChord(r: Rack, out: AudioNode, t: number, dur: number, notes: number[], kind: TapeDef["pad"]) {
  const attack = Math.min(2.2, dur * 0.3);
  const release = 2.8;
  const env = r.gain(0);
  ramp(env.gain, t, 0, [
    [attack, 1],
    [dur, 0.85],
    [dur + release, 0],
  ]);
  env.connect(out);
  const per = 0.34 / Math.sqrt(notes.length);
  notes.forEach((m, i) => {
    const f = mtof(m);
    const p = r.pan((i % 2 === 0 ? -1 : 1) * (0.18 + 0.12 * (i >> 1)));
    p.connect(env);
    const g = r.gain(per);
    g.connect(p);
    if (kind === "saw") {
      r.osc("sawtooth", f, t, -6).connect(g);
      r.osc("sawtooth", f, t, 7).connect(g);
    } else if (kind === "tri") {
      const boost = r.gain(1.7);
      boost.connect(g);
      r.osc("triangle", f, t, -4).connect(boost);
      r.osc("triangle", f, t, 5).connect(boost);
    } else {
      r.osc("sawtooth", f, t, -5).connect(g);
      const tri = r.gain(1.5);
      tri.connect(g);
      r.osc("triangle", f, t, 6).connect(tri);
    }
  });
  return t + dur + release + 0.05;
}

function subBass(r: Rack, out: AudioNode, t: number, dur: number, midi: number) {
  const f = mtof(midi);
  const env = r.gain(0);
  ramp(env.gain, t, 0, [
    [0.07, 0.17],
    [dur, 0.14],
    [dur + 0.4, 0],
  ]);
  const lp = r.filter("lowpass", 240, 0.6);
  lp.connect(env).connect(out);
  r.osc("sine", f, t).connect(lp);
  const up = r.gain(0.14);
  up.connect(lp);
  r.osc("triangle", f * 2, t).connect(up);
  return t + dur + 0.45;
}

/** A soft FM electric piano: one modulator at the carrier's pitch whose index falls quickly. */
function epNote(r: Rack, out: AudioNode, t: number, midi: number, vel: number) {
  const f = mtof(midi);
  const tau = clamp(0.95 * Math.sqrt(330 / f), 0.4, 1.3);
  const amp = r.gain(0);
  perc(amp.gain, t, 0.4 * vel, 0.004, tau);
  amp.connect(out);
  const car = r.osc("sine", f, t);
  const index = r.gain(0);
  index.gain.setValueAtTime(f * (0.8 + vel * 1.5), t);
  index.gain.setTargetAtTime(f * 0.12, t, 0.22);
  r.osc("sine", f, t).connect(index).connect(car.frequency);
  car.connect(amp);
  return t + tau * 8.5;
}

/** A small FM bell: an inharmonic modulator ratio, quiet and long. */
function bellNote(r: Rack, out: AudioNode, t: number, midi: number, vel: number) {
  const f = mtof(midi);
  const tau = clamp(1.3 * Math.sqrt(440 / f), 0.5, 1.8);
  const amp = r.gain(0);
  perc(amp.gain, t, 0.3 * vel, 0.003, tau);
  amp.connect(out);
  const car = r.osc("sine", f, t);
  const index = r.gain(0);
  index.gain.setValueAtTime(f * 1.5 * vel, t);
  index.gain.setTargetAtTime(0, t, 0.32);
  r.osc("sine", f * 3.51, t).connect(index).connect(car.frequency);
  car.connect(amp);
  return t + tau * 8.5;
}

function kick(r: Rack, out: AudioNode, t: number, vel: number) {
  const g = r.gain(0);
  perc(g.gain, t, 0.5 * vel, 0.004, 0.1);
  const o = r.osc("sine", 96, t);
  o.frequency.setValueAtTime(96, t);
  o.frequency.exponentialRampToValueAtTime(43, t + 0.09);
  o.connect(g).connect(out);
  return t + 0.8;
}

/** A brush on a snare: a soft swell of band-limited noise, not a crack. */
function brush(r: Rack, out: AudioNode, t: number, vel: number, seed: number) {
  const g = r.gain(0);
  perc(g.gain, t, 0.15 * vel, 0.014, 0.085);
  r.noise("pink", t, seed * 0.137).connect(r.filter("bandpass", 1700, 0.7)).connect(g).connect(out);
  return t + 0.7;
}

function hat(r: Rack, out: AudioNode, t: number, vel: number, seed: number) {
  const g = r.gain(0);
  perc(g.gain, t, 0.045 * vel, 0.002, 0.024);
  r.noise("white", t, seed * 0.071).connect(r.filter("highpass", 4200, 0.7)).connect(r.filter("lowpass", 6200, 0.7)).connect(g).connect(out);
  return t + 0.2;
}

// ---------------------------------------------------------------------------------------------
// TapePlayer
// ---------------------------------------------------------------------------------------------

export class TapePlayer {
  readonly out: GainNode;
  readonly composer: Composer;
  private chain: Rack;
  private voices = new Set<Rack>();
  private padIn: GainNode;
  private bassIn: GainNode;
  private pluckIn: GainNode;
  private drumIn: GainNode;
  private padDuck: GainNode;
  private bassDuck: GainNode;
  private nextBar: number;
  private needChord = true;
  private barDur: number;
  private beat: number;
  paused = false;
  /** Bars scheduled so far. */
  bars = 0;
  private disposed = false;

  constructor(
    private env: Env,
    readonly def: TapeDef,
    dest: AudioNode,
    t0: number,
    seed = def.seed,
  ) {
    this.composer = new Composer(def, seed);
    this.beat = 60 / def.bpm;
    this.barDur = this.beat * 4;
    this.nextBar = t0;
    const r = (this.chain = new Rack(env));
    const sum = r.gain(1);
    const wow = r.delay(0.05, 0.006);
    const sat = r.shaper(tanhCurve(1.3), "2x");
    const lp1 = r.filter("lowpass", 6000, 0.5);
    const lp2 = r.filter("lowpass", 7200, 0.6);
    const level = r.gain(def.level);
    this.out = r.gain(0);
    sum.connect(wow).connect(sat).connect(lp1).connect(lp2).connect(level).connect(this.out).connect(dest);

    // wow (slow, two rates so it never repeats exactly) and flutter (fast, tiny)
    const depth = 0.00042 * def.wow;
    for (const [hz, k] of [
      [0.43, 1],
      [0.113, 0.7],
      [6.3, 0.03],
    ]) {
      const g = r.gain(depth * k);
      r.osc("sine", hz, t0).connect(g).connect(wow.delayTime);
    }

    this.padIn = r.gain(1);
    const padFilter = r.filter("lowpass", def.cutoff, 0.8);
    this.padDuck = r.gain(1);
    this.padIn.connect(padFilter).connect(this.padDuck).connect(sum);
    for (const [hz, k] of [
      [0.061, 0.28],
      [0.0173, 0.2],
    ]) {
      const g = r.gain(def.cutoff * k);
      r.osc("sine", hz, t0).connect(g).connect(padFilter.frequency);
    }

    this.bassIn = r.gain(1);
    this.bassDuck = r.gain(1);
    this.bassIn.connect(this.bassDuck).connect(sum);

    this.pluckIn = r.gain(1);
    const autoPan = r.pan(0);
    const panDepth = r.gain(0.3);
    r.osc("sine", 0.31, t0).connect(panDepth).connect(autoPan.pan);
    this.pluckIn.connect(autoPan).connect(sum);
    const echo = r.delay(1.5, this.beat * 0.75);
    const echoLp = r.filter("lowpass", 2400, 0.5);
    const feedback = r.gain(0.32);
    const echoOut = r.gain(def.echo);
    this.pluckIn.connect(echo).connect(echoLp).connect(echoOut).connect(sum);
    echoLp.connect(feedback).connect(echo);

    this.drumIn = r.gain(1);
    this.drumIn.connect(sum);

    const hiss = r.gain(def.hiss);
    r.noise("pink", t0, 0.3).connect(r.filter("highpass", 1500, 0.5)).connect(hiss).connect(lp1);
  }

  /** Schedule every bar that starts before `until`. */
  advance(until: number) {
    if (this.disposed || this.paused) return;
    let guard = 0;
    while (this.nextBar < until && guard++ < 64) this.schedule(this.composer.next());
  }

  private schedule(bar: Bar) {
    const t = this.nextBar;
    const b = this.beat;
    this.bars++;
    if (bar.chord.start || this.needChord) {
      this.needChord = false;
      const dur = bar.chord.barsLeft * this.barDur;
      const r = new Rack(this.env, this.voices);
      const end = padChord(r, this.padIn, t, dur, bar.chord.pad, this.def.pad);
      subBass(r, this.bassIn, t, dur - b * 0.25, bar.chord.bass);
      r.finish(end);
    }
    if (bar.plucks.length || bar.drums.length) {
      const r = new Rack(this.env, this.voices);
      let end = t + this.barDur;
      for (const n of bar.plucks) {
        const at = t + n.beat * b;
        if (this.def.pluck === "ep") end = Math.max(end, epNote(r, this.pluckIn, at, n.midi, n.vel));
        else if (this.def.pluck === "bell") end = Math.max(end, bellNote(r, this.pluckIn, at, n.midi, n.vel));
        else {
          const g = r.gain(0.8 * n.vel);
          g.connect(this.pluckIn);
          end = Math.max(end, chime(r, g, at, { pitch: mtof(n.midi), brightness: 0.3 + n.vel * 0.2, decay: 0.8 }));
        }
      }
      bar.drums.forEach((d, i) => {
        const at = t + d.beat * b;
        const e = d.kind === "kick" ? kick(r, this.drumIn, at, d.vel) : d.kind === "snare" ? brush(r, this.drumIn, at, d.vel, bar.index * 8 + i) : hat(r, this.drumIn, at, d.vel, bar.index * 8 + i);
        end = Math.max(end, e);
      });
      r.finish(end);
    }
    // the pads and the bass breathe with the pulse
    for (const d of bar.ducks) {
      const at = t + d.beat * b;
      this.padDuck.gain.setTargetAtTime(1 - d.depth, at, 0.014);
      this.padDuck.gain.setTargetAtTime(1, at + 0.07, 0.17);
      this.bassDuck.gain.setTargetAtTime(1 - d.depth * 0.6, at, 0.014);
      this.bassDuck.gain.setTargetAtTime(1, at + 0.07, 0.14);
    }
    this.nextBar = t + this.barDur;
  }

  /** Fade the tape's output toward `target` (0..1); `seconds` is roughly the whole fade. */
  fade(target: number, t: number, seconds: number) {
    if (this.disposed) return;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(target, t, Math.max(0.01, seconds / 4));
  }

  pause(t: number) {
    if (this.paused) return;
    this.paused = true;
    this.fade(0, t, 0.35);
  }

  resume(t: number) {
    if (!this.paused) return;
    this.paused = false;
    if (this.nextBar < t + 0.05) {
      // the tape stood still: pick the music up at the next bar, and bring the chord back in
      this.nextBar = t + 0.05;
      this.needChord = true;
    }
    this.fade(1, t, 0.5);
  }

  get liveVoices() {
    return this.voices.size;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of [...this.voices]) v.kill();
    this.chain.kill();
  }
}
