import * as THREE from "three";

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

/** A gyroscope ornament: nested gold rings around a glowing core, each turning on its own axis. */
export function gyroOrnament(size: number, gold: THREE.Material, core: THREE.Material, ivory: THREE.Material) {
  const g = new THREE.Group();
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = size * (1 - i * 0.18);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, size * 0.028, 8, 64), gold);
    ring.rotation.set(i * 1.1, i * 0.7, 0);
    g.add(ring);
    rings.push(ring);
  }
  const shell = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.38, 0), ivory);
  g.add(shell);
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(size * 0.16, 0), core);
  g.add(heart);
  const spikes = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(size * 0.05, size * 0.5, 4), gold);
    const d = new THREE.Vector3(...([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][i] as [number, number, number]));
    s.position.copy(d).multiplyScalar(size * 0.55);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    spikes.add(s);
  }
  g.add(spikes);
  const seed = Math.random() * 10;
  return {
    group: g,
    update(t: number) {
      rings[0].rotation.x = t * 0.21 + seed;
      rings[1].rotation.y = t * 0.17 + seed;
      rings[2].rotation.z = t * 0.26;
      rings[2].rotation.x = t * 0.09;
      shell.rotation.y = -t * 0.3;
      spikes.rotation.y = t * 0.12;
      spikes.rotation.x = t * 0.05;
    },
  };
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
