import * as THREE from "three";
import { CanvasLabel, CYAN, drawGlyph, FONT_DISPLAY, GOLD } from "../art/textures";

/**
 * Things you can look at and use. Aim is a ray from the camera centre (the reticle);
 * the nearest interactable whose sphere it crosses, within reach of the player, gets focus.
 * The hint is in the world: a small holographic glyph and label floating by the object.
 */

export interface Interactable {
  id: string;
  /** Shown in the hint, e.g. "Trade Desk". */
  label: string;
  /** Shown before the label, e.g. "ENGAGE". */
  verb: string;
  /** World centre of the aim sphere. */
  position: THREE.Vector3;
  radius: number;
  /** Max distance from the player's eye. */
  reach: number;
  /** Where the hint floats (world); defaults to above the centre. */
  hint?: THREE.Vector3;
  enabled?: () => boolean;
  onUse(): void;
}

export class InteractSystem {
  private items = new Map<string, Interactable>();
  focused: Interactable | null = null;
  readonly hint: THREE.Sprite;
  private label = new CanvasLabel(1024, 192);
  private shown = "";
  private ray = new THREE.Ray();
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const mat = new THREE.SpriteMaterial({ map: this.label.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    this.hint = new THREE.Sprite(mat);
    this.hint.scale.set(1.1, 1.1 * (192 / 1024), 1);
    this.hint.renderOrder = 50;
    this.hint.visible = false;
    this.hint.name = "interact-hint";
    scene.add(this.hint);
  }

  add(item: Interactable): () => void {
    this.items.set(item.id, item);
    return () => {
      this.items.delete(item.id);
      if (this.focused?.id === item.id) this.focused = null;
    };
  }

  get(id: string) {
    return this.items.get(id);
  }

  update(camera: THREE.Camera, eye: THREE.Vector3, active: boolean, t: number) {
    let best: Interactable | null = null;
    if (active) {
      camera.getWorldPosition(this.ray.origin);
      camera.getWorldDirection(this.ray.direction);
      let bestT = Infinity;
      for (const it of this.items.values()) {
        if (it.enabled && !it.enabled()) continue;
        if (eye.distanceTo(it.position) > it.reach + it.radius) continue;
        const d2 = this.ray.distanceSqToPoint(it.position);
        if (d2 > it.radius * it.radius) continue;
        const along = this.tmp.copy(it.position).sub(this.ray.origin).dot(this.ray.direction);
        if (along < 0) continue;
        if (along < bestT) {
          bestT = along;
          best = it;
        }
      }
    }
    this.focused = best;
    if (!best) {
      this.hint.visible = false;
      return;
    }
    const text = `${best.verb}|${best.label}`;
    if (text !== this.shown) {
      this.shown = text;
      this.drawHint(best.verb, best.label);
    }
    const at = best.hint ?? this.tmp.copy(best.position).add(new THREE.Vector3(0, best.radius * 0.6, 0));
    // pull the hint a little toward the camera so the object never swallows it
    this.hint.position.copy(at).lerp(this.ray.origin, 0.12);
    const dist = this.hint.position.distanceTo(this.ray.origin);
    const s = THREE.MathUtils.clamp(dist * 0.36, 0.55, 2.0);
    this.hint.scale.set(s, s * (192 / 1024), 1);
    (this.hint.material as THREE.SpriteMaterial).opacity = 0.85 + Math.sin(t * 4) * 0.12;
    this.hint.visible = true;
  }

  private drawHint(verb: string, label: string) {
    this.label.draw((ctx, _w, h) => {
      const cy = h / 2;
      // glyph diamond with the key
      ctx.translate(90, cy);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 5;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 18;
      ctx.strokeRect(-38, -38, 76, 76);
      ctx.fillStyle = "rgba(10, 30, 44, 0.75)";
      ctx.fillRect(-33, -33, 66, 66);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#e9fbff";
      ctx.font = `700 54px ${FONT_DISPLAY}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("E", 90, cy + 3);
      // the line out to the label
      ctx.shadowBlur = 10;
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(150, cy);
      ctx.lineTo(186, cy);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillStyle = CYAN;
      ctx.font = `600 34px ${FONT_DISPLAY}`;
      ctx.fillText(verb.toUpperCase(), 200, cy - 30);
      ctx.fillStyle = "#fff6dc";
      ctx.shadowColor = GOLD;
      ctx.font = `700 56px Rajdhani, sans-serif`;
      ctx.fillText(label.toUpperCase(), 198, cy + 26);
      // a few glyphs under it
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(42, 212, 230, 0.55)";
      ctx.fillStyle = "rgba(42, 212, 230, 0.55)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) drawGlyph(ctx, label.length * 31 + i, 200 + i * 22, cy + 62, 20);
    });
  }

  dispose() {
    this.label.dispose();
    (this.hint.material as THREE.Material).dispose();
    this.items.clear();
  }
}
