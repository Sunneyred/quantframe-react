/** Keyboard, mouse and pointer lock for the game. Keys typed into a DOM field on a screen never reach the game. */

export const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export interface InputHandlers {
  /** Edge-triggered key press (no auto-repeat). `typing` is true when the key went to a text field. */
  onKey(code: string, e: KeyboardEvent, typing: boolean): void;
  /** A click on the world itself (not on a screen's DOM). */
  onWorldClick(e: MouseEvent): void;
  onLockChange(locked: boolean): void;
}

const GAME_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"]);

export class Input {
  readonly keys = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** True while a screen is docked: the DOM owns the mouse and keyboard. */
  uiMode = false;
  private disposed = false;

  constructor(
    private root: HTMLElement,
    private handlers: InputHandlers,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clear);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
    root.addEventListener("mousedown", this.onMouseDown);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const typing = isTypingTarget(e.target);
    if (!typing && !this.uiMode && GAME_KEYS.has(e.code)) {
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    }
    if (e.repeat) return;
    this.handlers.onKey(e.code, e, typing);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private clear = () => {
    this.keys.clear();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    // some browsers report a huge jump on the first event after locking
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.dx += e.movementX;
    this.dy += e.movementY;
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    // only clicks that land on the world itself, never on a screen's DOM
    if (e.target !== this.root && !(e.target as HTMLElement)?.dataset?.vtgWorld) return;
    this.handlers.onWorldClick(e);
  };

  private onLockChange = () => {
    const locked = document.pointerLockElement === this.root;
    if (locked === this.locked) return;
    this.locked = locked;
    this.dx = this.dy = 0;
    if (!locked) this.keys.clear();
    if (!this.disposed) this.handlers.onLockChange(locked);
  };

  requestLock() {
    if (this.locked || this.disposed) return;
    try {
      const r = this.root.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => undefined);
    } catch {
      /* pointer lock unavailable (headless, iframe without permission): arrow keys still turn */
    }
  }

  releaseLock() {
    try {
      if (document.pointerLockElement === this.root) document.exitPointerLock();
    } catch {
      /* nothing to release */
    }
  }

  consumeMouse(): [number, number] {
    const out: [number, number] = [this.dx, this.dy];
    this.dx = this.dy = 0;
    return out;
  }

  down(code: string) {
    return this.keys.has(code);
  }

  dispose() {
    this.disposed = true;
    this.releaseLock();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clear);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.root.removeEventListener("mousedown", this.onMouseDown);
    this.keys.clear();
  }
}
