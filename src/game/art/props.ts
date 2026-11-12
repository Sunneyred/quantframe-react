import * as THREE from "three";
import { blown, FORMS } from "./glass";
import { Batch, roundedBox } from "./kit";
import type { EnamelName, GlassName, Palette } from "./materials";
import { INSTRUMENT_DIALS } from "./surfaces";

/**
 * Furniture and instruments of the ship, written into a `Batch` (one draw call per material):
 * instrument clusters with idling needles, tape reels, tufted banquettes, brass rails, console
 * bodies, the trade counter, pedestals. Frames: +z faces the room, y is up, origin on the floor
 * (or on the wall for wall-mounted pieces).
 */

/** A box whose UVs are in metres, so tiling textures (leather, wood, enamel) keep their scale. */
export function boxM(w: number, h: number, d: number, k = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: Array<[number, number]> = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, uv.getX(f * 4 + i) * dims[f][0] * k, uv.getY(f * 4 + i) * dims[f][1] * k);
  return g;
}

/** Scale a geometry's UVs (ExtrudeGeometry and friends already work in metres). */
export function scaleUV<T extends THREE.BufferGeometry>(g: T, kx: number, ky = kx): T {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * kx, uv.getY(i) * ky);
  return g;
}

interface Idler {
  pivot: THREE.Matrix4;
  kind: "needle" | "reel";
  size: number;
  mid: number;
  range: number;
  speed: number;
  phase: number;
}

/**
 * Everything small that idles: dial needles wandering, tape reels turning. Two instanced meshes for
 * a whole room, whatever the number of instruments.
 */
export class Idlers {
  readonly group = new THREE.Group();
  private items: Idler[] = [];
  private needles: THREE.InstancedMesh | null = null;
  private reels: THREE.InstancedMesh | null = null;
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private s = new THREE.Matrix4();

  constructor(private p: Palette) {
    this.group.name = "idlers";
  }

  /** `pivot`: the hub in the group's frame, +z out of the face. */
  needle(pivot: THREE.Matrix4, length: number, mid: number, range: number) {
    this.items.push({ pivot, kind: "needle", size: length, mid, range, speed: 0.25 + Math.random() * 0.5, phase: Math.random() * 20 });
  }

  reel(pivot: THREE.Matrix4, radius: number, speed: number) {
    this.items.push({ pivot, kind: "reel", size: radius, mid: 0, range: 0, speed, phase: Math.random() * 6 });
  }

  /** Call once after everything is added. */
  build() {
    const n = this.items.filter((i) => i.kind === "needle").length;
    const r = this.items.length - n;
    if (n) {
      const shape = new THREE.Shape();
      shape.moveTo(-0.035, -0.12);
      shape.lineTo(0.035, -0.12);
      shape.lineTo(0.008, 1);
      shape.lineTo(-0.008, 1);
      shape.closePath();
      this.needles = new THREE.InstancedMesh(new THREE.ShapeGeometry(shape), this.p.needle, n);
      this.needles.frustumCulled = false;
      this.group.add(this.needles);
    }
    if (r) {
      this.reels = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 28), this.p.reel, r);
      this.reels.frustumCulled = false;
      this.group.add(this.reels);
    }
    this.update(0);
  }

  update(t: number) {
    let ni = 0;
    let ri = 0;
    for (const it of this.items) {
      if (it.kind === "needle") {
        const w = 0.55 * Math.sin(t * it.speed + it.phase) + 0.3 * Math.sin(t * it.speed * 2.3 + it.phase * 1.7) + 0.15 * Math.sin(t * it.speed * 6.1 + it.phase * 0.6);
        this.r.makeRotationZ(-(it.mid + it.range * w * 0.8));
        this.s.makeScale(it.size, it.size, 1);
        this.m.copy(it.pivot).multiply(this.r).multiply(this.s);
        this.needles!.setMatrixAt(ni++, this.m);
      } else {
        this.r.makeRotationZ(-(t * it.speed + it.phase));
        this.s.makeScale(it.size, it.size, 1);
        this.m.copy(it.pivot).multiply(this.r).multiply(this.s);
        this.reels!.setMatrixAt(ri++, this.m);
      }
    }
    if (this.needles) this.needles.instanceMatrix.needsUpdate = true;
    if (this.reels) this.reels.instanceMatrix.needsUpdate = true;
  }
}

/**
 * An instrument cluster on a wall or a console front: a bakelite case, the printed face, and three
 * idling needles. `frame` is the cluster's pose in the batch's frame (origin = centre of the face
 * on the surface, +z out); `idlerBase` is the batch's frame seen from the idlers' group when the
 * two differ. Total depth 5 cm.
 */
export function instrumentCluster(b: Batch, idlers: Idlers, p: Palette, frame: THREE.Matrix4, width = 0.9, idlerBase?: THREE.Matrix4) {
  const h = width / 2;
  const f = b.frame(frame);
  f.put(roundedBox(width + 0.07, 0.045, h + 0.07, 0.05), p.bakelite, [0, 0, 0.0225], [Math.PI / 2, 0, 0]);
  f.put(new THREE.PlaneGeometry(width, h), p.instrument, [0, 0, 0.047]);
  const base = idlerBase ? idlerBase.clone().multiply(frame) : frame;
  for (const d of INSTRUMENT_DIALS) {
    const pivot = base.clone().multiply(new THREE.Matrix4().makeTranslation(d.x * width, d.y * h, 0.05));
    idlers.needle(pivot, d.len * h, d.mid, d.range);
  }
}

/** A pair of tape reels behind a little window, wall mounted (depth 6 cm). */
export function reelUnit(b: Batch, idlers: Idlers, p: Palette, frame: THREE.Matrix4, width = 0.7, colour: EnamelName = "tangerine") {
  const h = width * 0.62;
  const f = b.frame(frame);
  f.put(roundedBox(width, 0.05, h, 0.06), p.paint[colour], [0, 0, 0.025], [Math.PI / 2, 0, 0]);
  f.put(roundedBox(width * 0.86, 0.01, h * 0.62, 0.04), p.bakelite, [0, h * 0.1, 0.052], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) f.put(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 10), p.chrome, [(-1.5 + i) * width * 0.16, -h * 0.36, 0.06], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    const pivot = frame.clone().multiply(new THREE.Matrix4().makeTranslation(sx * width * 0.21, h * 0.1, 0.062));
    idlers.reel(pivot, width * 0.17, sx * (0.7 + Math.random() * 0.2));
  }
}

/**
 * A tufted leather banquette against a wall: walnut plinth, seat cushion, raked back, brass foot
 * rail and rounded walnut ends. Origin: centre of the back edge on the floor, +z into the room.
 */
export function banquette(b: Batch, p: Palette, length: number, leather: THREE.Material = p.leather) {
  const k = 2.5; // leather repeats per metre
  b.put(roundedBox(length, 0.3, 0.5, 0.08), p.wood, [0, 0.15, 0.3]);
  b.put(scaleUV(roundedBox(length - 0.04, 0.17, 0.56, 0.09), k), leather, [0, 0.385, 0.33]);
  b.put(scaleUV(roundedBox(length - 0.04, 0.5, 0.15, 0.07), k), leather, [0, 0.72, 0.1], [-0.14, 0, 0]);
  const rail = new THREE.CylinderGeometry(0.018, 0.018, length - 0.3, 8);
  b.put(rail, p.brass, [0, 0.07, 0.6], [0, 0, Math.PI / 2]);
  for (const sx of [-1, 1]) {
    b.put(roundedBox(0.1, 0.62, 0.62, 0.05), p.wood, [sx * (length / 2 + 0.03), 0.31, 0.31]);
    b.put(new THREE.SphereGeometry(0.045, 10, 8), p.brass, [sx * (length / 2 + 0.03), 0.66, 0.56]);
    b.put(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6), p.brass, [sx * (length / 2 - 0.2), 0.035, 0.6]);
  }
}

/** A brass hand rail on posts along a straight run. Origin: centre on the floor, runs along x. */
export function brassRail(b: Batch, p: Palette, length: number, height = 0.95, posts = 3) {
  b.put(new THREE.CylinderGeometry(0.028, 0.028, length, 10), p.brass, [0, height, 0], [0, 0, Math.PI / 2]);
  b.put(new THREE.CylinderGeometry(0.014, 0.014, length, 6), p.brass, [0, height * 0.52, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < posts; i++) {
    const x = posts === 1 ? 0 : -length / 2 + (i / (posts - 1)) * length;
    b.put(new THREE.CylinderGeometry(0.02, 0.026, height, 8), p.brass, [x, height / 2, 0]);
    b.put(new THREE.SphereGeometry(0.045, 10, 8), p.brass, [x, height + 0.01, 0]);
    b.put(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 12), p.brass, [x, 0.015, 0]);
  }
}

/**
 * The body of a standing console (a lectern under a tilted screen): rounded walnut case on a brass
 * kick plinth, a bakelite top with a brass edge, a leather knee panel and an instrument cluster on
 * the front. Origin: centre on the floor, +z = the user's side. `frame` is the pose of the batch's
 * frame in the idlers' group (the needles live there).
 */
export function consoleBody(b: Batch, idlers: Idlers | null, p: Palette, w: number, h: number, d: number, o: { frame?: THREE.Matrix4; colour?: EnamelName; cluster?: boolean; lamps?: GlassName } = {}) {
  b.put(roundedBox(w - 0.06, 0.08, d - 0.06, 0.1), p.brassDark, [0, 0.04, 0]);
  b.put(roundedBox(w, h - 0.12, d, 0.13), o.colour ? p.paint[o.colour] : p.wood, [0, 0.08 + (h - 0.12) / 2, 0]);
  b.put(roundedBox(w + 0.07, 0.045, d + 0.07, 0.15), p.bakelite, [0, h - 0.018, 0]);
  b.put(roundedBox(w + 0.09, 0.016, d + 0.09, 0.16), p.brass, [0, h - 0.045, 0]);
  // a leather knee panel across the front
  const pw = w - 0.36;
  b.put(scaleUV(roundedBox(pw, h * 0.5, 0.03, 0.012), 2.5), p.leatherTan, [0, 0.1 + h * 0.3, d / 2 + 0.006]);
  if (o.cluster !== false && idlers && o.frame) {
    const cw = Math.min(0.62, pw - 0.1);
    instrumentCluster(b, idlers, p, new THREE.Matrix4().makeTranslation(0, 0.1 + h * 0.3, d / 2 + 0.02), cw, o.frame);
  }
  if (o.lamps) {
    const gourd = blown(FORMS.globe, { ribs: 8, ribDepth: 0.05, twist: 0.4, segments: 18, rings: 16 });
    for (const sx of [-1, 1]) {
      b.put(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 12), p.brass, [sx * (w / 2 - 0.12), h + 0.02, -d / 2 + 0.14]);
      b.put(gourd, p.glass[o.lamps], [sx * (w / 2 - 0.12), h + 0.03, -d / 2 + 0.14], [0, 0, 0], 0.2);
      b.put(new THREE.SphereGeometry(0.04, 8, 6), p.warmGlow, [sx * (w / 2 - 0.12), h + 0.13, -d / 2 + 0.14]);
    }
  }
}

/**
 * The trade counter: a long bar with rounded ends, a tufted leather front between walnut rails, a
 * chrome foot rail, a bakelite top with a brass edge, and a brass lamp post with a glass globe at
 * each end. Origin: centre on the floor, +z = the customers' side... the room's side.
 */
export function tradeCounter(b: Batch, p: Palette, L: number, D: number, H: number) {
  b.put(roundedBox(L - 0.1, 0.1, D - 0.1, 0.3), p.brassDark, [0, 0.05, 0]);
  b.put(roundedBox(L, H - 0.17, D, 0.36), p.wood, [0, 0.1 + (H - 0.17) / 2, 0]);
  b.put(scaleUV(roundedBox(L - 0.5, H - 0.42, 0.05, 0.02), 2.5), p.leather, [0, 0.1 + (H - 0.17) / 2, D / 2 + 0.01]);
  b.put(roundedBox(L + 0.2, 0.06, D + 0.2, 0.44), p.bakelite, [0, H - 0.03, 0]);
  b.put(roundedBox(L + 0.23, 0.02, D + 0.23, 0.45), p.brass, [0, H - 0.062, 0]);
  // foot rail on little brackets
  b.put(new THREE.CylinderGeometry(0.024, 0.024, L - 0.7, 10), p.chrome, [0, 0.2, D / 2 + 0.14], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 4; i++) b.put(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 6), p.chrome, [-(L - 0.9) / 2 + (i / 3) * (L - 0.9), 0.2, D / 2 + 0.07], [Math.PI / 2, 0, 0]);
  const globe = blown(FORMS.globe, { ribs: 12, ribDepth: 0.04, twist: 0.5, segments: 24, rings: 20 });
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.02);
    b.put(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 12), p.brass, [x, H + 0.21, 0]);
    b.put(new THREE.CylinderGeometry(0.09, 0.05, 0.05, 14), p.brass, [x, H + 0.44, 0]);
    b.put(globe, p.glass.amber, [x, H + 0.45, 0], [0, 0, 0], 0.34);
    b.put(new THREE.SphereGeometry(0.07, 10, 8), p.warmGlow, [x, H + 0.62, 0]);
  }
}

/** A round pedestal: brass foot, walnut drum, brass collar. Origin on the floor; the top is at `h`. */
export function pedestal(b: Batch, p: Palette, r: number, h: number, body: THREE.Material = p.wood) {
  const pts = [
    [0, 0],
    [r * 1.25, 0],
    [r * 1.25, 0.05],
    [r * 1.08, 0.1],
    [r, 0.16],
    [r * 0.94, h * 0.5],
    [r, h - 0.08],
    [r * 1.1, h - 0.04],
    [r * 1.1, h],
    [0, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  b.put(new THREE.LatheGeometry(pts, 28), body);
  const ring = new THREE.TorusGeometry(r * 1.11, 0.02, 6, 28);
  ring.rotateX(Math.PI / 2);
  b.put(ring, p.brass, [0, h - 0.02, 0]);
  b.put(ring, p.brass, [0, 0.11, 0], [0, 0, 0], [1.0, 1, 1.0]);
}
