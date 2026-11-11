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
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export class Keyboard {
  private down = new Set<string>();
  enabled = true;

  constructor(private onPress: (code: string) => void) {
    window.addEventListener("keydown", this.handleDown);
    window.addEventListener("keyup", this.handleUp);
    window.addEventListener("blur", this.clear);
  }

  private handleDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.code in MOVE_KEYS) {
      this.down.add(e.code);
      e.preventDefault(); // arrows would scroll the page
      return;
    }
    if (!e.repeat) this.onPress(e.code);
  };

  private handleUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  clear = () => {
    this.down.clear();
  };

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
