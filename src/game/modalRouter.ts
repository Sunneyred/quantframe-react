import { closeAllModals } from "@mantine/modals";
import * as THREE from "three";
import type { Engine } from "./core/Engine";
import { CSS_SCALE } from "./core/screens";

/**
 * Mantine modals opened by the app while the game is mounted, routed into the world.
 *
 * The app's ModalsProvider renders every modal through Mantine's Portal, which by default puts it
 * in one shared portal node appended to <body> (`[data-mantine-shared-portal-node]`). React only
 * holds a reference to that container node, not to where it sits in the document, so the game can
 * move the whole node: when a modal appears in it, the node is moved into the content of an
 * in-world "Comms" screen, the screen is placed in front of the camera (or just in front of the
 * screen that is engaged) and docked, so the modal is read and operated in the world. Inside the
 * screen's 3D transform, Mantine's `position: fixed` overlay is contained by the screen, so the
 * modal is centred on it. When the last modal closes, the node goes back to <body>, the Comms
 * screen hides and the previous screen is engaged again. Disengaging the Comms screen (Esc)
 * closes the open modals. On unmount the node is always put back first.
 *
 * Only portals without their own target live in the shared node: popovers opened on the game's
 * screens already target their screen (see GameCore), the hidden app shell opens nothing while the
 * game covers it, and notifications are captured separately (notify.ts).
 */

const SHARED = "[data-mantine-shared-portal-node]";
/** An open modal: Mantine keeps an empty root mounted while closed, the content only exists while open. */
const MODAL = ".mantine-Modal-root .mantine-Modal-content";

export class ModalRouter {
  private node: HTMLElement | null = null;
  private nodeObs: MutationObserver | null = null;
  private bodyObs: MutationObserver;
  private open = false;
  private prevDock: string | null = null;
  private dismissed = false;
  private offDock: () => void;
  private disposed = false;

  constructor(
    private engine: Engine,
    private screenId: string,
  ) {
    this.bodyObs = new MutationObserver(() => this.attach());
    this.bodyObs.observe(document.body, { childList: true });
    this.offDock = engine.events.on("dock", (id) => this.onDock(id));
    this.attach();
  }

  /** Find the shared portal node (Mantine creates it lazily) and watch it. */
  private attach() {
    if (this.disposed) return;
    const node = (document.querySelector(SHARED) as HTMLElement | null) ?? this.node;
    if (node && node !== this.node) {
      this.nodeObs?.disconnect();
      this.node = node;
      this.nodeObs = new MutationObserver(() => this.sync());
      this.nodeObs.observe(node, { childList: true, subtree: true });
    }
    this.sync();
  }

  private get screen() {
    return this.engine.screens.get(this.screenId) ?? null;
  }

  private sync() {
    if (this.disposed || !this.node) return;
    const has = !!this.node.querySelector(MODAL);
    if (has && !this.open) this.show();
    else if (!has && this.open) this.hide();
  }

  private show() {
    const screen = this.screen;
    if (!screen || !this.node) return;
    this.open = true;
    this.dismissed = false;
    const { screens, camera } = this.engine;
    const docked = screens.docked;
    this.prevDock = docked && docked.id !== this.screenId ? docked.id : null;
    // how far the camera stands from a screen of this size when it is engaged
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const reach = (w: number, h: number, fill: number) => Math.max(h / 2 / (tanV * fill), w / 2 / (tanV * camera.aspect * fill));
    const base = (this.base ??= { w: screen.width, h: screen.height });
    const own = reach(base.w, base.h, screen.spec.fill ?? 0.84);
    if (docked && docked.id !== this.screenId) {
      // Just in front of the engaged screen, same orientation, and sized so that the camera hardly
      // moves: the display is read from where the camera already is. (At its full size the camera,
      // a hand's width from it, would see its DOM magnified several times for the length of the
      // flight back, which costs the browser seconds and a great deal of memory.)
      const gap = 0.06;
      const from = reach(docked.width, docked.height, docked.spec.fill ?? 0.84);
      this.resize(THREE.MathUtils.clamp((from - gap) / own, 0.12, 1));
      const pos = docked.center.clone().addScaledVector(docked.normal, gap);
      const yaw = Math.atan2(docked.normal.x, docked.normal.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(docked.normal.y, -1, 1));
      screens.place(this.screenId, pos, yaw, pitch);
    } else {
      // in front of the player, at eye height, facing them. The player's pose is used, not the
      // camera's: at boot (update and terms dialogs open before the first frame) the camera has no
      // pose yet, and in third person it trails behind. The distance shrinks when something solid
      // is in the way, so the display never ends up inside a wall or the reservoir.
      const { player, world } = this.engine;
      const eye = player.eye(new THREE.Vector3());
      const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      const want = 1.6;
      const clear = world.sweep({ x: eye.x, z: eye.z }, { x: eye.x + fwd.x * (want + 0.4), z: eye.z + fwd.z * (want + 0.4) }, 0.2);
      const dist = Math.max(0.6, Math.min(want, (want + 0.4) * clear - 0.3));
      // full size when there is room; smaller when it is close, so the camera never backs into a wall
      this.resize(Math.min(1, dist / own));
      const pos = eye.clone().addScaledVector(fwd, dist);
      pos.y = Math.max(1.2, eye.y - 0.05);
      screens.place(this.screenId, pos, Math.atan2(-fwd.x, -fwd.z));
    }
    this.onShow?.();
    screen.content.appendChild(this.node);
    screens.setHidden(this.screenId, false);
    if (screens.busy) screens.switchDock(this.screenId, camera);
    else screens.dock(this.screenId);
  }

  private base: { w: number; h: number } | null = null;

  /** Scale the display in the world (hole, bezel and DOM plane together); its DOM size is unchanged. */
  private resize(k: number) {
    const screen = this.screen;
    if (!screen || !this.base) return;
    const pw = parseFloat(screen.element.style.width) || screen.spec.px[0];
    screen.anchor.scale.setScalar(k);
    screen.width = this.base.w * k;
    screen.height = this.base.h * k;
    screen.css.scale.setScalar((screen.width / pw) * CSS_SCALE);
  }

  private hide() {
    this.open = false;
    if (this.node && this.node.parentElement !== document.body) document.body.appendChild(this.node);
    const { screens, camera } = this.engine;
    const back = this.dismissed ? null : this.prevDock;
    this.prevDock = null;
    if (screens.docked?.id === this.screenId || screens.busy) {
      if (back) screens.switchDock(back, camera);
      else screens.undock();
    }
    screens.setHidden(this.screenId, true);
  }

  /**
   * True while a modal that must be answered is open (the app opened it with closeOnEscape off:
   * the terms of service, a forced update). Disengaging the display then does not dismiss it.
   */
  locked = false;
  /** Called just before the display is shown (GameCore sizes it to the window). */
  onShow: (() => void) | null = null;

  private onDock(id: string | null) {
    if (id === null && this.open && this.locked) {
      // Esc does not close this modal in the classic view either: stay on the display
      // (after this event has reached every listener, so they see "undocked" then "docked" in order)
      queueMicrotask(() => {
        if (!this.disposed && this.open && this.locked) this.engine.screens.dock(this.screenId);
      });
      return;
    }
    // Esc or Disengage on the comms screen while a modal is up: close the modals
    if (id === null && this.open) {
      this.dismissed = true;
      try {
        closeAllModals();
      } catch {
        /* no ModalsProvider (standalone page) */
      }
    }
  }

  get isOpen() {
    return this.open;
  }

  /** Put the shared portal node back in <body>. Call before the engine removes its DOM. */
  dispose() {
    this.disposed = true;
    this.offDock();
    this.bodyObs.disconnect();
    this.nodeObs?.disconnect();
    if (this.node && this.node.parentElement !== document.body) document.body.appendChild(this.node);
    this.node = null;
  }
}
