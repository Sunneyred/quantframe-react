import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import type { Palette } from "../art/materials";
import type { InteractSystem } from "./interact";

/**
 * Diegetic screens: real DOM (React via portals) on in-world planes.
 *
 * Layering: the CSS3DRenderer's layer sits BEHIND the transparent WebGL canvas. Each screen has a
 * "hole" mesh in the WebGL scene at exactly the screen's rectangle that writes colour (0,0,0,0) and
 * depth. Where nothing is in front of it, the canvas is transparent there and the DOM shows through;
 * where geometry is in front (a pillar, a customer, the player's own avatar), that geometry is drawn
 * over the hole and hides the DOM, so occlusion is exact per pixel and costs one quad per screen.
 * The post-processing chain keeps the scene's alpha for this (see Engine). Screens facing away or
 * outside the view frustum are display:none (CSS3DRenderer honours `visible`).
 *
 * The canvas never takes pointer events. The CSS layer takes none either, except the docked screen,
 * so the mouse operates the DOM only while docked; otherwise clicks land on the world.
 *
 * Docking: `dock(id)` flies the camera to a pose square in front of the screen, sized so the screen
 * fills `fill` of the view (the room stays visible at the edges). `undock()` flies back to wherever
 * the player's camera is. `blend` (0..1) is how far along the flight is.
 */

export interface ScreenSpec {
  id: string;
  /** Shown on the bezel and in the interaction hint. */
  title: string;
  /** DOM size in CSS pixels. */
  px: [number, number];
  /** World width in metres (height follows the pixel aspect). */
  width: number;
  position: THREE.Vector3;
  /** Rotation about Y; the screen faces local +Z, so its normal is (sin yaw, 0, cos yaw). */
  yaw: number;
  /** Tilt back (radians, positive = facing up). */
  pitch?: number;
  dockable?: boolean;
  verb?: string;
  reach?: number;
  /** Fraction of the view the docked screen fills. */
  fill?: number;
  /** A gold-and-steel WebGL bezel around the rectangle. */
  bezel?: boolean;
  /** Extra classes on the DOM root (styling only). */
  className?: string;
}

export interface Screen {
  id: string;
  spec: ScreenSpec;
  /** The CSS3D element (do not render into it). */
  element: HTMLDivElement;
  /** Portal target for the screen's React content. */
  content: HTMLDivElement;
  css: CSS3DObject;
  anchor: THREE.Group;
  hole: THREE.Mesh;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  width: number;
  height: number;
}

/** The CSS3D scene is kept in centimetres (world metres x CSS_SCALE), so element matrices stay in pixel-like ranges. */
export const CSS_SCALE = 100;

type DockState = { screen: Screen; target: number; blend: number; pos: THREE.Vector3; quat: THREE.Quaternion };

const ease = (t: number) => t * t * (3 - 2 * t);

export class ScreenManager {
  readonly list: Screen[] = [];
  private byId = new Map<string, Screen>();
  private holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, side: THREE.FrontSide });
  private dockState: DockState | null = null;
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private tmp = new THREE.Vector3();
  private unregister: Array<() => void> = [];

  constructor(
    private scene: THREE.Scene,
    private cssScene: THREE.Scene,
    private palette: Palette,
    private interact: InteractSystem,
    private onDock: (id: string | null) => void,
  ) {}

  add(spec: ScreenSpec, parent: THREE.Object3D = this.scene): Screen {
    const [pw, ph] = spec.px;
    const width = spec.width;
    const height = (width * ph) / pw;
    const element = document.createElement("div");
    element.className = `vtg-screen ${spec.className ?? ""}`;
    element.dataset.screen = spec.id;
    element.style.width = `${pw}px`;
    element.style.height = `${ph}px`;
    const content = document.createElement("div");
    content.className = "vtg-screen-content";
    element.appendChild(content);
    const css = new CSS3DObject(element);
    // CSS3DObject turns pointer events on; the manager decides
    element.style.pointerEvents = "none";
    css.scale.setScalar((width / pw) * CSS_SCALE);
    this.cssScene.add(css);

    const anchor = new THREE.Group();
    anchor.name = `screen:${spec.id}`;
    anchor.position.copy(spec.position);
    anchor.rotation.set(-(spec.pitch ?? 0), spec.yaw, 0, "YXZ");
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.holeMat);
    hole.name = "screen-hole";
    anchor.add(hole);
    if (spec.bezel !== false) anchor.add(this.bezel(width, height));
    parent.add(anchor);
    anchor.updateWorldMatrix(true, true);

    const screen: Screen = { id: spec.id, spec, element, content, css, anchor, hole, center: new THREE.Vector3(), normal: new THREE.Vector3(), width, height };
    this.syncTransform(screen);
    this.list.push(screen);
    this.byId.set(spec.id, screen);

    if (spec.dockable) {
      const r = Math.max(width, height) * 0.5;
      this.unregister.push(
        this.interact.add({
          id: `screen:${spec.id}`,
          label: spec.title,
          verb: spec.verb ?? "Engage",
          position: screen.center.clone(),
          radius: r,
          reach: spec.reach ?? 4.2,
          hint: screen.center.clone().addScaledVector(screen.normal, 0.25).add(new THREE.Vector3(0, -height * 0.5 - 0.12, 0)),
          enabled: () => !this.dockState,
          onUse: () => this.dock(spec.id),
        }),
      );
    }
    return screen;
  }

  get(id: string) {
    return this.byId.get(id);
  }

  private bezel(w: number, h: number): THREE.Group {
    const g = new THREE.Group();
    const b = 0.06;
    const outer = new THREE.Shape();
    outer.moveTo(-w / 2 - b, -h / 2 - b);
    outer.lineTo(w / 2 + b, -h / 2 - b);
    outer.lineTo(w / 2 + b, h / 2 + b);
    outer.lineTo(-w / 2 - b, h / 2 + b);
    outer.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-w / 2, -h / 2);
    hole.lineTo(-w / 2, h / 2);
    hole.lineTo(w / 2, h / 2);
    hole.lineTo(w / 2, -h / 2);
    hole.closePath();
    outer.holes.push(hole);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.03, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), this.palette.gold);
    frame.position.z = -0.03;
    g.add(frame);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + b * 2, h + b * 2, 0.05), this.palette.steel);
    back.position.z = -0.045;
    g.add(back);
    // cyan hairline just outside the glass
    const lineGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w + 0.024, h + 0.024));
    const line = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(0x2ad4e6).multiplyScalar(2), toneMapped: false }));
    line.position.z = 0.004;
    g.add(line);
    // corner studs
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const stud = new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), this.palette.gold);
      stud.position.set(x * (w / 2 + b * 0.5), y * (h / 2 + b * 0.5), 0.01);
      stud.scale.z = 0.4;
      g.add(stud);
    }
    return g;
  }

  private syncTransform(s: Screen) {
    s.anchor.updateWorldMatrix(true, false);
    s.anchor.matrixWorld.decompose(s.css.position, s.css.quaternion, this.tmp);
    s.css.position.multiplyScalar(CSS_SCALE);
    s.center.setFromMatrixPosition(s.anchor.matrixWorld);
    s.normal.set(0, 0, 1).transformDirection(s.anchor.matrixWorld);
  }

  get docked(): Screen | null {
    return this.dockState && this.dockState.target === 1 ? this.dockState.screen : null;
  }

  /** True while docked or flying in or out: the player has no control. */
  get busy(): boolean {
    return this.dockState !== null;
  }

  dock(id: string) {
    const s = this.byId.get(id);
    if (!s || !s.spec.dockable) return;
    if (this.dockState && this.dockState.screen !== s) return;
    this.dockState = { screen: s, target: 1, blend: this.dockState?.blend ?? 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    s.element.classList.add("is-docked");
    s.element.style.pointerEvents = "auto";
    this.onDock(id);
  }

  undock() {
    const st = this.dockState;
    if (!st || st.target === 0) return;
    st.target = 0;
    st.screen.element.classList.remove("is-docked");
    st.screen.element.style.pointerEvents = "none";
    const active = document.activeElement;
    if (active instanceof HTMLElement && st.screen.element.contains(active)) active.blur();
    this.onDock(null);
  }

  /** Dock pose: square in front of the screen, far enough back for the screen to fill `fill` of the view. */
  private dockPose(s: Screen, camera: THREE.PerspectiveCamera, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
    const fill = s.spec.fill ?? 0.84;
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const dh = s.height / 2 / (tanV * fill);
    const dw = s.width / 2 / (tanV * camera.aspect * fill);
    const d = Math.max(dh, dw);
    outPos.copy(s.center).addScaledVector(s.normal, d);
    const m = new THREE.Matrix4().lookAt(outPos, s.center, new THREE.Vector3(0, 1, 0));
    outQuat.setFromRotationMatrix(m);
  }

  /**
   * Blend the camera between the player's pose and the docked pose.
   * Call after the player wrote its pose into camera.position/quaternion.
   */
  applyDock(camera: THREE.PerspectiveCamera, dt: number) {
    const st = this.dockState;
    if (!st) return;
    const speed = 1 / 0.7;
    st.blend = THREE.MathUtils.clamp(st.blend + (st.target === 1 ? dt : -dt) * speed, 0, 1);
    this.dockPose(st.screen, camera, st.pos, st.quat);
    const k = ease(st.blend);
    camera.position.lerp(st.pos, k);
    camera.quaternion.slerp(st.quat, k);
    if (st.target === 0 && st.blend <= 0) this.dockState = null;
  }

  /** Per frame: hide screens that face away or are off-view. */
  update(camera: THREE.PerspectiveCamera) {
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    const docked = this.dockState?.screen;
    for (const s of this.list) {
      this.syncTransform(s);
      const toCam = this.tmp.copy(camera.position).sub(s.center);
      const facing = toCam.dot(s.normal) > 0.02;
      this.sphere.set(s.center, Math.hypot(s.width, s.height) / 2);
      // CSS3DRenderer only inserts an element into the page the first time it is visible, so every
      // screen is shown once up front: then all screen DOM is in the document from the start
      const vis = !this.primed || s === docked || (facing && this.frustum.intersectsSphere(this.sphere));
      s.css.visible = vis;
    }
    this.primedFrames++;
  }

  private primedFrames = 0;
  private get primed() {
    return this.primedFrames > 1;
  }

  dispose() {
    for (const u of this.unregister.splice(0)) u();
    for (const s of this.list) {
      s.css.removeFromParent();
      s.element.remove();
    }
    this.list.length = 0;
    this.byId.clear();
    this.holeMat.dispose();
    this.dockState = null;
  }
}
