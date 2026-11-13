import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Small building blocks shared by rooms. */

/** Polar position on the floor: angle in degrees clockwise from north (-Z), radius in metres. */
export function polar(deg: number, r: number, y = 0): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r);
}

/** rotation.y that makes local +Z face the room centre from angle `deg`. */
export const faceCentre = (deg: number) => -THREE.MathUtils.degToRad(deg);

/**
 * Additive light that never changes the canvas alpha: glows add over DOM screens
 * (premultiplied) instead of covering them. `premultiplied` = the shader already multiplied rgb by alpha.
 */
export function additive<M extends THREE.Material>(m: M, premultiplied = true): M {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = premultiplied ? THREE.OneFactor : THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}

/** Shader chunk tail so custom shaders match three's own materials in both render paths. */
export const OUTPUT_CHUNKS = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>`;

/**
 * An armillary ornament: nested brass rings, each carrying a bead, turning about a glowing marble.
 * `shell` is drawn around the marble only when it is a see-through material (glass).
 */
export function gyroOrnament(size: number, gold: THREE.Material, core: THREE.Material, shell: THREE.Material) {
  const g = new THREE.Group();
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = size * (1 - i * 0.18);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, size * 0.024, 8, 56), gold);
    ring.rotation.set(i * 1.1, i * 0.7, 0);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(size * 0.07, 12, 8), gold);
    bead.position.x = r;
    ring.add(bead);
    g.add(ring);
    rings.push(ring);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(size * (shell.transparent ? 0.2 : 0.3), 20, 14), core);
  g.add(heart);
  if (shell.transparent) g.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.38, 24, 16), shell));
  const seed = Math.random() * 10;
  return {
    group: g,
    update(t: number) {
      rings[0].rotation.x = t * 0.21 + seed;
      rings[1].rotation.y = t * 0.17 + seed;
      rings[2].rotation.z = t * 0.26;
      rings[2].rotation.x = t * 0.09;
    },
  };
}

/**
 * Static dressing is merged by material: `put` bakes a transform into a copy of the geometry and
 * `build` emits one mesh per material, so a room's trim costs a handful of draw calls instead of
 * hundreds. Geometries passed in are only read (they never reach the GPU themselves).
 */
export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  constructor(private base: THREE.Matrix4 = new THREE.Matrix4()) {}

  /** A view of this batch whose `put` positions are relative to `frame` (an object's local matrix). */
  frame(frame: THREE.Matrix4): Batch {
    const b = new Batch(this.base.clone().multiply(frame));
    b.parts = this.parts;
    return b;
  }

  /** A view relative to a position and a yaw (the common case: something standing on the floor). */
  at(x: number, y: number, z: number, yaw = 0): Batch {
    return this.frame(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z));
  }

  put(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: number | [number, number, number] = 1): this {
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    if (typeof scale === "number") this.s.setScalar(scale);
    else this.s.set(scale[0], scale[1], scale[2]);
    this.m.compose(this.v.set(pos[0], pos[1], pos[2]), this.q, this.s).premultiply(this.base);
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
    g.applyMatrix4(this.m);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }

  /** Emit the merged meshes into `parent`. */
  build(parent: THREE.Object3D, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      // Merged meshes are large and derived: never serialise them. (Vite's dev client forwards console
      // output by JSON-stringifying its arguments; a logged DOM node reaches the scene through React,
      // and three's toJSON would then write out every vertex. That took gigabytes in the test harness.)
      (mesh as { toJSON: unknown }).toJSON = () => ({ object: {} });
      mesh.castShadow = opts.cast ?? false;
      mesh.receiveShadow = opts.receive ?? true;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

/** A box with rounded vertical edges (a slab extruded from a rounded rectangle), centred, y up. */
export function roundedBox(w: number, h: number, d: number, r: number, segs = 4): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hd = d / 2;
  const rr = Math.min(r, hw - 0.001, hd - 0.001);
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.absarc(hw - rr, -hd + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(hw, hd - rr);
  s.absarc(hw - rr, hd - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(-hw + rr, hd);
  s.absarc(-hw + rr, hd - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(-hw, -hd + rr);
  s.absarc(-hw + rr, -hd + rr, rr, Math.PI, Math.PI * 1.5, false);
  const bevel = Math.min(0.012, h * 0.2);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: segs });
  // extruded along +z from the xy plane: stand it up so the extrusion runs along y
  g.rotateX(-Math.PI / 2);
  g.translate(0, -h / 2 + bevel, 0);
  return g;
}

/** Arch outline (opening) for a wall: straight jambs from `sill` to `spring`, a round top. */
export function archPath(path: THREE.Path | THREE.Shape, halfW: number, sill: number, spring: number, reverse = false) {
  if (!reverse) {
    path.moveTo(-halfW, sill);
    path.lineTo(halfW, sill);
    path.lineTo(halfW, spring);
    path.absarc(0, spring, halfW, 0, Math.PI, false);
    path.lineTo(-halfW, sill);
  } else {
    path.moveTo(-halfW, sill);
    path.lineTo(-halfW, spring);
    path.absarc(0, spring, halfW, Math.PI, 0, true);
    path.lineTo(halfW, sill);
    path.lineTo(-halfW, sill);
  }
  return path;
}
