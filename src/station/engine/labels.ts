import { VIEW_H, VIEW_W } from "./constants";

/**
 * Crisp DOM text laid over the low-res canvas. Positions are given in room
 * pixels and stored as percentages, so labels track the canvas at any scale;
 * font sizes use the --vt-u custom property (CSS pixels per room pixel).
 */
export class LabelLayer {
  readonly root: HTMLDivElement;
  private pos = new WeakMap<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "vt-station-labels";
    parent.appendChild(this.root);
  }

  add(className: string, text = ""): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `vt-station-label ${className}`;
    el.textContent = text;
    this.root.appendChild(el);
    return el;
  }

  remove(el: HTMLElement) {
    el.remove();
  }

  place(el: HTMLElement, x: number, y: number) {
    const key = `${Math.round(x * 2)}|${Math.round(y * 2)}`;
    if (this.pos.get(el) === key) return;
    this.pos.set(el, key);
    el.style.left = `${(x / VIEW_W) * 100}%`;
    el.style.top = `${(y / VIEW_H) * 100}%`;
  }

  text(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
  }

  show(el: HTMLElement, visible: boolean) {
    const v = visible ? "" : "none";
    if (el.style.display !== v) el.style.display = v;
  }

  destroy() {
    this.root.remove();
  }
}
