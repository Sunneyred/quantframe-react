import * as THREE from "three";
import type { Palette } from "../../art/materials";
import { polar } from "../../art/kit";
import { CanvasLabel, CYAN, FONT_DISPLAY, GOLD } from "../../art/textures";
import type { InteractSystem } from "../../core/interact";
import { makeCustomer, type CustomerFigure } from "../../entities/figures";
import type { Buyer } from "../../../station/engine/logic";

/**
 * Buyers as figures: each queued buyer walks in through the customers' arch, along the wall to
 * their place in the line at the trade desk, and waits; a dismissed buyer walks back out.
 * Each waiting figure carries a small hologram with its place and name, and can be looked at
 * to serve it (which docks the desk screen with that buyer selected).
 */

export const DOOR_DEG = 60;
/** Where the line starts (the desk's customer side) and how it runs. */
const slotPos = (k: number) => (k === 0 ? polar(93.4, 9.3) : polar(104 + (k - 1) * 8, 10.2));
const OUTSIDE = polar(DOOR_DEG, 17);
const DOORWAY = polar(DOOR_DEG, 11.0);
const LANE = polar(78, 10.2);
const SPEED = 1.35;

interface Walker {
  id: string;
  name: string;
  fig: CustomerFigure;
  path: THREE.Vector3[];
  leaving: boolean;
  slot: number;
  tag: CanvasLabel;
  tagSprite: THREE.Sprite;
  tagKey: string;
  ring: THREE.Mesh;
  speed: number;
  unregister: () => void;
  facing: number;
}

export class Customers {
  readonly group = new THREE.Group();
  private walkers = new Map<string, Walker>();
  private selected: string | null = null;

  constructor(
    private p: Palette,
    private interact: InteractSystem,
    private onServe: (id: string) => void,
  ) {
    this.group.name = "customers";
  }

  get count() {
    return [...this.walkers.values()].filter((w) => !w.leaving).length;
  }

  setQueue(queue: Buyer[], selected: string | null) {
    this.selected = selected;
    const ids = new Set(queue.map((b) => b.id));
    for (const w of this.walkers.values()) {
      if (!ids.has(w.id) && !w.leaving) this.leave(w);
    }
    queue.forEach((b, k) => {
      let w = this.walkers.get(b.id);
      if (!w || w.leaving) {
        if (w) this.remove(w);
        w = this.spawn(b, k);
      } else if (w.slot !== k) {
        w.slot = k;
        w.path = [slotPos(k)];
      }
      this.drawTag(w, k);
    });
  }

  private spawn(b: Buyer, slot: number): Walker {
    const fig = makeCustomer(this.p, b.name);
    fig.root.position.copy(OUTSIDE);
    this.group.add(fig.root);
    const tag = new CanvasLabel(512, 128);
    const tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag.texture, transparent: true, depthWrite: false, toneMapped: false }));
    tagSprite.scale.set(1.1, 0.275, 1);
    tagSprite.position.y = 2.3;
    fig.root.add(tagSprite);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8c15a).multiplyScalar(2), toneMapped: false, transparent: true, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    fig.root.add(ring);
    const w: Walker = {
      id: b.id,
      name: b.name,
      fig,
      path: [DOORWAY.clone(), LANE.clone(), slotPos(slot)],
      leaving: false,
      slot,
      tag,
      tagSprite,
      tagKey: "",
      ring,
      speed: 0,
      unregister: () => undefined,
      facing: 0,
    };
    const aim = new THREE.Vector3();
    w.unregister = this.interact.add({
      id: `buyer:${b.id}`,
      label: b.name,
      verb: "Serve",
      get position() {
        return aim.copy(fig.root.position).setY(1.3);
      },
      radius: 0.55,
      reach: 6,
      enabled: () => !w.leaving && w.path.length === 0,
      onUse: () => this.onServe(w.id),
    });
    this.walkers.set(b.id, w);
    return w;
  }

  private leave(w: Walker) {
    w.leaving = true;
    w.unregister();
    w.path = [LANE.clone(), DOORWAY.clone(), OUTSIDE.clone()];
    w.tagSprite.visible = false;
    w.ring.visible = false;
  }

  private remove(w: Walker) {
    w.unregister();
    w.fig.root.removeFromParent();
    w.fig.dispose();
    w.tag.dispose();
    (w.tagSprite.material as THREE.Material).dispose();
    (w.ring.material as THREE.Material).dispose();
    w.ring.geometry.dispose();
    this.walkers.delete(w.id);
  }

  private drawTag(w: Walker, slot: number) {
    const sel = this.selected === w.id;
    const key = `${slot}|${sel}|${w.name}`;
    if (key === w.tagKey) return;
    w.tagKey = key;
    w.ring.visible = sel;
    w.tag.draw((ctx, width, h) => {
      ctx.textBaseline = "middle";
      const col = sel ? GOLD : CYAN;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(30, h - 18);
      ctx.lineTo(width - 30, h - 18);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = `700 40px ${FONT_DISPLAY}`;
      ctx.textAlign = "left";
      ctx.fillText(String(slot + 1).padStart(2, "0"), 36, h / 2 - 6);
      ctx.fillStyle = "#f4f0e6";
      ctx.font = `700 46px Rajdhani, sans-serif`;
      let name = w.name.toUpperCase();
      while (ctx.measureText(name).width > width - 160 && name.length > 4) name = name.slice(0, -2) + "…";
      ctx.fillText(name, 120, h / 2 - 4);
    });
  }

  update(dt: number, t: number) {
    for (const w of [...this.walkers.values()]) {
      const pos = w.fig.root.position;
      let moving = false;
      if (w.path.length > 0) {
        const target = w.path[0];
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const d = Math.hypot(dx, dz);
        const step = SPEED * dt;
        if (d <= step) {
          pos.set(target.x, 0, target.z);
          w.path.shift();
          if (w.path.length === 0 && w.leaving) {
            this.remove(w);
            continue;
          }
        } else {
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          moving = true;
          w.facing = Math.atan2(dx, dz);
        }
      }
      if (!moving && w.path.length === 0) {
        // waiting: face the desk / the room
        w.facing = Math.atan2(-pos.x, -pos.z);
      }
      let dYaw = w.facing - w.fig.root.rotation.y;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      w.fig.root.rotation.y += dYaw * (1 - Math.exp(-dt * 6));
      w.speed += ((moving ? SPEED : 0) - w.speed) * (1 - Math.exp(-dt * 8));
      w.fig.update(dt, w.speed, t);
      w.tagSprite.position.y = 2.3 + Math.sin(t * 1.5 + w.slot) * 0.04;
      (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 4) * 0.3;
    }
  }

  dispose() {
    for (const w of [...this.walkers.values()]) this.remove(w);
  }
}
