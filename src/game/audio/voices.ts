import type { BusName } from "./graph";
import { clamp, lerp, mulberry, perc, ramp, type Rack } from "./util";

/**
 * Every one-shot sound of the game, synthesised. A voice builds its nodes on a Rack, writes into
 * `out` starting at time `t` and returns the time at which it is silent (the rack is released
 * then). Voices are pure Web Audio: they run in an AudioContext and in an OfflineAudioContext.
 *
 * To add a sound: write a voice here, add it to VOICES with its bus and distance settings, and
 * call `engine.audio.play("name", { position })`. tools/harness/audio_render.py renders every
 * entry of VOICES and checks peak, loudness, DC and clipping.
 */

export type Surface = "stone" | "metal" | "hollow";
export type AnnounceTone = "gold" | "cyan" | "green" | "red";

export interface VoiceOpts {
  /** Hz. */
  pitch?: number;
  /** 0..1. */
  brightness?: number;
  /** Decay multiplier (chime). */
  decay?: number;
  /** Varies the take (footsteps, beeps, sparkle). */
  seed?: number;
  surface?: Surface;
  foot?: "L" | "R";
  /** Player speed in m/s (footsteps). */
  speed?: number;
  /** Platinum of a sale: more coins in the sparkle. */
  amount?: number;
  tone?: AnnounceTone;
  direction?: "in" | "out";
  /** Seconds (servo, whirr). */
  duration?: number;
  mood?: "ok" | "query" | "sad";
}

export type Voice = (r: Rack, out: AudioNode, t: number, o: VoiceOpts) => number;

// ---------------------------------------------------------------------------------------------
// Glass chime: inharmonic partials of a struck glass bowl, each a close doublet (real glass rings
// in pairs of modes that beat slowly), a short noise tick for the strike.
// ---------------------------------------------------------------------------------------------

/** [frequency ratio, amplitude, decay scale] */
const GLASS: Array<[number, number, number]> = [
  [1, 1, 1],
  [2.32, 0.5, 0.6],
  [4.25, 0.3, 0.38],
  [6.63, 0.17, 0.25],
  [9.38, 0.09, 0.16],
];

export const chime: Voice = (r, out, t, o) => {
  const f = clamp(o.pitch ?? 880, 110, 6000);
  const b = clamp(o.brightness ?? 0.5, 0, 1);
  const tau = clamp(1.5 * Math.sqrt(440 / f), 0.22, 2.4) * (o.decay ?? 1);
  const top = r.filter("lowpass", 2400 + 6600 * b, 0.5);
  // the last of the ring is faded, not cut
  const tail = r.gain(1);
  tail.gain.setValueAtTime(1, t + tau * 5.5);
  tail.gain.linearRampToValueAtTime(0, t + tau * 7);
  top.connect(tail).connect(out);
  const upper = lerp(0.22, 1, b);
  let longest = 0;
  for (let i = 0; i < GLASS.length; i++) {
    const [ratio, amp, dk] = GLASS[i];
    const pf = f * ratio;
    if (pf > 9000) break;
    const a = amp * Math.pow(upper, i) * 0.42;
    const g = r.gain(0);
    perc(g.gain, t, a, 0.002 + 0.004 * (1 - b), tau * dk);
    g.connect(top);
    r.osc("sine", pf, t).connect(g);
    if (i < 3) {
      const twin = r.gain(0.4);
      twin.connect(g);
      r.osc("sine", pf * (1.0025 + i * 0.0012), t).connect(twin);
    }
    longest = Math.max(longest, tau * dk);
  }
  if (b > 0.05) {
    const tick = r.gain(0);
    perc(tick.gain, t, 0.1 * b, 0.001, 0.006);
    const bp = r.filter("bandpass", Math.min(7000, f * 2.6 + 1200), 1.4);
    r.noise("white", t, f * 0.013).connect(bp).connect(tick).connect(top);
  }
  void longest;
  return t + tau * 7 + 0.01;
};

// ---------------------------------------------------------------------------------------------
// Footsteps
// ---------------------------------------------------------------------------------------------

const SURFACES: Record<Surface, { thump: number; body: number; tick: number; tickQ: number; ring: number[]; ringTau: number; ringAmp: number }> = {
  // polished stone of the Vault: a dry, short heel click
  stone: { thump: 96, body: 950, tick: 2500, tickQ: 1.1, ring: [], ringTau: 0, ringAmp: 0 },
  // deck plates of the corridor: the plate rings a little
  metal: { thump: 118, body: 1500, tick: 3300, tickQ: 2.2, ring: [312, 527, 818], ringTau: 0.07, ringAmp: 0.05 },
  // the Observatory's raised floor: duller, with a hollow note under it
  hollow: { thump: 72, body: 520, tick: 1500, tickQ: 0.9, ring: [143], ringTau: 0.085, ringAmp: 0.2 },
};

export const footstep: Voice = (r, out, t, o) => {
  const s = SURFACES[o.surface ?? "stone"];
  const rnd = mulberry((o.seed ?? 1) * 2654435761);
  const vary = (amt: number) => 1 + (rnd() * 2 - 1) * amt;
  const side = o.foot === "L" ? 0.97 : 1.03;
  const speed = o.speed ?? 3;
  const level = (0.55 + 0.45 * clamp(speed / 5.6, 0, 1)) * vary(0.18);
  const heelToe = clamp(0.07 - speed * 0.008, 0.022, 0.06);
  // heel: a low thump
  const th = r.gain(0);
  perc(th.gain, t, 0.3 * level, 0.004, 0.022);
  const f0 = s.thump * side * vary(0.08);
  const to = r.osc("sine", f0, t);
  to.frequency.setValueAtTime(f0, t);
  to.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.06);
  to.connect(th).connect(out);
  // body of the shoe on the floor
  const bd = r.gain(0);
  perc(bd.gain, t, 1.5 * level, 0.003, 0.03 * vary(0.2));
  r.noise("pink", t, rnd()).connect(r.filter("highpass", 90, 0.6)).connect(r.filter("lowpass", s.body * vary(0.12), 0.6)).connect(bd).connect(out);
  // heel click, then the softer toe
  for (const [dt, amp] of [
    [0, 0.5],
    [heelToe, 0.25],
  ]) {
    const g = r.gain(0);
    perc(g.gain, t + dt, amp * level, 0.001, 0.009 * vary(0.25));
    r.noise("white", t, rnd()).connect(r.filter("bandpass", s.tick * side * vary(0.1), s.tickQ)).connect(g).connect(out);
  }
  for (const f of s.ring) {
    const g = r.gain(0);
    perc(g.gain, t, s.ringAmp * level, 0.002, s.ringTau * vary(0.2));
    r.osc("sine", f * side * vary(0.03), t).connect(g).connect(out);
  }
  return t + 0.42;
};

// ---------------------------------------------------------------------------------------------
// Passing through an arch: air moving through the opening and a soft pressure bump
// ---------------------------------------------------------------------------------------------

export const arch: Voice = (r, out, t, o) => {
  const inward = (o.direction ?? "in") === "in";
  const bp = r.filter("bandpass", 400, 0.8);
  const [a, b, c] = inward ? [320, 1300, 520] : [520, 1100, 280];
  bp.frequency.setValueAtTime(a, t);
  bp.frequency.exponentialRampToValueAtTime(b, t + 0.32);
  bp.frequency.exponentialRampToValueAtTime(c, t + 0.95);
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [0.28, 0.3],
    [0.95, 0],
  ]);
  r.noise("pink", t, 0.37).connect(bp).connect(r.filter("lowpass", 4200, 0.5)).connect(g).connect(out);
  const lo = r.gain(0);
  ramp(lo.gain, t, 0, [
    [0.12, 0.13],
    [0.6, 0],
  ]);
  const so = r.osc("sine", inward ? 62 : 48, t);
  so.frequency.exponentialRampToValueAtTime(inward ? 46 : 60, t + 0.6);
  so.connect(lo).connect(out);
  return t + 1.0;
};

// ---------------------------------------------------------------------------------------------
// Consoles and in-world screens
// ---------------------------------------------------------------------------------------------

function blip(r: Rack, out: AudioNode, t: number, f: number, dur: number, amp: number) {
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [0.008, amp],
    [dur * 0.6, amp * 0.7],
    [dur, 0],
  ]);
  g.connect(out);
  r.osc("sine", f, t).connect(g);
  const tri = r.gain(0.35);
  tri.connect(g);
  r.osc("triangle", f * 2, t).connect(tri);
}

function relay(r: Rack, out: AudioNode, t: number, amp: number, f = 1900) {
  const g = r.gain(0);
  perc(g.gain, t, amp, 0.0008, 0.005);
  r.noise("white", t, f * 0.0007).connect(r.filter("bandpass", f, 1.5)).connect(g).connect(out);
}

function servoSweep(r: Rack, out: AudioNode, t: number, from: number, to: number, dur: number, amp: number) {
  const lp = r.filter("lowpass", 950, 1.2);
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [0.03, amp],
    [dur - 0.05, amp],
    [dur, 0],
  ]);
  const o = r.osc("sawtooth", from, t);
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.connect(lp).connect(g).connect(out);
}

export const dock: Voice = (r, out, t) => {
  const lp = r.filter("lowpass", 3200, 0.5);
  lp.connect(out);
  relay(r, lp, t, 0.3);
  servoSweep(r, lp, t + 0.01, 105, 210, 0.3, 0.1);
  blip(r, lp, t + 0.16, 659.3, 0.09, 0.2);
  blip(r, lp, t + 0.26, 987.8, 0.16, 0.22);
  return t + 0.5;
};

export const undock: Voice = (r, out, t) => {
  const lp = r.filter("lowpass", 3200, 0.5);
  lp.connect(out);
  blip(r, lp, t, 987.8, 0.08, 0.18);
  blip(r, lp, t + 0.09, 659.3, 0.14, 0.18);
  servoSweep(r, lp, t + 0.04, 200, 100, 0.26, 0.08);
  relay(r, lp, t + 0.3, 0.22, 1500);
  return t + 0.45;
};

export const click: Voice = (r, out, t) => {
  const g = r.gain(0);
  perc(g.gain, t, 0.3, 0.001, 0.012);
  const o = r.osc("sine", 1700, t);
  o.frequency.setValueAtTime(1700, t);
  o.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
  o.connect(g).connect(out);
  relay(r, out, t, 0.16, 2600);
  return t + 0.12;
};

export const hover: Voice = (r, out, t) => {
  const g = r.gain(0);
  perc(g.gain, t, 0.1, 0.001, 0.006);
  r.osc("sine", 2350, t).connect(g).connect(out);
  relay(r, out, t, 0.05, 3200);
  return t + 0.07;
};

// ---------------------------------------------------------------------------------------------
// The sale: a till drawer's mechanism, a bright glass "ching", then coins as small chimes
// ---------------------------------------------------------------------------------------------

const SPARKLE = [1568, 1760, 2093, 2349, 2637, 3136, 3520]; // G major pentatonic, two octaves up

export const sale: Voice = (r, out, t, o) => {
  const rnd = mulberry((o.seed ?? 7) * 40503 + 17);
  // ka-chunk
  const th = r.gain(0);
  perc(th.gain, t, 0.55, 0.003, 0.045);
  const lo = r.osc("sine", 150, t);
  lo.frequency.setValueAtTime(150, t);
  lo.frequency.exponentialRampToValueAtTime(68, t + 0.09);
  lo.connect(th).connect(out);
  const bd = r.gain(0);
  perc(bd.gain, t, 0.4, 0.002, 0.03);
  r.noise("pink", t, 0.21).connect(r.filter("lowpass", 1300, 0.7)).connect(bd).connect(out);
  for (let i = 0; i < 3; i++) relay(r, out, t + 0.035 + i * 0.028, 0.2 - i * 0.03, 2100 + i * 250);
  // ching: two glasses a fifth apart
  let end = chime(r, out, t + 0.13, { pitch: 1568, brightness: 0.9, decay: 0.9 });
  const second = r.gain(0.7);
  second.connect(out);
  chime(r, second, t + 0.145, { pitch: 2349, brightness: 0.8, decay: 0.8 });
  // coins
  const coins = Math.round(clamp(3 + Math.log2(Math.max(1, (o.amount ?? 25) / 8)), 3, 9));
  const cg = r.gain(0.34);
  cg.connect(out);
  let at = t + 0.3;
  for (let i = 0; i < coins; i++) {
    at += 0.05 + rnd() * 0.05;
    const p = SPARKLE[Math.floor(rnd() * SPARKLE.length)];
    end = Math.max(end, chime(r, cg, at, { pitch: p, brightness: 0.55 + rnd() * 0.3, decay: 0.45 }));
  }
  return end;
};

// ---------------------------------------------------------------------------------------------
// The alert: a falling minor third on a soft horn, twice. Clearly above the music, never shrill.
// ---------------------------------------------------------------------------------------------

export const alert: Voice = (r, out, t) => {
  const lp = r.filter("lowpass", 2100, 0.9);
  lp.connect(out);
  const note = (at: number, f: number, dur: number) => {
    const g = r.gain(0);
    ramp(g.gain, at, 0, [
      [0.012, 0.5],
      [dur - 0.05, 0.42],
      [dur, 0],
    ]);
    g.connect(lp);
    r.osc("triangle", f, at).connect(g);
    const saw = r.gain(0.28);
    saw.connect(g);
    r.osc("sawtooth", f, at, 5).connect(saw);
    const sub = r.gain(0.4);
    sub.connect(g);
    r.osc("sine", f / 2, at).connect(sub);
  };
  for (const base of [0, 0.5]) {
    note(t + base, 880, 0.16);
    note(t + base + 0.18, 739.99, 0.22);
  }
  return t + 0.95;
};

// ---------------------------------------------------------------------------------------------
// In-world announcements: a quiet pair of glasses at the PA display, coloured by the tone
// ---------------------------------------------------------------------------------------------

const ANNOUNCE: Record<AnnounceTone, number[]> = {
  cyan: [659.3, 880],
  green: [523.3, 659.3, 784],
  gold: [784, 1174.7],
  red: [880, 622.3],
};

export const announce: Voice = (r, out, t, o) => {
  const notes = ANNOUNCE[o.tone ?? "cyan"];
  let end = t;
  notes.forEach((f, i) => {
    end = Math.max(end, chime(r, out, t + i * 0.17, { pitch: f, brightness: 0.32, decay: 0.8 }));
  });
  return end;
};

// ---------------------------------------------------------------------------------------------
// Cargo robots (used by a later stage): servo, pneumatic whirr, a short chirped phrase
// ---------------------------------------------------------------------------------------------

export const robotServo: Voice = (r, out, t, o) => {
  const dur = clamp(o.duration ?? 0.45, 0.12, 3);
  const f = o.pitch ?? 140;
  const bp = r.filter("bandpass", f * 5.5, 2.4);
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [0.04, 0.3],
    [dur - 0.06, 0.3],
    [dur, 0],
  ]);
  const osc = r.osc("sawtooth", f * 0.6, t);
  osc.frequency.setValueAtTime(f * 0.6, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.08);
  osc.frequency.setValueAtTime(f, t + dur - 0.1);
  osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur);
  // gear ripple
  const wob = r.gain(f * 0.06);
  r.osc("sine", 37, t).connect(wob).connect(osc.frequency);
  // a motor behind a housing: nothing fizzy on top
  const housing = r.filter("lowpass", 2600, 0.6);
  g.connect(housing).connect(out);
  osc.connect(bp).connect(g);
  const low = r.gain(0.5);
  osc.connect(r.filter("lowpass", 420, 0.7)).connect(low).connect(g);
  return t + dur + 0.05;
};

export const robotWhirr: Voice = (r, out, t, o) => {
  const dur = clamp(o.duration ?? 0.7, 0.2, 4);
  const f = o.pitch ?? 900;
  const bp = r.filter("bandpass", f * 0.55, 1.6);
  bp.frequency.setValueAtTime(f * 0.55, t);
  bp.frequency.exponentialRampToValueAtTime(f * 1.6, t + dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(f * 0.75, t + dur);
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [dur * 0.25, 0.26],
    [dur * 0.7, 0.2],
    [dur, 0],
  ]);
  r.noise("pink", t, 0.63).connect(bp).connect(g).connect(out);
  const wg = r.gain(0);
  ramp(wg.gain, t, 0, [
    [dur * 0.3, 0.035],
    [dur, 0],
  ]);
  const whine = r.osc("sine", f, t);
  whine.frequency.setValueAtTime(f, t);
  whine.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur * 0.45);
  whine.frequency.exponentialRampToValueAtTime(f * 1.1, t + dur);
  whine.connect(wg).connect(out);
  return t + dur + 0.05;
};

const BEEP_SCALE = [0, 3, 5, 7, 10, 12, 15];

export const robotBeep: Voice = (r, out, t, o) => {
  const rnd = mulberry((o.seed ?? 3) * 7919 + 5);
  const base = o.pitch ?? 990;
  const mood = o.mood ?? "ok";
  const n = mood === "sad" ? 2 : 2 + Math.floor(rnd() * 3);
  const lp = r.filter("lowpass", 2600, 0.7);
  lp.connect(r.filter("lowpass", 3400, 0.6)).connect(out);
  let at = t;
  let step = Math.floor(rnd() * 3) + 1;
  for (let i = 0; i < n; i++) {
    const dur = 0.055 + rnd() * 0.05;
    const last = i === n - 1;
    if (mood === "sad") step -= 1;
    else if (mood === "query" && last) step += 2;
    else step = clamp(step + Math.floor(rnd() * 5) - 2, 0, BEEP_SCALE.length - 1);
    const f = base * Math.pow(2, BEEP_SCALE[clamp(step, 0, BEEP_SCALE.length - 1)] / 12);
    const g = r.gain(0);
    ramp(g.gain, at, 0, [
      [0.006, 0.16],
      [dur, 0.12],
      [dur + 0.02, 0],
    ]);
    const osc = r.osc("square", f, at);
    const glide = mood === "query" && last ? 1.25 : mood === "sad" ? 0.86 : 1 + (rnd() - 0.5) * 0.12;
    osc.frequency.setValueAtTime(f, at);
    osc.frequency.exponentialRampToValueAtTime(f * glide, at + dur);
    osc.connect(g).connect(lp);
    at += dur + 0.03 + rnd() * 0.03;
  }
  return at + 0.05;
};

// ---------------------------------------------------------------------------------------------
// The tape deck and the master panel: keys, a tape shuttling, a knob's detent, a toggle switch
// ---------------------------------------------------------------------------------------------

export const deckButton: Voice = (r, out, t) => {
  const g = r.gain(0);
  perc(g.gain, t, 0.4, 0.002, 0.02);
  const o = r.osc("sine", 230, t);
  o.frequency.setValueAtTime(230, t);
  o.frequency.exponentialRampToValueAtTime(130, t + 0.05);
  o.connect(g).connect(out);
  const b = r.gain(0);
  perc(b.gain, t, 0.3, 0.001, 0.012);
  r.noise("pink", t, 0.5).connect(r.filter("lowpass", 2200, 0.7)).connect(b).connect(out);
  relay(r, out, t + 0.012, 0.14, 2800);
  return t + 0.2;
};

export const deckShuttle: Voice = (r, out, t, o) => {
  const dur = 0.42;
  const up = (o.direction ?? "in") === "in";
  const bp = r.filter("bandpass", 1200, 2);
  bp.frequency.setValueAtTime(up ? 900 : 2100, t);
  bp.frequency.exponentialRampToValueAtTime(up ? 2300 : 800, t + dur);
  const chop = r.gain(0.6);
  const lfo = r.gain(0.4);
  r.osc("sine", 31, t).connect(lfo).connect(chop.gain);
  const g = r.gain(0);
  ramp(g.gain, t, 0, [
    [0.05, 0.16],
    [dur - 0.08, 0.14],
    [dur, 0],
  ]);
  r.noise("pink", t, 0.11).connect(bp).connect(chop).connect(g).connect(out);
  return t + dur + 0.03;
};

export const knob: Voice = (r, out, t, o) => {
  const f = o.pitch ?? 700;
  const g = r.gain(0);
  perc(g.gain, t, 0.22, 0.001, 0.008);
  r.osc("sine", f, t).connect(g).connect(out);
  relay(r, out, t, 0.14, 2400);
  return t + 0.09;
};

export const toggle: Voice = (r, out, t, o) => {
  const on = (o.direction ?? "in") === "in";
  for (const [dt, f, amp] of [
    [0, on ? 420 : 520, 0.32],
    [0.014, on ? 620 : 360, 0.22],
  ]) {
    const g = r.gain(0);
    perc(g.gain, t + dt, amp, 0.001, 0.014);
    r.osc("triangle", f, t + dt).connect(g).connect(out);
    relay(r, out, t + dt, amp * 0.6, 2000);
  }
  return t + 0.16;
};

// ---------------------------------------------------------------------------------------------

export interface VoiceDef {
  fn: Voice;
  bus: BusName;
  /** Voice level into its bus. */
  gain: number;
  /** PannerNode refDistance in metres: the distance at which the sound is at full level. */
  ref: number;
  /** Share sent to the room reverb. */
  send: number;
}

export const VOICES = {
  chime: { fn: chime, bus: "market", gain: 0.8, ref: 5, send: 0.3 },
  footstep: { fn: footstep, bus: "sfx", gain: 0.5, ref: 1.6, send: 0.12 },
  arch: { fn: arch, bus: "sfx", gain: 0.6, ref: 3, send: 0.2 },
  dock: { fn: dock, bus: "sfx", gain: 0.7, ref: 2, send: 0.1 },
  undock: { fn: undock, bus: "sfx", gain: 0.7, ref: 2, send: 0.1 },
  click: { fn: click, bus: "sfx", gain: 0.6, ref: 2, send: 0.04 },
  hover: { fn: hover, bus: "sfx", gain: 0.8, ref: 2, send: 0.02 },
  sale: { fn: sale, bus: "market", gain: 1.0, ref: 5, send: 0.28 },
  alert: { fn: alert, bus: "market", gain: 1.25, ref: 7, send: 0.2 },
  announce: { fn: announce, bus: "sfx", gain: 0.55, ref: 6, send: 0.3 },
  "robot-servo": { fn: robotServo, bus: "sfx", gain: 1.0, ref: 2.5, send: 0.12 },
  "robot-whirr": { fn: robotWhirr, bus: "sfx", gain: 1.5, ref: 2.5, send: 0.12 },
  "robot-beep": { fn: robotBeep, bus: "sfx", gain: 0.6, ref: 3, send: 0.18 },
  "deck-button": { fn: deckButton, bus: "sfx", gain: 0.6, ref: 1.8, send: 0.08 },
  "deck-shuttle": { fn: deckShuttle, bus: "sfx", gain: 1.8, ref: 1.8, send: 0.08 },
  knob: { fn: knob, bus: "sfx", gain: 0.8, ref: 1.8, send: 0.05 },
  toggle: { fn: toggle, bus: "sfx", gain: 0.6, ref: 1.8, send: 0.08 },
} satisfies Record<string, VoiceDef>;

export type SoundName = keyof typeof VOICES;
