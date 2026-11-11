/** Keyboard state for the station. Listens on window; ignores typing in form fields. */

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // a focused checkbox or button is not a text field: the station keys keep working
  if (target instanceof HTMLInputElement && ["checkbox", "radio", "button", "range"].includes(target.type)) return false;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** True while an app dialog (confirm prompt, details modal) is open on top of the station. */
export const dialogOpen = (): boolean => document.querySelector(".mantine-Modal-content, .mantine-Drawer-content") !== null;

export { isTyping };

export class Keyboard {
  private down = new Set<string>();
  enabled = true;

  constructor(private onPress: (code: string, key: string) => void) {
    window.addEventListener("keydown", this.handleDown);
    window.addEventListener("keyup", this.handleUp);
    window.addEventListener("blur", this.clear);
  }

  private handleDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || dialogOpen()) return;
    if (e.code in MOVE_KEYS) {
      this.down.add(e.code);
      e.preventDefault(); // arrows would scroll the page
      return;
    }
    // Tab is the quick panel, not focus traversal; the overlay keys must not also type into the field they open
    if (e.code === "Tab" || e.code === "KeyK" || e.code === "Slash" || e.code === "KeyM" || e.code === "KeyH") e.preventDefault();
    if (!e.repeat) this.onPress(e.code, e.key);
  };

  private handleUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  clear = () => {
    this.down.clear();
  };

  isDown(code: string): boolean {
    return this.enabled && this.down.has(code);
  }

  /** Top-down movement: WASD and arrows both move along the screen axes. */
  axis(): { ax: number; ay: number } {
    let ax = 0;
    let ay = 0;
    if (!this.enabled) return { ax, ay };
    for (const code of this.down) {
      const v = MOVE_KEYS[code];
      if (v) {
        ax += v[0];
        ay += v[1];
      }
    }
    return { ax: Math.sign(ax), ay: Math.sign(ay) };
  }

  destroy() {
    window.removeEventListener("keydown", this.handleDown);
    window.removeEventListener("keyup", this.handleUp);
    window.removeEventListener("blur", this.clear);
    this.down.clear();
  }
}
