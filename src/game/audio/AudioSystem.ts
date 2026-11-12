import { getAppSoundScale, setAppSoundScale } from "@utils/sound";
import type { Engine } from "../core/Engine";
import { Emitter, store, stored } from "../core/events";
import { MarketTexture, roomTone } from "./ambience";
import { DEFAULT_VOLUME, MUSIC_PATH, buildGraph, taper, type Graph, type Where } from "./graph";
import { TAPES, TapePlayer, tapeById, type TapeDef } from "./music";
import { GLOBAL, Rack, clamp, makeEnv, type Env } from "./util";
import { VOICES, type SoundName, type Surface, type VoiceDef, type VoiceOpts } from "./voices";

/**
 * The game's sound: one AudioContext (made on the first user gesture, suspended while the tab is
 * hidden, closed on dispose), the bus graph (graph.ts), the listener on the camera, positional
 * one-shots (voices.ts), the tapes (music.ts), room tone and the market texture (ambience.ts).
 * Everything is synthesised; there are no audio files. See the "Audio" section of ARCHITECTURE.md.
 *
 *   engine.audio.play("sale", { position, amount })     any entry of VOICES
 *   engine.audio.chime({ pitch, brightness, position, gain })
 *   engine.audio.market.sale / alert / focus / chime / texture.density
 *   engine.audio.robot.servo / whirr / beep
 *   engine.audio.music.next / prev / toggle / setVolume
 *   engine.audio.setMaster / toggleMute
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PlayOpts extends VoiceOpts {
  /** World position; without it the sound is not spatialised (it is "in your hands"). */
  position?: Vec3Like | null;
  /** Linear gain on top of the voice's own level. */
  gain?: number;
  /** Seconds from now. */
  delay?: number;
}

export interface AudioSettings {
  /** Master volume 0..1 (the brass dial). */
  master: number;
  muted: boolean;
  /** Music volume 0..1 (the deck's knob). */
  music: number;
  /** Tape id. */
  track: string;
  playing: boolean;
}

export interface AudioEvents {
  settings: AudioSettings;
  unlocked: true;
}

export interface Trigger {
  name: SoundName;
  /** Engine time (simulation seconds). */
  t: number;
  position: [number, number, number] | null;
  /** False when the context was not running (or the voice limit was hit) and nothing sounded. */
  played: boolean;
  /** The voice options it was played with (pitch, surface, foot, tone, ...). */
  opts: Record<string, unknown>;
}

const KEY = "vt_game_audio";
const DEFAULTS: AudioSettings = { master: DEFAULT_VOLUME.master, muted: false, music: DEFAULT_VOLUME.music, track: TAPES[0].id, playing: true };
const LOOKAHEAD = 1.2;
const TICK_MS = 200;
const MAX_ONE_SHOTS = 40;
const CROSSFADE = 3;
const SURFACE: Record<Where, Surface> = { vault: "stone", corridor: "metal", observatory: "hollow" };
/** Per room: [vault tone, observatory tone, music bleed cutoff Hz, music bleed gain, market texture gain]. */
const ROOM_MIX: Record<Where, [number, number, number, number, number]> = {
  vault: [1, 0, 14000, MUSIC_PATH.bleed, 0.2],
  corridor: [0.55, 0.55, 2400, 0.3, 0.5],
  observatory: [0, 1, 850, 0.36, 1],
};
const INTERACTIVE = "button, a[href], [role='button'], [role='tab'], [role='option'], input, select, textarea, label";

function loadSettings(): AudioSettings {
  const s = { ...DEFAULTS };
  try {
    const raw = JSON.parse(stored(KEY) ?? "{}") as Partial<AudioSettings>;
    if (typeof raw.master === "number" && isFinite(raw.master)) s.master = clamp(raw.master, 0, 1);
    if (typeof raw.music === "number" && isFinite(raw.music)) s.music = clamp(raw.music, 0, 1);
    if (typeof raw.muted === "boolean") s.muted = raw.muted;
    if (typeof raw.playing === "boolean") s.playing = raw.playing;
    if (typeof raw.track === "string" && TAPES.some((t) => t.id === raw.track)) s.track = raw.track;
  } catch {
    /* corrupt storage: defaults */
  }
  return s;
}

interface Live {
  ctx: AudioContext;
  env: Env;
  graph: Graph;
  /** The music's way into the world: volume, the deck's panner, the bleed through the ship, reverb. */
  rack: Rack;
  musicIn: GainNode;
  musicPanner: PannerNode;
  bleedFilter: BiquadFilterNode;
  bleedGain: GainNode;
  tone: Record<"vault" | "observatory", GainNode>;
  textureGain: GainNode;
  texture: MarketTexture;
  tones: Rack[];
}

export class AudioSystem {
  readonly events = new Emitter<AudioEvents>();
  readonly settings: AudioSettings = loadSettings();
  private live: Live | null = null;
  private player: TapePlayer | null = null;
  private fading: Array<{ player: TapePlayer; until: number }> = [];
  private oneShots = new Set<Rack>();
  private timer = 0;
  private disposed = false;
  private room: Where = "vault";
  private roomSet = false;
  private stride = Math.PI * 0.6;
  private foot: "L" | "R" = "L";
  private steps = 0;
  private musicAt: Vec3Like = { x: 0, y: 1, z: 0 };
  private textureDensity = 0.12;
  private lastHover: Element | null = null;
  private lastHoverAt = 0;
  private offs: Array<() => void> = [];
  private salt = (Date.now() & 0xffff) + 1;
  private triggers: Trigger[] = [];
  private counts: Partial<Record<SoundName, number>> = {};
  private dropped = 0;

  constructor(private engine: Engine) {
    const opt = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", this.unlock, opt);
    window.addEventListener("keydown", this.unlock, opt);
    window.addEventListener("touchstart", this.unlock, opt);
    document.addEventListener("visibilitychange", this.onVisibility);
    const root = engine.element;
    root.addEventListener("click", this.onUiClick, true);
    root.addEventListener("pointerover", this.onUiOver, true);
    this.offs.push(engine.events.on("dock", (id) => this.play(id ? "dock" : "undock")));
    this.applyAppScale();
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  /** True once a user gesture has created the context. */
  get unlocked() {
    return this.live !== null;
  }

  get context(): AudioContext | null {
    return this.live?.ctx ?? null;
  }

  /** Any key or pointer press: create the context the first time, resume it after that. */
  private unlock = () => {
    if (this.disposed) return;
    if (!this.live) this.boot();
    else if (this.live.ctx.state !== "running" && !document.hidden) void this.live.ctx.resume().catch(() => undefined);
  };

  private boot() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: "interactive" });
    } catch (e) {
      console.warn("[game] no audio", e);
      return;
    }
    GLOBAL.created++;
    GLOBAL.open++;
    const env = makeEnv(ctx);
    const graph = buildGraph(env, ctx.destination);
    const t = ctx.currentTime;
    graph.master.gain.value = this.masterTarget;

    const rack = new Rack(env);
    const musicIn = rack.gain(taper(this.settings.music));
    const musicPanner = rack.add(ctx.createPanner());
    musicPanner.panningModel = "equalpower";
    musicPanner.distanceModel = "inverse";
    musicPanner.refDistance = 3;
    musicPanner.rolloffFactor = 1.1;
    musicPanner.maxDistance = 80;
    const direct = rack.gain(MUSIC_PATH.direct);
    musicIn.connect(musicPanner).connect(direct).connect(graph.buses.music);
    // what carries through the ship wherever you stand; duller the further the room
    const bleedFilter = rack.filter("lowpass", ROOM_MIX.vault[2], 0.5);
    const bleedGain = rack.gain(ROOM_MIX.vault[3]);
    musicIn.connect(bleedFilter).connect(bleedGain).connect(graph.buses.music);
    const send = rack.gain(MUSIC_PATH.send);
    musicIn.connect(send).connect(graph.reverb.send);
    // loads Chromium's HRTF data now, so the first positional one-shot is not silent
    const warm = rack.add(ctx.createPanner());
    warm.panningModel = "HRTF";

    const tone = { vault: rack.gain(1), observatory: rack.gain(0) };
    tone.vault.connect(graph.buses.ambience);
    tone.observatory.connect(graph.buses.ambience);
    const tones = [roomTone(env, tone.vault, "vault", t), roomTone(env, tone.observatory, "observatory", t)];
    const textureGain = rack.gain(ROOM_MIX.vault[4]);
    textureGain.connect(graph.buses.market);
    const texture = new MarketTexture(env, textureGain, t);
    texture.setDensity(this.textureDensity, t);

    this.live = { ctx, env, graph, rack, musicIn, musicPanner, bleedFilter, bleedGain, tone, textureGain, texture, tones };
    this.placeMusic();
    this.applyRoom(0.01);
    if (this.settings.playing) this.startTape(0.8);
    this.timer = window.setInterval(this.tick, TICK_MS);
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
    this.tick();
    this.events.emit("unlocked", true);
  }

  private onVisibility = () => {
    const ctx = this.live?.ctx;
    if (!ctx || this.disposed) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };

  /** Scheduler: keeps the tape and the market texture a little ahead of the clock. */
  private tick = () => {
    const l = this.live;
    if (!l || l.ctx.state !== "running") return;
    const now = l.ctx.currentTime;
    this.player?.advance(now + LOOKAHEAD);
    l.texture.catchUp(now);
    l.texture.advance(now + 0.5);
    if (this.fading.length) {
      this.fading = this.fading.filter((f) => {
        if (now < f.until) return true;
        f.player.dispose();
        return false;
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------------

  private get masterTarget() {
    return this.settings.muted ? 0 : taper(this.settings.master);
  }

  private changed() {
    store(KEY, JSON.stringify(this.settings));
    this.events.emit("settings", this.settings);
  }

  private applyMaster() {
    const l = this.live;
    if (l) {
      const g = l.graph.master.gain;
      const now = l.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(this.masterTarget, now + 0.04);
    }
    this.applyAppScale();
  }

  /** The classic app's notification sounds (utils/helper PlaySound) follow the in-world master while the game is mounted. */
  private applyAppScale() {
    setAppSoundScale(this.masterTarget);
  }

  setMaster(v: number) {
    const next = clamp(Math.round(v * 100) / 100, 0, 1);
    if (next === this.settings.master) return;
    this.settings.master = next;
    this.applyMaster();
    this.changed();
  }

  setMuted(muted: boolean) {
    if (muted === this.settings.muted) return;
    this.settings.muted = muted;
    this.applyMaster();
    this.changed();
  }

  toggleMute() {
    this.setMuted(!this.settings.muted);
  }

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------

  private startTape(fadeSeconds: number) {
    const l = this.live;
    if (!l) return;
    const now = l.ctx.currentTime;
    const def = tapeById(this.settings.track);
    this.player = new TapePlayer(l.env, def, l.musicIn, now + 0.12, def.seed + this.salt);
    this.player.fade(1, now + 0.1, fadeSeconds);
    this.player.advance(now + LOOKAHEAD);
  }

  private setTrack(id: string) {
    const def = tapeById(id);
    if (def.id === this.settings.track && this.player) return;
    this.settings.track = def.id;
    const l = this.live;
    if (l) {
      const now = l.ctx.currentTime;
      // at most one tape fades out under the new one
      for (const f of this.fading) f.player.dispose();
      this.fading = [];
      if (this.player) {
        this.player.fade(0, now, CROSSFADE);
        this.fading.push({ player: this.player, until: now + CROSSFADE * 1.6 });
        this.player = null;
      }
      if (this.settings.playing) this.startTape(CROSSFADE);
    }
    this.changed();
  }

  private placeMusic() {
    const p = this.live?.musicPanner;
    if (!p) return;
    const { x, y, z } = this.musicAt;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  /** The tape deck's controls (rooms/vault/audioProps.ts presses these). */
  readonly music = {
    tapes: TAPES as readonly TapeDef[],
    get: () => tapeById(this.settings.track),
    index: () => Math.max(0, TAPES.findIndex((t) => t.id === this.settings.track)),
    next: () => this.setTrack(TAPES[(this.music.index() + 1) % TAPES.length].id),
    prev: () => this.setTrack(TAPES[(this.music.index() + TAPES.length - 1) % TAPES.length].id),
    select: (id: string) => this.setTrack(id),
    play: () => {
      if (this.settings.playing) return;
      this.settings.playing = true;
      const l = this.live;
      if (l) {
        if (this.player) this.player.resume(l.ctx.currentTime);
        else this.startTape(0.8);
        this.player?.advance(l.ctx.currentTime + LOOKAHEAD);
      }
      this.changed();
    },
    pause: () => {
      if (!this.settings.playing) return;
      this.settings.playing = false;
      if (this.live) this.player?.pause(this.live.ctx.currentTime);
      this.changed();
    },
    toggle: () => (this.settings.playing ? this.music.pause() : this.music.play()),
    setVolume: (v: number) => {
      const next = clamp(Math.round(v * 100) / 100, 0, 1);
      if (next === this.settings.music) return;
      this.settings.music = next;
      const l = this.live;
      if (l) l.musicIn.gain.setTargetAtTime(taper(next), l.ctx.currentTime, 0.03);
      this.changed();
    },
    /** Where the music comes from (the deck's speaker). */
    setSource: (p: Vec3Like) => {
      this.musicAt = { x: p.x, y: p.y, z: p.z };
      this.placeMusic();
    },
  };

  // ---------------------------------------------------------------------------
  // One-shots
  // ---------------------------------------------------------------------------

  /** Play a sound from VOICES. Returns false when nothing sounded (no gesture yet, tab hidden, voice limit). */
  play(name: SoundName, opts: PlayOpts = {}): boolean {
    const def: VoiceDef = VOICES[name];
    const l = this.live;
    const pos = opts.position ?? null;
    const ok = !this.disposed && !!l && l.ctx.state === "running" && this.oneShots.size < MAX_ONE_SHOTS;
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    const { position: _p, ...rest } = opts;
    this.triggers.push({ name, t: this.engine.elapsed, position: pos ? [pos.x, pos.y, pos.z] : null, played: ok, opts: rest });
    if (this.triggers.length > 400) this.triggers.splice(0, 200);
    if (!ok || !l) {
      this.dropped++;
      return false;
    }
    const { ctx, graph } = l;
    const t = ctx.currentTime + 0.005 + Math.max(0, opts.delay ?? 0);
    const r = new Rack(l.env, this.oneShots);
    const input = r.gain(def.gain * (opts.gain ?? 1));
    if (pos) {
      const p = r.add(ctx.createPanner());
      p.panningModel = "HRTF";
      p.distanceModel = "inverse";
      p.refDistance = def.ref;
      p.rolloffFactor = 1;
      p.maxDistance = 80;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      input.connect(p).connect(graph.buses[def.bus]);
    } else input.connect(graph.buses[def.bus]);
    if (def.send > 0) {
      const s = r.gain(def.send);
      input.connect(s).connect(graph.reverb.send);
    }
    const end = def.fn(r, input, t, opts);
    r.finish(end + 0.02);
    return true;
  }

  /** The tuned glass chime (market sonification uses this): pitch in Hz, brightness 0..1. */
  chime(o: { pitch: number; brightness?: number; position?: Vec3Like | null; gain?: number; decay?: number; delay?: number }) {
    return this.play("chime", o);
  }

  /** The market's voices. */
  readonly market = {
    chime: (o: { pitch: number; brightness?: number; position?: Vec3Like | null; gain?: number; decay?: number; delay?: number }) => this.chime(o),
    /** A sale: the till and the glass, more coins for a bigger amount. */
    sale: (o: { position?: Vec3Like | null; amount?: number } = {}) => this.play("sale", { position: o.position, amount: o.amount, seed: ++this.steps }),
    /** Someone undercut you. */
    alert: (o: { position?: Vec3Like | null } = {}) => this.play("alert", { position: o.position }),
    /**
     * An item came into focus: one chime whose pitch and brightness follow its trend
     * (`trend` is the relative gap to the moving average, e.g. 0.12 = +12 %).
     */
    focus: (o: { trend: number; dir: string; position?: Vec3Like | null }) => {
      const { pitch, brightness } = trendChime(o.trend, o.dir);
      return this.chime({ pitch, brightness, position: o.position });
    },
    texture: {
      get: () => this.textureDensity,
      /** 0..1: how busy the market sounds. */
      set: (v: number) => {
        this.textureDensity = clamp(v, 0, 1);
        const l = this.live;
        if (l) l.texture.setDensity(this.textureDensity, l.ctx.currentTime);
      },
    },
  };

  /** Cargo-robot voices for a later stage. */
  readonly robot = {
    servo: (o: { position?: Vec3Like | null; pitch?: number; duration?: number; gain?: number } = {}) => this.play("robot-servo", o),
    whirr: (o: { position?: Vec3Like | null; pitch?: number; duration?: number; gain?: number } = {}) => this.play("robot-whirr", o),
    beep: (o: { position?: Vec3Like | null; pitch?: number; mood?: "ok" | "query" | "sad"; seed?: number; gain?: number } = {}) => this.play("robot-beep", { seed: ++this.steps, ...o }),
  };

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  /** Where the player is (rooms/ship.ts reports it every frame). */
  setRoom(where: Where) {
    if (where === this.room && this.roomSet) return;
    const first = !this.roomSet;
    const inward = where === "observatory" || (where === "corridor" && this.room === "vault");
    this.room = where;
    this.roomSet = true;
    this.applyRoom(0.45);
    if (!first) {
      const p = this.engine.player.pos;
      this.play("arch", { position: { x: p.x, y: 1.4, z: p.z }, direction: inward ? "in" : "out" });
    }
  }

  private applyRoom(tau: number) {
    const l = this.live;
    if (!l) return;
    const t = l.ctx.currentTime;
    const [v, o, cut, bleed, tex] = ROOM_MIX[this.room];
    l.graph.setRoom(this.room, t, tau);
    l.tone.vault.gain.setTargetAtTime(v, t, tau);
    l.tone.observatory.gain.setTargetAtTime(o, t, tau);
    l.bleedFilter.frequency.setTargetAtTime(cut, t, tau);
    l.bleedGain.gain.setTargetAtTime(bleed, t, tau);
    l.textureGain.gain.setTargetAtTime(tex, t, tau);
  }

  /** Called by the engine once per frame, after the camera has its pose. */
  update(dt: number) {
    if (this.disposed) return;
    const e = this.engine;
    // footsteps: the same stride clock as the avatar's legs (entities/figures.ts), fed by the
    // speed the player really moved at, so walking into a wall is silent
    const speed = e.player.speed;
    if (speed > 0.35) {
      this.stride += dt * (3.2 + speed * 1.7);
      if (this.stride >= Math.PI) {
        this.stride -= Math.PI;
        if (this.stride > Math.PI) this.stride = 0; // a huge dt never fires twice
        const side = this.foot === "L" ? -1 : 1;
        const yaw = e.player.yaw;
        const p = e.player.pos;
        this.play("footstep", {
          position: { x: p.x + Math.cos(yaw) * 0.11 * side, y: 0.03, z: p.z - Math.sin(yaw) * 0.11 * side },
          surface: SURFACE[this.room],
          foot: this.foot,
          speed,
          seed: ++this.steps,
        });
        this.foot = this.foot === "L" ? "R" : "L";
      }
    } else this.stride = Math.PI * 0.6; // the first step comes soon after setting off

    const l = this.live;
    if (!l || l.ctx.state !== "running") return;
    const m = e.camera.matrixWorld.elements;
    const li = l.ctx.listener;
    if (li.positionX) {
      li.positionX.value = m[12];
      li.positionY.value = m[13];
      li.positionZ.value = m[14];
      li.forwardX.value = -m[8];
      li.forwardY.value = -m[9];
      li.forwardZ.value = -m[10];
      li.upX.value = m[4];
      li.upY.value = m[5];
      li.upZ.value = m[6];
    } else {
      li.setPosition(m[12], m[13], m[14]);
      li.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
    }
  }

  // ---------------------------------------------------------------------------
  // In-world screens: a click for controls, a tick when the pointer reaches one
  // ---------------------------------------------------------------------------

  private control(target: EventTarget | null): Element | null {
    if (!(target instanceof Element) || !target.closest(".vtg-screen")) return null;
    return target.closest(INTERACTIVE);
  }

  private onUiClick = (e: Event) => {
    if (this.control(e.target)) this.play("click");
  };

  private onUiOver = (e: Event) => {
    const c = this.control(e.target);
    if (!c) {
      this.lastHover = null;
      return;
    }
    const now = performance.now();
    if (c === this.lastHover || now - this.lastHoverAt < 45) return;
    this.lastHover = c;
    this.lastHoverAt = now;
    this.play("hover");
  };

  // ---------------------------------------------------------------------------
  // Debug and teardown
  // ---------------------------------------------------------------------------

  /** Counters for tests and the console (`__vtGame.engine.audio.debug`). */
  get debug() {
    const l = this.live;
    return {
      state: (l?.ctx.state ?? "none") as string,
      unlocked: !!l,
      sampleRate: l?.ctx.sampleRate ?? 0,
      liveNodes: l?.env.stats.nodes ?? 0,
      liveVoices: l?.env.stats.voices ?? 0,
      started: l?.env.stats.started ?? 0,
      /** Nodes that live as long as the system: the graph, the music path, room tones, the texture bed. */
      fixedNodes: l ? l.graph.rack.size + l.rack.size + l.tones.reduce((n, r) => n + r.size, 0) : 0,
      oneShots: this.oneShots.size,
      masterGain: l?.graph.master.gain.value ?? null,
      masterTarget: this.masterTarget,
      musicGain: l?.musicIn.gain.value ?? null,
      limiterReduction: l?.graph.limiter.reduction ?? 0,
      room: this.room,
      /** Current gains of the per-room layers: [vault tone, observatory tone, vault reverb, observatory reverb, market texture]. */
      mix: l ? [l.tone.vault.gain.value, l.tone.observatory.gain.value, l.graph.reverb.returns.vault.gain.value, l.graph.reverb.returns.observatory.gain.value, l.textureGain.gain.value] : null,
      settings: { ...this.settings },
      music: { tape: this.settings.track, name: tapeById(this.settings.track).name, playing: this.settings.playing, bars: this.player?.bars ?? 0, voices: this.player?.liveVoices ?? 0, fading: this.fading.length, source: { ...this.musicAt } },
      texture: { density: this.textureDensity, grains: l?.texture.count ?? 0 },
      triggers: this.triggers.slice(),
      counts: { ...this.counts },
      dropped: this.dropped,
      appSoundScale: getAppSoundScale(),
      global: { ...GLOBAL },
    };
  }

  /** Forget the trigger log (tests). */
  clearTriggers() {
    this.triggers = [];
    this.counts = {};
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const opt = { capture: true } as const;
    window.removeEventListener("pointerdown", this.unlock, opt);
    window.removeEventListener("keydown", this.unlock, opt);
    window.removeEventListener("touchstart", this.unlock, opt);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const root = this.engine.element;
    root.removeEventListener("click", this.onUiClick, true);
    root.removeEventListener("pointerover", this.onUiOver, true);
    for (const off of this.offs) off();
    this.offs = [];
    window.clearInterval(this.timer);
    setAppSoundScale(1);
    this.events.clear();
    const l = this.live;
    this.live = null;
    if (!l) return;
    this.player?.dispose();
    this.player = null;
    for (const f of this.fading) f.player.dispose();
    this.fading = [];
    l.texture.dispose();
    // everything else: one-shots still ringing, room tones, the music path, the graph
    for (const r of [...l.env.racks]) r.kill();
    void l.ctx
      .close()
      .catch(() => undefined)
      .finally(() => {
        GLOBAL.closed++;
        GLOBAL.open--;
      });
  }
}

/** Pitch and brightness of the focus chime for a trend: rising is higher and brighter, falling lower and duller. */
export function trendChime(trend: number, dir: string): { pitch: number; brightness: number } {
  if (dir === "unknown") return { pitch: 587.33, brightness: 0.15 };
  const k = clamp(trend / 0.25, -1, 1);
  // A5 for flat, up to a fifth above for a strong rise, down to a fifth below for a strong fall
  return { pitch: 880 * Math.pow(2, (k * 7) / 12), brightness: clamp(0.5 + k * 0.42, 0.08, 0.95) };
}

if (import.meta.env.DEV) (window as unknown as { __vtAudioDebug?: unknown }).__vtAudioDebug = { global: GLOBAL, appSoundScale: getAppSoundScale };
