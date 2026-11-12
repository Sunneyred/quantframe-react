import { MarketTexture, roomTone } from "./ambience";
import { BUS_GAIN, DEFAULT_VOLUME, MUSIC_PATH, buildGraph, taper, type Graph } from "./graph";
import { Composer, TAPES, TapePlayer, tapeById } from "./music";
import { Rack, makeEnv, type Env } from "./util";
import { VOICES, type SoundName, type VoiceOpts } from "./voices";

/**
 * Offline rendering of the game's sound through the real bus graph (OfflineAudioContext), for
 * tools/harness/audio_render.py: it measures peak, loudness, DC, spectrum and clipping, and writes
 * WAVs and spectrograms. Not imported by the app.
 */

export const SAMPLE_RATE = 44100;

export interface Rendered {
  sampleRate: number;
  seconds: number;
  /** Base64 of interleaved stereo float32 (little endian). */
  data: string;
}

function encode(buf: AudioBuffer): Rendered {
  const n = buf.length;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const inter = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    inter[i * 2] = l[i];
    inter[i * 2 + 1] = r[i];
  }
  const bytes = new Uint8Array(inter.buffer);
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as unknown as number[]);
  return { sampleRate: buf.sampleRate, seconds: n / buf.sampleRate, data: btoa(s) };
}

interface Levels {
  /** Dial positions 0..1. */
  master?: number;
  music?: number;
}

async function run(seconds: number, levels: Levels, build: (env: Env, graph: Graph) => void): Promise<Rendered> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const env = makeEnv(ctx);
  const graph = buildGraph(env, ctx.destination);
  graph.master.gain.value = taper(levels.master ?? DEFAULT_VOLUME.master);
  build(env, graph);
  return encode(await ctx.startRendering());
}

/** A tape as heard standing at the deck: music volume, direct + bleed, reverb send, music bus, master, limiter. */
function addTape(env: Env, graph: Graph, id: string, seconds: number, levels: Levels) {
  const r = new Rack(env);
  const musicIn = r.gain(taper(levels.music ?? DEFAULT_VOLUME.music));
  const dry = r.gain(MUSIC_PATH.direct + MUSIC_PATH.bleed);
  const send = r.gain(MUSIC_PATH.send);
  musicIn.connect(dry).connect(graph.buses.music);
  musicIn.connect(send).connect(graph.reverb.send);
  const p = new TapePlayer(env, tapeById(id), musicIn, 0.05);
  p.fade(1, 0, 0.4);
  p.advance(seconds);
}

function addSound(env: Env, graph: Graph, name: SoundName, t: number, opts: VoiceOpts = {}): number {
  const def = VOICES[name];
  const r = new Rack(env);
  const input = r.gain(def.gain);
  input.connect(graph.buses[def.bus]);
  if (def.send > 0) {
    const s = r.gain(def.send);
    input.connect(s).connect(graph.reverb.send);
  }
  const end = def.fn(r, input, t, opts);
  r.finish(end + 0.02);
  return end;
}

export const tapeIds = () => TAPES.map((t) => t.id);
export const soundNames = () => Object.keys(VOICES) as SoundName[];
export const busGains = () => BUS_GAIN;

export function renderTape(id: string, seconds: number, levels: Levels = {}): Promise<Rendered> {
  return run(seconds, levels, (env, graph) => addTape(env, graph, id, seconds, levels));
}

/** One sound at its reference distance, with the Vault's reverb tail. */
export function renderSound(name: SoundName, opts: VoiceOpts = {}, levels: Levels = {}): Promise<Rendered> {
  // measure the voice's length first, then render it with room for the tail
  const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const penv = makeEnv(probe);
  const end = addSound(penv, buildGraph(penv, probe.destination), name, 0.05, opts);
  return run(Math.min(12, end + 2.2), levels, (env, graph) => void addSound(env, graph, name, 0.05, opts));
}

export function renderAmbience(room: "vault" | "observatory", seconds: number, levels: Levels = {}): Promise<Rendered> {
  return run(seconds, levels, (env, graph) => void roomTone(env, graph.buses.ambience, room, 0));
}

export function renderTexture(density: number, seconds: number, levels: Levels = {}): Promise<Rendered> {
  return run(seconds, levels, (env, graph) => {
    const tex = new MarketTexture(env, graph.buses.market, 0);
    tex.setDensity(density, 0);
    tex.advance(seconds);
  });
}

/** Everything at once with both dials fully up: the worst case for the limiter. */
export function renderWorstCase(seconds: number): Promise<Rendered> {
  const levels = { master: 1, music: 1 };
  return run(seconds, levels, (env, graph) => {
    addTape(env, graph, "chrome-lagoon", seconds, levels);
    roomTone(env, graph.buses.ambience, "vault", 0);
    roomTone(env, graph.buses.ambience, "observatory", 0);
    const tex = new MarketTexture(env, graph.buses.market, 0);
    tex.setDensity(1, 0);
    tex.advance(seconds);
    for (let t = 1; t < seconds - 3; t += 2.5) {
      addSound(env, graph, "alert", t);
      addSound(env, graph, "sale", t + 0.1, { amount: 400 });
      addSound(env, graph, "dock", t + 0.2);
      addSound(env, graph, "robot-beep", t + 0.3);
      for (let k = 0; k < 6; k++) addSound(env, graph, "footstep", t + k * 0.3, { seed: k, surface: "metal" });
    }
  });
}

/** A quiet sine straight into the master: the small-signal gain of the master chain (should be 1). */
export async function masterChainGain(): Promise<number> {
  const amp = 0.02;
  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  const env = makeEnv(ctx);
  const graph = buildGraph(env, ctx.destination);
  const r = new Rack(env);
  const g = r.gain(amp);
  r.osc("sine", 440, 0).connect(g).connect(graph.master);
  const d = (await ctx.startRendering()).getChannelData(0);
  let e = 0;
  const from = SAMPLE_RATE;
  for (let i = from; i < d.length; i++) e += d[i] * d[i];
  return Math.sqrt(e / (d.length - from)) / (amp / Math.SQRT2);
}

/** What the composer writes, bar by bar, as strings: to prove that a tape does not loop. */
export function composeSummary(id: string, bars: number): string[] {
  const c = new Composer(tapeById(id));
  const out: string[] = [];
  for (let i = 0; i < bars; i++) {
    const b = c.next();
    out.push(`${b.chord.degree}:${b.chord.pad.join(".")}|${b.plucks.map((p) => `${p.beat.toFixed(2)}/${p.midi}`).join(",")}|${b.drums.length}`);
  }
  return out;
}
