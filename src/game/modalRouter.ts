import { closeAllModals } from "@mantine/modals";
import * as THREE from "three";
import type { Engine } from "./core/Engine";

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
    if (docked && docked.id !== this.screenId) {
      // just in front of the engaged screen, same orientation
      const pos = docked.center.clone().addScaledVector(docked.normal, 0.3);
      const yaw = Math.atan2(docked.normal.x, docked.normal.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(docked.normal.y, -1, 1));
      screens.place(this.screenId, pos, yaw, pitch);
    } else {
      // in front of the camera, at eye height, facing it
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const pos = camera.position.clone().addScaledVector(fwd, 1.6);
      pos.y = Math.max(1.2, camera.position.y - 0.05);
      screens.place(this.screenId, pos, Math.atan2(-fwd.x, -fwd.z));
    }
    screen.content.appendChild(this.node);
    screens.setHidden(this.screenId, false);
    if (screens.busy) screens.switchDock(this.screenId, camera);
    else screens.dock(this.screenId);
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

  private onDock(id: string | null) {
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
