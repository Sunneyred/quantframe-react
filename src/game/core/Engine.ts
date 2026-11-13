import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { bakeEnvironment } from "../art/env";
import { applyTier, type Tier } from "../art/glass";
import { Palette } from "../art/materials";
import { DOF, FINISH } from "../art/post";
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
 *        -> interaction focus -> screen culling -> WebGL render -> CSS3D render.
 *
 * Render, LOW: one pass straight to the canvas (tone mapped in the materials), no post.
 * Render, HIGH: scene -> half-float MSAA target with a depth texture (glass show pieces add
 *   three's transmission pass) -> depth of field (only while docked) -> bloom -> output (ACES)
 *   -> finish (the scene's alpha back, vignette). See art/post.ts.
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
const FLOOR_RADIUS = 12.5;

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
  quality: Quality;
  room: Room | null = null;

  private root: HTMLDivElement;
  private reticle: HTMLDivElement;
  private systems = new Set<System>();
  private composer: EffectComposer | null = null;
  private baseRT: THREE.WebGLRenderTarget | null = null;
  private bloom: UnrealBloomPass | null = null;
  private dof: ShaderPass | null = null;
  /** 0..1, eased: how far the view is settled on a docked screen (drives the depth of field). */
  private dockBlend = 0;
  private dockedId: string | null = null;
  private fwd = new THREE.Vector3();
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

    this.envRT = bakeEnvironment(this.renderer, this.palette.env);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.5;

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
  }

  get element() {
    return this.root;
  }

  get elapsed() {
    return this.time;
  }

  /**
   * Never serialise the world. Vite's dev client forwards console output by JSON-stringifying its
   * arguments; a logged DOM node reaches the engine through React, and three's toJSON would write
   * out every vertex and texture (gigabytes, enough to get the test browser killed).
   */
  toJSON() {
    return {};
  }

  setRoom(room: Room) {
    const mute = (o: THREE.Object3D) => ((o as { toJSON: unknown }).toJSON = () => ({ object: {} }));
    mute(this.scene);
    mute(this.cssScene);
    for (const c of this.scene.children) mute(c);
    this.room = room;
    applyTier(this.scene, this.quality === "high");
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
    this.dof = null;
    // show glass (transmission) on high, the cheap glass shader on low
    applyTier(this.scene, high);
    if (!high) return;
    this.baseRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
    const composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    const copy = new ShaderPass(CopyShader, "tUnused");
    copy.uniforms.tDiffuse.value = this.baseRT.texture;
    composer.addPass(copy);
    this.dof = new ShaderPass(DOF);
    this.dof.uniforms.tDepth.value = this.baseRT.depthTexture;
    this.dof.enabled = false;
    composer.addPass(this.dof);
    // restrained: only the lamps, the lit glass and the liquid cross the threshold
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.55, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    const fix = new ShaderPass(FINISH);
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
    this.dockedId = id;
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
    this.palette.update(t);
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
    this.focus(dt);
    if (render) this.render();
  }

  /** Depth of field follows the docking flight: focus on the docked screen's plane, blur by distance from it. */
  private focus(dt: number) {
    const target = this.dockedId ? 1 : 0;
    this.dockBlend = THREE.MathUtils.clamp(this.dockBlend + (target ? dt : -dt) / 0.7, 0, 1);
    const dof = this.dof;
    if (!dof) return;
    const s = this.dockedId ? this.screens.get(this.dockedId) : null;
    dof.enabled = this.dockBlend > 0.01;
    if (!dof.enabled) return;
    const k = this.dockBlend * this.dockBlend * (3 - 2 * this.dockBlend);
    const u = dof.uniforms;
    if (s) {
      this.camera.getWorldDirection(this.fwd);
      u.uFocus.value = Math.max(0.2, this.eye.copy(s.center).sub(this.camera.position).dot(this.fwd));
      // the sharp slab covers the screen, its bezel and the furniture it stands on
      u.uDead.value = 0.25 + Math.max(s.width, s.height) * 0.12;
      u.uRange.value = 2.5 + u.uFocus.value * 1.2;
    }
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uRadius.value = k * 9 * this.renderer.getPixelRatio() * (this.size.h / 800);
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
    this.dof?.uniforms.uTexel.value.set(1 / Math.max(1, Math.floor(w * pr)), 1 / Math.max(1, Math.floor(h * pr)));
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
      // both tiers of a tiered mesh, whichever is on it now
      const tier = (o.userData as { tier?: Tier }).tier;
      if (tier) {
        collect(tier.low);
        if (tier.made) collect(tier.made);
      }
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(collect);
      else if (mat) collect(mat);
    });
    for (const m of this.palette.all()) collect(m);
    for (const t of this.palette.ownTextures()) textures.add(t);
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
