import { Rack, clamp, mulberry, perc, type Env, type Rng } from "./util";

/**
 * Continuous layers: the room tone of each hall (always running, crossfaded by where the player
 * is) and the market texture, a soft granular layer whose density (0..1) later stages drive from
 * market activity.
 */

/** Overall level of each room tone (audio_render.py checks them against the music). */
const LEVEL = { vault: 0.045, observatory: 0.04 };

/** The ship's hum as heard in one hall. Returns the rack; kill() it to stop. */
export function roomTone(env: Env, out: AudioNode, room: "vault" | "observatory", t: number): Rack {
  const r = new Rack(env);
  // every layer goes through one level; the layers below are balanced against each other
  const level = r.gain(room === "vault" ? LEVEL.vault : LEVEL.observatory);
  level.connect(out);
  out = level;
  const lfo = (hz: number, depth: number, target: AudioParam) => {
    const g = r.gain(depth);
    r.osc("sine", hz, t).connect(g).connect(target);
  };
  if (room === "vault") {
    // warm: a mains-like hum with a soft fifth, low rumble of machinery, air through brass vents
    const hum = r.gain(0.2);
    hum.connect(out);
    lfo(0.11, 0.035, hum.gain);
    r.osc("sine", 55, t).connect(hum);
    const h2 = r.gain(0.3);
    h2.connect(hum);
    r.osc("sine", 110.3, t).connect(h2);
    const h3 = r.gain(0.22);
    h3.connect(hum);
    r.osc("sine", 82.4, t).connect(h3);
    const rumble = r.gain(0.5);
    r.noise("brown", t, 0.1).connect(r.filter("highpass", 35, 0.7)).connect(r.filter("lowpass", 150, 0.6)).connect(rumble).connect(out);
    const air = r.gain(0.05);
    lfo(0.07, 0.018, air.gain);
    r.noise("pink", t, 0.45).connect(r.filter("bandpass", 700, 0.5)).connect(air).connect(out);
  } else {
    // colder and deeper: a slow beat between two low tones, a darker and wider air, and a faint
    // shimmer of high tones that swell and fade one by one, like the stars turning
    const hum = r.gain(0.24);
    hum.connect(out);
    r.osc("sine", 41.2, t).connect(hum);
    const beat = r.gain(0.8);
    beat.connect(hum);
    r.osc("sine", 41.55, t).connect(beat);
    const fifth = r.gain(0.3);
    fifth.connect(hum);
    r.osc("sine", 61.8, t).connect(fifth);
    const rumble = r.gain(0.55);
    r.noise("brown", t, 0.6).connect(r.filter("highpass", 30, 0.7)).connect(r.filter("lowpass", 95, 0.6)).connect(rumble).connect(out);
    const air = r.gain(0.06);
    lfo(0.045, 0.025, air.gain);
    r.noise("pink", t, 0.8).connect(r.filter("bandpass", 320, 0.4)).connect(air).connect(out);
    [1318.5, 1760, 2093, 2637].forEach((f, i) => {
      const g = r.gain(0.0035);
      lfo(0.047 + i * 0.023, 0.0035, g.gain);
      const p = r.pan(i % 2 === 0 ? -0.6 + i * 0.1 : 0.6 - i * 0.1);
      r.osc("sine", f, t).connect(g).connect(p).connect(out);
    });
  }
  return r;
}

const GRAIN_NOTES = [1174.7, 1318.5, 1568, 1760, 2093, 2349, 2637, 3136, 3520];

/**
 * The market texture: a quiet bed of band-limited noise plus grains (short filtered noise blips
 * and tiny tuned ticks) scattered in time and across the stereo field. `density` 0 is nearly
 * silent, 1 is a busy trading floor heard through a wall.
 */
export class MarketTexture {
  private chain: Rack;
  private grains = new Set<Rack>();
  private bed: GainNode;
  private input: GainNode;
  private rnd: Rng;
  private nextGrain: number;
  private _density = 0.12;
  /** Grains scheduled so far (debug). */
  count = 0;
  private disposed = false;

  constructor(
    private env: Env,
    out: AudioNode,
    t: number,
    seed = 4242,
  ) {
    this.rnd = mulberry(seed);
    this.nextGrain = t + 0.2;
    const r = (this.chain = new Rack(env));
    this.input = r.gain(1);
    this.input.connect(r.filter("lowpass", 6500, 0.5)).connect(out);
    this.bed = r.gain(0);
    r.noise("pink", t, 0.25).connect(r.filter("bandpass", 1800, 0.6)).connect(this.bed).connect(this.input);
    this.setDensity(this._density, t);
  }

  get density() {
    return this._density;
  }

  setDensity(v: number, t: number) {
    this._density = clamp(v, 0, 1);
    this.bed.gain.setTargetAtTime(0.012 + 0.16 * this._density, t, 0.4);
  }

  /** Grains per second at the current density. */
  get rate() {
    return 0.35 + 22 * Math.pow(this._density, 1.5);
  }

  /** Schedule the grains that start before `until`. */
  advance(until: number) {
    if (this.disposed) return;
    let guard = 0;
    while (this.nextGrain < until && guard++ < 400) {
      this.grain(this.nextGrain);
      // Poisson arrivals
      this.nextGrain += -Math.log(1 - this.rnd() * 0.999) / this.rate;
    }
  }

  /** Drop what was missed while nothing advanced the layer (tab hidden, context suspended). */
  catchUp(now: number) {
    if (this.nextGrain < now) this.nextGrain = now + 0.05;
  }

  private grain(t: number) {
    const rnd = this.rnd;
    const r = new Rack(this.env, this.grains);
    this.count++;
    const p = r.pan(rnd() * 1.6 - 0.8);
    p.connect(this.input);
    const g = r.gain(0);
    g.connect(p);
    const level = 0.2 + rnd() * 0.35;
    if (rnd() < 0.7) {
      const dur = 0.012 + rnd() * 0.03;
      perc(g.gain, t, level, 0.003, dur / 2.5);
      const f = 900 * Math.pow(5.8, rnd());
      r.noise("white", t, rnd()).connect(r.filter("bandpass", f, 6)).connect(g);
      r.finish(t + dur * 3 + 0.03);
    } else {
      perc(g.gain, t, level * 0.5, 0.002, 0.035);
      r.osc("sine", GRAIN_NOTES[Math.floor(rnd() * GRAIN_NOTES.length)], t).connect(g);
      r.finish(t + 0.3);
    }
  }

  get liveGrains() {
    return this.grains.size;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const g of [...this.grains]) g.kill();
    this.chain.kill();
  }
}
