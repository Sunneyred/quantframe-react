import * as THREE from "three";
import { faceCentre, polar } from "../../art/kit";
import { CanvasLabel, CYAN, FONT_DISPLAY, fontsReady, GOLD } from "../../art/textures";
import type { Engine } from "../../core/Engine";
import type { Interactable } from "../../core/interact";
import { R } from "./shell";

/**
 * The Vault's sound controls, all in the world:
 *
 * - the tape deck, a small floor cabinet south of the reservoir: previous / play-pause / next keys,
 *   a music volume knob, a display with the tape's name, two reels that turn while it plays. The
 *   music comes out of its speaker (it is the music's positional source).
 * - the master panel on the south-south-west pillar: a big brass dial (master volume) and a toggle
 *   switch (mute) that govern every sound of the ship.
 *
 * Controls use the look-at interaction: E or click presses a key or flips the switch; on a knob E
 * turns it up one step, Shift+E down, and the mouse wheel turns it while you look at it.
 * Built from primitives with the shared Palette materials (by field name).
 */

/** Deck position: the sound corner between the announcements display and the Service Deck, by the master panel's pillar. */
export const DECK_AT = polar(133, 8.3);
/** The deck faces the spawn point. */
const DECK_FACING = new THREE.Vector3(-1.4, 0, 9.3);
/** The pillar that carries the master panel (pillars stand at 15 + 30k degrees). */
export const PANEL_DEG = 135;
const PANEL_Y = 1.36;
const STEP = 0.05;
const REACH = 2.7;
const KNOB_VERB = "Up · Shift+E down · Wheel";

export interface AudioProps {
  update(dt: number, t: number): void;
  dispose(): void;
  /** World positions of the controls (tests aim at these). */
  points: Record<"prev" | "play" | "next" | "volume" | "master" | "mute" | "speaker", THREE.Vector3>;
}

export function buildAudioProps(engine: Engine): AudioProps {
  const { scene, palette: p, world, interact, audio } = engine;
  const offs: Array<() => void> = [];
  const labels: CanvasLabel[] = [];
  const cyl = (r0: number, r1: number, h: number, mat: THREE.Material, seg = 24) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
    m.rotation.x = Math.PI / 2; // axis toward the viewer (+Z)
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  const labelPlane = (label: CanvasLabel, w: number, h: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, toneMapped: false }));

  // -------------------------------------------------------------------------------------------
  // The tape deck
  // -------------------------------------------------------------------------------------------
  const deck = new THREE.Group();
  deck.position.copy(DECK_AT);
  deck.rotation.y = Math.atan2(DECK_FACING.x - DECK_AT.x, DECK_FACING.z - DECK_AT.z);
  scene.add(deck);
  const FRONT = 0.23;
  deck.add(box(0.9, 0.06, 0.52, p.bakelite, 0, 0.03, 0));
  deck.add(box(0.84, 1.18, 0.46, p.wood, 0, 0.65, 0));
  deck.add(box(0.9, 0.04, 0.52, p.gold, 0, 1.26, 0));
  deck.add(box(0.76, 0.64, 0.02, p.steel, 0, 0.93, FRONT));
  // speaker: slats of brass over a dark recess
  deck.add(box(0.66, 0.42, 0.012, p.steel, 0, 0.34, FRONT));
  for (let i = 0; i < 7; i++) deck.add(box(0.62, 0.014, 0.014, p.gold, 0, 0.17 + i * 0.057, FRONT + 0.008));
  deck.add(p.shadowDecal(1.5, 1.1));

  // display
  const display = new CanvasLabel(768, 192);
  labels.push(display);
  const displayMesh = labelPlane(display, 0.6, 0.15);
  displayMesh.position.set(0, 1.15, FRONT + 0.016);
  deck.add(displayMesh);
  deck.add(box(0.64, 0.19, 0.008, p.goldDark, 0, 1.15, FRONT + 0.01));

  // reels
  const reels: THREE.Group[] = [];
  for (const x of [-0.17, 0.17]) {
    const reel = new THREE.Group();
    reel.position.set(x, 0.955, FRONT + 0.02);
    reel.add(cyl(0.098, 0.098, 0.012, p.gold, 28));
    const hub = cyl(0.03, 0.03, 0.03, p.steel, 12);
    reel.add(hub);
    for (let k = 0; k < 3; k++) {
      const spoke = box(0.17, 0.02, 0.016, p.goldDark, 0, 0, 0.004);
      spoke.rotation.z = (k * Math.PI) / 3;
      reel.add(spoke);
    }
    deck.add(reel);
    reels.push(reel);
  }
  deck.add(box(0.34, 0.008, 0.008, p.undersuit, 0, 0.852, FRONT + 0.02)); // the tape between the reels

  // keys and the knob
  const KEY_Y = 0.72;
  const keyX = { prev: -0.27, play: -0.12, next: 0.03 };
  const keys = {} as Record<keyof typeof keyX, THREE.Mesh>;
  for (const k of Object.keys(keyX) as Array<keyof typeof keyX>) {
    keys[k] = box(0.11, 0.07, 0.035, p.gold, keyX[k], KEY_Y, FRONT + 0.025);
    deck.add(keys[k]);
  }
  const playLamp = box(0.05, 0.012, 0.012, p.cyanGlow, keyX.play, KEY_Y + 0.055, FRONT + 0.016);
  deck.add(playLamp);
  const legend = new CanvasLabel(768, 64);
  labels.push(legend);
  legend.draw((ctx, w, h) => {
    // 768 px = 0.72 m: x of a control = (local x + 0.36) / 0.72 * w
    const at = (x: number) => ((x + 0.36) / 0.72) * w;
    ctx.fillStyle = GOLD;
    const tri = (cx: number, dir: number) => {
      ctx.beginPath();
      ctx.moveTo(cx - dir * 12, h / 2 - 14);
      ctx.lineTo(cx + dir * 12, h / 2);
      ctx.lineTo(cx - dir * 12, h / 2 + 14);
      ctx.closePath();
      ctx.fill();
    };
    tri(at(keyX.prev) + 13, -1);
    tri(at(keyX.prev) - 13, -1);
    tri(at(keyX.play) - 12, 1);
    ctx.fillRect(at(keyX.play) + 8, h / 2 - 14, 7, 28);
    ctx.fillRect(at(keyX.play) + 20, h / 2 - 14, 7, 28);
    tri(at(keyX.next) - 13, 1);
    tri(at(keyX.next) + 13, 1);
    ctx.font = `600 30px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("VOL", at(0.26), h / 2 + 2);
  });
  const legendMesh = labelPlane(legend, 0.72, 0.06);
  legendMesh.position.set(0, KEY_Y - 0.085, FRONT + 0.012);
  deck.add(legendMesh);

  const knob = new THREE.Group();
  knob.position.set(0.26, KEY_Y + 0.005, FRONT + 0.03);
  knob.add(cyl(0.058, 0.064, 0.05, p.gold, 24));
  knob.add(box(0.012, 0.05, 0.012, p.cyanGlow, 0, 0.032, 0.026));
  deck.add(knob);

  world.circle(DECK_AT.x, DECK_AT.z, 0.5);
  deck.updateWorldMatrix(true, false);
  const deckPoint = (x: number, y: number, z = FRONT + 0.03) => deck.localToWorld(new THREE.Vector3(x, y, z));
  const speaker = deckPoint(0, 0.4, FRONT);
  // hints float over the speaker grille / under the panel: in view while you aim at a control, never on it
  const deckHint = deckPoint(0, 0.5, FRONT + 0.08);
  audio.music.setSource(speaker);

  // -------------------------------------------------------------------------------------------
  // The master panel
  // -------------------------------------------------------------------------------------------
  const panel = new THREE.Group();
  panel.position.copy(polar(PANEL_DEG, R - 0.2 - 0.46, PANEL_Y));
  panel.rotation.y = faceCentre(PANEL_DEG);
  scene.add(panel);
  panel.add(box(0.42, 0.64, 0.02, p.gold, 0, 0, 0));
  panel.add(box(0.36, 0.58, 0.03, p.goldDark, 0, 0, 0.012));
  const DIAL_Y = 0.06;
  const SWITCH_Y = -0.19;
  for (let i = 0; i <= 10; i++) {
    const a = THREE.MathUtils.degToRad(135 - i * 27);
    const tick = box(0.008, i % 5 === 0 ? 0.03 : 0.018, 0.006, p.gold, -Math.sin(a) * 0.145, DIAL_Y + Math.cos(a) * 0.145, 0.03);
    tick.rotation.z = a;
    panel.add(tick);
  }
  const dial = new THREE.Group();
  dial.position.set(0, DIAL_Y, 0.03);
  dial.add(cyl(0.1, 0.112, 0.06, p.gold, 32));
  const dialCap = cyl(0.07, 0.07, 0.012, p.goldDark, 24);
  dialCap.position.z = 0.032;
  dial.add(dialCap);
  dial.add(box(0.014, 0.075, 0.014, p.cyanGlow, 0, 0.06, 0.036));
  panel.add(dial);
  panel.add(box(0.1, 0.09, 0.03, p.steel, -0.05, SWITCH_Y, 0.03));
  const lever = new THREE.Group();
  lever.position.set(-0.05, SWITCH_Y, 0.045);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.09, 10), p.gold);
  stick.rotation.x = Math.PI / 2;
  stick.position.z = 0.04;
  lever.add(stick);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), p.gold);
  tip.position.z = 0.088;
  lever.add(tip);
  panel.add(lever);
  const lamp: THREE.Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), p.cyanGlow);
  lamp.position.set(0.09, SWITCH_Y, 0.034);
  panel.add(lamp);
  const plate = new CanvasLabel(512, 96);
  labels.push(plate);
  const plateMesh = labelPlane(plate, 0.32, 0.06);
  plateMesh.position.set(0, 0.245, 0.029);
  panel.add(plateMesh);
  panel.updateWorldMatrix(true, false);
  const panelPoint = (x: number, y: number, z = 0.06) => panel.localToWorld(new THREE.Vector3(x, y, z));
  const panelHint = panelPoint(0, -0.47, 0.14);

  // -------------------------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------------------------
  const points = {
    prev: deckPoint(keyX.prev, KEY_Y),
    play: deckPoint(keyX.play, KEY_Y),
    next: deckPoint(keyX.next, KEY_Y),
    volume: deckPoint(0.26, KEY_Y),
    master: panelPoint(0, DIAL_Y),
    mute: panelPoint(-0.05, SWITCH_Y, 0.09),
    speaker,
  };
  const free = () => !engine.screens.busy;
  const shift = () => engine.input.down("ShiftLeft") || engine.input.down("ShiftRight");
  const press = (key: THREE.Mesh) => {
    key.userData.pressed = 1;
  };
  const turnMusic = (dir: number) => {
    const before = audio.settings.music;
    audio.music.setVolume(before + dir * STEP);
    if (audio.settings.music !== before) audio.play("knob", { position: points.volume, pitch: 520 + audio.settings.music * 520 });
  };
  const turnMaster = (dir: number) => {
    const before = audio.settings.master;
    audio.setMaster(before + dir * STEP);
    if (audio.settings.master !== before) audio.play("knob", { position: points.master, pitch: 380 + audio.settings.master * 380, gain: 1.3 });
  };
  const items: Record<"prev" | "play" | "next" | "volume" | "master" | "mute", Interactable> = {
    prev: {
      id: "deck-prev",
      verb: "Previous tape",
      label: "",
      position: points.prev,
      radius: 0.072,
      reach: REACH,
      hint: deckHint,
      enabled: free,
      onUse: () => {
        press(keys.prev);
        audio.play("deck-button", { position: points.prev });
        audio.play("deck-shuttle", { position: points.prev, direction: "out", delay: 0.07 });
        audio.music.prev();
      },
    },
    play: {
      id: "deck-play",
      verb: "Pause",
      label: "",
      position: points.play,
      radius: 0.072,
      reach: REACH,
      hint: deckHint,
      enabled: free,
      onUse: () => {
        press(keys.play);
        audio.play("deck-button", { position: points.play });
        audio.music.toggle();
      },
    },
    next: {
      id: "deck-next",
      verb: "Next tape",
      label: "",
      position: points.next,
      radius: 0.072,
      reach: REACH,
      hint: deckHint,
      enabled: free,
      onUse: () => {
        press(keys.next);
        audio.play("deck-button", { position: points.next });
        audio.play("deck-shuttle", { position: points.next, direction: "in", delay: 0.07 });
        audio.music.next();
      },
    },
    volume: { id: "deck-volume", verb: KNOB_VERB, label: "", position: points.volume, radius: 0.085, reach: REACH, hint: deckHint, enabled: free, onUse: () => turnMusic(shift() ? -1 : 1) },
    master: { id: "audio-master", verb: KNOB_VERB, label: "", position: points.master, radius: 0.135, reach: REACH, hint: panelHint, enabled: free, onUse: () => turnMaster(shift() ? -1 : 1) },
    mute: {
      id: "audio-mute",
      verb: "Mute",
      label: "All sound",
      position: points.mute,
      radius: 0.075,
      reach: REACH,
      hint: panelHint,
      enabled: free,
      onUse: () => {
        const muting = !audio.settings.muted;
        // the switch is heard on the way out as well as on the way back
        if (muting) audio.play("toggle", { position: points.mute, direction: "out" });
        audio.toggleMute();
        if (!muting) audio.play("toggle", { position: points.mute, direction: "in" });
      },
    },
  };
  for (const it of Object.values(items)) offs.push(interact.add(it));

  // the wheel turns the knob you are looking at
  const onWheel = (e: WheelEvent) => {
    if (engine.screens.busy || e.deltaY === 0) return;
    const id = interact.focused?.id;
    if (id === "deck-volume") turnMusic(e.deltaY < 0 ? 1 : -1);
    else if (id === "audio-master") turnMaster(e.deltaY < 0 ? 1 : -1);
  };
  window.addEventListener("wheel", onWheel, { passive: true });
  offs.push(() => window.removeEventListener("wheel", onWheel));

  // -------------------------------------------------------------------------------------------
  // State onto the props
  // -------------------------------------------------------------------------------------------
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const refresh = () => {
    const s = audio.settings;
    const tape = audio.music.get();
    const n = audio.music.index() + 1;
    const total = audio.music.tapes.length;
    items.prev.label = items.next.label = items.play.label = tape.name;
    items.play.verb = s.playing ? "Pause" : "Play";
    items.volume.label = `Music volume ${pct(s.music)}`;
    items.master.label = s.muted ? `Master ${pct(s.master)} (muted)` : `Master volume ${pct(s.master)}`;
    items.mute.verb = s.muted ? "Unmute" : "Mute";
    playLamp.material = s.playing ? p.cyanGlow : p.undersuit;
    lamp.material = s.muted ? p.undersuit : p.cyanGlow;
    display.draw((ctx, w, h) => {
      ctx.fillStyle = "#06121a";
      ctx.fillRect(0, 0, w, h);
      ctx.textBaseline = "middle";
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 12;
      ctx.fillStyle = CYAN;
      ctx.font = `600 34px ${FONT_DISPLAY}`;
      ctx.textAlign = "left";
      ctx.fillText(`TAPE ${n}/${total}`, 26, 44);
      ctx.textAlign = "right";
      ctx.fillStyle = s.playing ? CYAN : GOLD;
      ctx.fillText(s.playing ? "PLAYING" : "PAUSED", w - 26, 44);
      ctx.fillStyle = "#eafcff";
      ctx.textAlign = "left";
      let size = 62;
      ctx.font = `700 ${size}px Rajdhani, sans-serif`;
      const name = tape.name.toUpperCase();
      while (ctx.measureText(name).width > w - 240 && size > 30) ctx.font = `700 ${(size -= 4)}px Rajdhani, sans-serif`;
      ctx.fillText(name, 26, 124);
      // volume bar
      ctx.shadowBlur = 0;
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i < Math.round(s.music * 10) ? GOLD : "rgba(232, 193, 90, 0.18)";
        ctx.fillRect(w - 196 + i * 17, 146 - i * 4.4, 11, 12 + i * 4.4);
      }
    });
    plate.draw((ctx, w, h) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = s.muted ? "#ff9d8a" : "#fff1c9";
      ctx.shadowColor = s.muted ? "#ff5b3d" : GOLD;
      ctx.shadowBlur = 10;
      ctx.font = `700 50px ${FONT_DISPLAY}`;
      ctx.fillText(s.muted ? "MUTED" : `MASTER ${pct(s.master)}`, w / 2, h / 2 + 3);
    });
  };
  refresh();
  offs.push(audio.events.on("settings", refresh));
  let alive = true;
  void fontsReady().then(() => alive && refresh());

  const dialAngle = (v: number) => THREE.MathUtils.degToRad((0.5 - v) * 270);
  dial.rotation.z = dialAngle(audio.settings.master);
  knob.rotation.z = dialAngle(audio.settings.music);
  lever.rotation.x = audio.settings.muted ? 0.6 : -0.6;
  let spin = 0;

  return {
    points,
    update(dt) {
      const s = audio.settings;
      const k = 1 - Math.exp(-dt * 14);
      dial.rotation.z += (dialAngle(s.master) - dial.rotation.z) * k;
      knob.rotation.z += (dialAngle(s.music) - knob.rotation.z) * k;
      lever.rotation.x += ((s.muted ? 0.6 : -0.6) - lever.rotation.x) * k;
      // the reels turn only while the tape is really running (a first key or click starts the sound)
      spin += ((s.playing && audio.unlocked ? 1 : 0) - spin) * (1 - Math.exp(-dt * 3));
      reels[0].rotation.z -= dt * 1.9 * spin;
      reels[1].rotation.z -= dt * 1.4 * spin;
      for (const key of Object.values(keys)) {
        const pressed = (key.userData.pressed as number) || 0;
        key.position.z = FRONT + 0.025 - 0.014 * pressed;
        key.userData.pressed = Math.max(0, pressed - dt * 6);
      }
    },
    dispose() {
      alive = false;
      for (const off of offs) off();
      for (const l of labels) l.dispose();
    },
  };
}
