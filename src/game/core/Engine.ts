import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { Palette } from "../art/materials";
import { AudioSystem } from "../audio/AudioSystem";
import { makePlayerAvatar } from "../entities/figures";
import { CollisionWorld } from "./collision";
import { Emitter, store, stored } from "./events";
import { Input } from "./input";
import { InteractSystem } from "./interact";
import { Player, type ViewMode } from "./player";
import { guessQuality, saveQuality, storedQuality, type Quality } from "./quality";
import { CSS_SCALE, ScreenManager } from "./screens";

/**
 * The engine: one WebGL canvas, one CSS3D layer, a scene graph, a player, the screen system,
 * the interaction system and a list of per-frame systems. Rooms build into it (see rooms/).
 *
 * Scene graph:
 *   scene
 *    ├─ sky (far-plane nebula)            ├─ room groups (built by a Room)
 *    ├─ player avatar                     ├─ screen anchors (hole + bezel), parented where the room put them
 *    └─ interaction hint sprite
 *   cssScene: one CSS3DObject per screen, transforms copied from the anchors every frame.
 *
 * Frame: input -> player -> systems (room animation) -> camera pose (player, blended by docking)
 *        -> interaction focus -> screen culling -> WebGL render (+ bloom on high) -> CSS3D render.
 */

export interface EngineEvents {
  dock: string | null;
  quality: Quality;
  view: ViewMode;
  lock: boolean;
  /** Debug keys (G sale, B buyer, N notification). */
  debug: "sale" | "buyer" | "notify";
  stats: EngineStats;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  calls: number;
  triangles: number;
  textures: number;
  geometries: number;
}

export type System = (dt: number, t: number) => void;

export interface Room {
  id: string;
  spawn: { x: number; z: number; yaw: number };
  update(dt: number, t: number): void;
  dispose?(): void;
}

const VIEW_KEY = "vt_game_view";
const FLOOR_RADIUS = 12;

const ALPHA_FIX = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tBase: { value: null as THREE.Texture | null } },
  vertexShader: CopyShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBase;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float a = clamp(texture2D(tBase, vUv).a, 0.0, 1.0);
      // where a screen shows through (a = 0) let only a little bloom spill over it, premultiplied
      gl_FragColor = vec4(c.rgb * mix(0.3, 1.0, a), a);
    }`,
};

export class Engine {
  readonly events = new Emitter<EngineEvents>();
  readonly scene = new THREE.Scene();
  readonly cssScene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly css: CSS3DRenderer;
  readonly palette: Palette;
  readonly world = new CollisionWorld();
  readonly input: Input;
  readonly player: Player;
  readonly interact: InteractSystem;
  readonly screens: ScreenManager;
  /** Sound (audio/AudioSystem.ts): context, buses, listener, music, one-shots. */
  readonly audio: AudioSystem;
  quality: Quality;
  room: Room | null = null;

  private root: HTMLDivElement;
  private reticle: HTMLDivElement;
  private systems = new Set<System>();
  private composer: EffectComposer | null = null;
  private baseRT: THREE.WebGLRenderTarget | null = null;
  private bloom: UnrealBloomPass | null = null;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private disposed = false;
  private resizeObs: ResizeObserver;
  private size = { w: 1, h: 1 };
  private statAcc = { frames: 0, ms: 0, since: 0 };
  stats: EngineStats = { fps: 0, frameMs: 0, calls: 0, triangles: 0, textures: 0, geometries: 0 };
  private cssCamera = new THREE.PerspectiveCamera();
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private eye = new THREE.Vector3();

  constructor(host: HTMLElement, opts: { quality?: Quality } = {}) {
    this.root = document.createElement("div");
    this.root.className = "vtg-root";
    this.root.tabIndex = -1;
    host.appendChild(this.root);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x050412, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.className = "vtg-canvas";
    this.css = new CSS3DRenderer();
    this.css.domElement.className = "vtg-css";
    // the DOM layer goes under the canvas: screens show through the canvas's transparent holes
    this.root.appendChild(this.css.domElement);
    this.root.appendChild(this.renderer.domElement);
    this.reticle = document.createElement("div");
    this.reticle.className = "vtg-reticle";
    this.root.appendChild(this.reticle);

    this.quality = opts.quality ?? storedQuality() ?? guessQuality(this.renderer.getContext());
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 1200);
    this.palette = new Palette(FLOOR_RADIUS);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.envRT = pmrem.fromScene(env, 0.04);
    env.dispose();
    pmrem.dispose();
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.22;

    this.interact = new InteractSystem(this.scene);
    this.screens = new ScreenManager(this.scene, this.cssScene, this.palette, this.interact, (id) => this.onDockChange(id));
    const avatar = makePlayerAvatar(this.palette);
    this.scene.add(avatar.root);
    this.player = new Player(avatar, this.world);
    this.player.view = stored(VIEW_KEY) === "third" ? "third" : "first";

    this.input = new Input(this.root, {
      onKey: (code, e, typing) => this.onKey(code, e, typing),
      onWorldClick: () => this.onWorldClick(),
      onLockChange: (locked) => {
        this.root.classList.toggle("is-locked", locked);
        this.events.emit("lock", locked);
      },
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.root);
    this.applyQuality();
    this.resize();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.audio = new AudioSystem(this);
  }

  get element() {
    return this.root;
  }

  get elapsed() {
    return this.time;
  }

  setRoom(room: Room) {
    this.room = room;
    this.player.place(room.spawn.x, room.spawn.z, room.spawn.yaw);
  }

  addSystem(fn: System): () => void {
    this.systems.add(fn);
    return () => this.systems.delete(fn);
  }

  // ---------------------------------------------------------------------------
  // Quality and view
  // ---------------------------------------------------------------------------

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    saveQuality(q);
    this.applyQuality();
    this.resize();
    this.events.emit("quality", q);
  }

  private applyQuality() {
    const high = this.quality === "high";
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(high ? Math.min(dpr, 2) : Math.min(dpr, 1) * 0.85);
    this.composer?.dispose();
    this.baseRT?.dispose();
    this.composer = null;
    this.baseRT = null;
    this.bloom = null;
    if (!high) return;
    this.baseRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    const copy = new ShaderPass(CopyShader, "tUnused");
    copy.uniforms.tDiffuse.value = this.baseRT.texture;
    composer.addPass(copy);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 0.9);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    const fix = new ShaderPass(ALPHA_FIX);
    fix.uniforms.tBase.value = this.baseRT.texture;
    composer.addPass(fix);
    this.composer = composer;
  }

  setView(v: ViewMode) {
    if (v === this.player.view) return;
    this.player.view = v;
    store(VIEW_KEY, v);
    this.events.emit("view", v);
  }

  toggleView() {
    this.setView(this.player.view === "first" ? "third" : "first");
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onKey(code: string, e: KeyboardEvent, typing: boolean) {
    if (code === "Escape") {
      if (this.screens.busy) {
        e.preventDefault();
        this.screens.undock();
      }
      return;
    }
    if (typing || this.screens.busy) return;
    switch (code) {
      case "KeyE":
        this.use();
        break;
      case "KeyV":
        this.toggleView();
        break;
      case "KeyG":
        this.events.emit("debug", "sale");
        break;
      case "KeyB":
        this.events.emit("debug", "buyer");
        break;
      case "KeyN":
        if (import.meta.env.DEV) this.events.emit("debug", "notify");
        break;
    }
  }

  private onWorldClick() {
    if (this.screens.busy) return;
    if (!this.input.locked) {
      this.input.requestLock();
      // a click while aiming at something also uses it, so it works without pointer lock too
      if (this.interact.focused) this.use();
      return;
    }
    this.use();
  }

  use() {
    const f = this.interact.focused;
    if (f) f.onUse();
  }

  private onDockChange(id: string | null) {
    this.input.uiMode = id !== null;
    this.root.classList.toggle("is-docked", id !== null);
    if (id) {
      this.input.releaseLock();
      this.input.keys.clear();
    }
    this.events.emit("dock", id);
  }

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  start() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.step(dt);
    const ms = performance.now() - now;
    const acc = this.statAcc;
    acc.frames++;
    acc.ms += ms;
    if (now - acc.since > 1000) {
      const info = this.renderer.info;
      this.stats = {
        fps: Math.round((acc.frames * 1000) / (now - acc.since || 1)),
        frameMs: +(acc.ms / acc.frames).toFixed(2),
        calls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
      };
      acc.frames = 0;
      acc.ms = 0;
      acc.since = now;
      this.events.emit("stats", this.stats);
    }
  };

  /** One simulation (+ render) step. Public so tests can step deterministically. */
  step(dt: number, render = true) {
    this.time += dt;
    const t = this.time;
    const control = !this.screens.busy;
    this.player.update(dt, this.input, control, t);
    this.room?.update(dt, t);
    for (const s of this.systems) s(dt, t);

    this.player.cameraPose(this.camPos, this.camQuat, dt);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
    this.screens.applyDock(this.camera, dt);
    this.camera.updateMatrixWorld();
    this.player.avatar.root.visible = this.player.view === "third";

    this.interact.update(this.camera, this.player.eye(this.eye), control, t);
    this.screens.update(this.camera);
    this.audio.update(dt);
    if (render) this.render();
  }

  private render() {
    this.renderer.info.reset();
    if (this.composer && this.baseRT) {
      this.renderer.setRenderTarget(this.baseRT);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.composer.render();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    // the CSS scene is in centimetres (see screens.ts): same view, scaled camera
    const c = this.cssCamera;
    c.fov = this.camera.fov;
    c.aspect = this.camera.aspect;
    c.near = this.camera.near * CSS_SCALE;
    c.far = this.camera.far * CSS_SCALE;
    c.updateProjectionMatrix();
    c.position.copy(this.camera.position).multiplyScalar(CSS_SCALE);
    c.quaternion.copy(this.camera.quaternion);
    c.updateMatrixWorld();
    this.css.render(this.cssScene, c);
  }

  private resize() {
    const w = Math.max(1, this.root.clientWidth);
    const h = Math.max(1, this.root.clientHeight);
    this.size = { w, h };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.css.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.baseRT?.setSize(Math.floor(w * pr), Math.floor(h * pr));
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    if (!this.running && !this.disposed && this.room) this.step(0);
  }

  get viewport() {
    return this.size;
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.audio.dispose();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObs.disconnect();
    this.input.dispose(); // releases pointer lock
    this.room?.dispose?.();
    this.screens.dispose();
    this.interact.dispose();
    this.systems.clear();
    this.events.clear();
    const textures = new Set<THREE.Texture>();
    const collect = (m: THREE.Material) => {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u) for (const k of Object.keys(u)) if (u[k].value instanceof THREE.Texture) textures.add(u[k].value);
      m.dispose();
    };
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(collect);
      else if (mat) collect(mat);
    });
    for (const m of Object.values(this.palette)) if (m instanceof THREE.Material) collect(m);
    if (this.palette.dot) textures.add(this.palette.dot);
    for (const t of textures) t.dispose();
    this.composer?.dispose();
    this.baseRT?.dispose();
    this.envRT?.dispose();
    this.scene.clear();
    this.cssScene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
  }
}
