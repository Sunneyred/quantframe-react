import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { blown, FORMS, tiered } from "./glass";
import { additive, Batch, OUTPUT_CHUNKS } from "./kit";
import type { GlassName, Palette } from "./materials";

/**
 * Light fixtures and faked light: the blown-glass chandelier, sconces, hanging lamps, the coloured
 * light that glass throws on floors and walls (animated additive decals), and soft halos.
 * None of it uses shadow maps or extra passes; the decals never touch the canvas alpha.
 */

const UV_VERT = /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
void main() { vUv = uv; vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const CAUSTIC_GLSL = /* glsl */ `
float caustic(vec2 p, float t) {
  float c = 0.0;
  c += sin(p.x * 3.1 + t * 0.9 + sin(p.y * 2.3 + t * 0.7) * 1.6);
  c += sin(p.y * 3.7 - t * 1.1 + sin(p.x * 1.9 - t * 0.5) * 1.4);
  c += sin((p.x + p.y) * 2.2 + t * 0.6);
  c = abs(c) / 3.0;
  return pow(1.0 - c, 3.5);
}`;

const PATCH_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uPattern;
varying vec2 vUv;
varying vec3 vColor;
${CAUSTIC_GLSL}
void main() {
  // an arch of light: soft at the foot (the window side), feathered all round
  vec2 p = vUv;
  float mask = smoothstep(0.0, 0.22, p.x) * smoothstep(1.0, 0.78, p.x) * smoothstep(0.0, 0.12, p.y) * smoothstep(1.0, 0.45, p.y);
  vec2 q = p * vec2(5.0, 8.0);
  float c = caustic(q, uTime * 0.45) + 0.6 * caustic(q * 1.9 + 4.0, uTime * 0.6);
  vec4 pat = texture2D(uPattern, p * vec2(0.6, 0.9) + vec2(uTime * 0.004, 0.0));
  vec3 glassCol = mix(vColor, pat.rgb * (0.4 + vColor), pat.a * 0.3);
  vec3 col = glassCol * (0.22 + c * 0.95) * mask;
  gl_FragColor = vec4(col, 0.0);
  ${OUTPUT_CHUNKS}
}`;

const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uPattern;
varying vec2 vUv;
varying vec3 vColor;
${CAUSTIC_GLSL}
void main() {
  // a wreath of coloured dapples under a ring of glass: uv is centred, the wreath sits at vColor.x .. vColor.y
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float a = atan(d.y, d.x);
  float mask = smoothstep(vColor.x, vColor.x + 0.18, r) * smoothstep(vColor.y, vColor.y - 0.22, r);
  vec2 q = vec2(a * 3.0, r * 9.0);
  // soft dapples, not lines: slow blobs of colour drifting round
  float c = (0.5 + 0.5 * sin(q.x * 2.0 + uTime * 0.11 + sin(q.y * 1.3) * 1.2)) * (0.5 + 0.5 * sin(q.y * 1.7 - uTime * 0.07 + q.x)) + 0.25 * caustic(q, uTime * 0.4);
  vec3 hue = 0.55 + 0.45 * cos(a * 4.0 + vec3(0.0, 2.1, 4.2) + r * 3.0);
  vec4 pat = texture2D(uPattern, d * 1.6 + 0.5);
  vec3 col = mix(vec3(1.0, 0.72, 0.4), hue, 0.4) * (0.75 + pat.rgb * 0.25) * c * mask * vColor.z;
  gl_FragColor = vec4(col, 0.0);
  ${OUTPUT_CHUNKS}
}`;

export interface LightPatch {
  /** Where the foot of the patch is (on the floor under the glass) and which way the light runs. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
  color: THREE.ColorRepresentation;
  strength?: number;
}

/**
 * Coloured light thrown through glass onto the floor: one merged mesh, one draw call. Each patch is
 * a quad from `from` to `to`, widening away from the glass; the shader animates caustics inside.
 */
export function lightPatches(p: Palette, patches: LightPatch[], y = 0.018): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const geos: THREE.BufferGeometry[] = [];
  for (const s of patches) {
    const dir = s.to.clone().sub(s.from);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const w0 = s.width / 2;
    const w1 = (s.width / 2) * 1.5;
    const a = s.from.clone().addScaledVector(side, -w0);
    const b = s.from.clone().addScaledVector(side, w0);
    const c = s.from.clone().addScaledVector(dir, len).addScaledVector(side, w1);
    const d = s.from.clone().addScaledVector(dir, len).addScaledVector(side, -w1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, a.x, y, a.z, c.x, y, c.z, d.x, y, d.z], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    const col = new THREE.Color(s.color).multiplyScalar(s.strength ?? 1);
    g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(6).fill([col.r, col.g, col.b]).flat(), 3));
    geos.push(g);
  }
  const material = additive(
    new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: PATCH_FRAG,
      uniforms: { uTime: { value: 0 }, uPattern: { value: p.glass.murrine.uniforms.uPattern.value } },
      side: THREE.DoubleSide,
    }),
  );
  const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, material);
  mesh.renderOrder = 2;
  mesh.name = "light-patches";
  return { mesh, material };
}

/** The wreath of dapples a ring of glass shades throws on the floor below it. */
export function lightWreath(p: Palette, outer: number, inner: number, strength: number, y = 0.02): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const g = new THREE.PlaneGeometry(outer * 2, outer * 2);
  g.rotateX(-Math.PI / 2);
  g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(4).fill([inner / outer, 1, strength]).flat(), 3));
  const material = additive(
    new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: RING_FRAG, uniforms: { uTime: { value: 0 }, uPattern: { value: p.glass.murrine.uniforms.uPattern.value } } }),
  );
  const mesh = new THREE.Mesh(g, material);
  mesh.position.y = y;
  mesh.renderOrder = 2;
  mesh.name = "light-wreath";
  return { mesh, material };
}

/** A soft round halo of light on a wall or behind a lamp (additive, never touches alpha). */
export function haloMaterial(color: THREE.ColorRepresentation, strength = 0.4): THREE.ShaderMaterial {
  return additive(
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - 0.5) * 2.0;
          float a = exp(-dot(d, d) * 3.2) * uStrength * smoothstep(1.0, 0.7, length(d));
          gl_FragColor = vec4(uColor * a, a);
          ${OUTPUT_CHUNKS}
        }`,
      uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    }),
  );
}

const SHADE_CYCLE: GlassName[] = ["amber", "teal", "opal", "rose"];

export interface Chandelier {
  group: THREE.Group;
  /** The warm key light, parented to the group. */
  light: THREE.PointLight;
  update(dt: number, t: number): void;
}

/**
 * The great chandelier: a brass corona hung on rods from `drop` metres above, a ring of blown bell
 * shades in four glass colours, an upper ring of opal globes (show glass on HIGH), and teardrop
 * pendants of millefiori and cobalt that sway on their own.
 * The group's origin is the hanging point; the whole piece swings from it very slightly.
 */
export function chandelier(p: Palette, o: { radius: number; drop: number; hangRadius: number; shades?: number; lightIntensity?: number }): Chandelier {
  const group = new THREE.Group();
  group.name = "chandelier";
  const R = o.radius;
  const yRing = -o.drop;
  const yUpper = yRing + 1.25;
  const rUpper = R * 0.66;
  const n = o.shades ?? 12;
  const b = new Batch();
  const tube = (r: number, w: number) => {
    const g = new THREE.TorusGeometry(r, w, 8, 72);
    g.rotateX(Math.PI / 2);
    return g;
  };
  b.put(tube(R, 0.06), p.brass, [0, yRing, 0]);
  b.put(tube(R + 0.12, 0.022), p.brass, [0, yRing - 0.1, 0]);
  b.put(tube(rUpper, 0.045), p.brass, [0, yUpper, 0]);
  // rods from the hanging ring down to the corona, and short stays between the two rings
  const rod = (from: THREE.Vector3, to: THREE.Vector3, w: number) => {
    const d = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(w, w, d.length(), 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.applyQuaternion(q);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    b.put(g, p.brass, [mid.x, mid.y, mid.z]);
  };
  const ball = new THREE.SphereGeometry(0.07, 10, 8);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const top = new THREE.Vector3(Math.cos(a) * o.hangRadius, 0, Math.sin(a) * o.hangRadius);
    const up = new THREE.Vector3(Math.cos(a) * rUpper, yUpper, Math.sin(a) * rUpper);
    const low = new THREE.Vector3(Math.cos(a) * R, yRing, Math.sin(a) * R);
    rod(top, up, 0.018);
    rod(up, low, 0.022);
    b.put(ball, p.brass, [up.x, up.y, up.z]);
    b.put(ball, p.brass, [low.x, low.y, low.z], [0, 0, 0], 1.2);
  }
  // bell shades on the corona, each with a brass cap and a bulb
  const bell = blown(FORMS.bell, { ribs: 10, ribDepth: 0.05, twist: 0.35, segments: 20, rings: 14 });
  const cap = new THREE.CylinderGeometry(0.05, 0.11, 0.12, 12);
  const bulb = new THREE.SphereGeometry(0.11, 12, 10);
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    const s = k % 2 ? 0.72 : 0.86;
    b.put(cap, p.brass, [x, yRing - 0.1, z]);
    b.put(bell, p.glass[SHADE_CYCLE[k % 4]], [x, yRing - 0.14, z], [0, a, 0], s);
    b.put(bulb, p.warmGlow, [x, yRing - 0.14 - 0.42 * s, z], [0, 0, 0], s);
  }
  // opal globes on the upper ring: the show pieces
  const globe = blown(FORMS.globe, { ribs: 14, ribDepth: 0.035, twist: 0.6, segments: 28, rings: 18 });
  const gb = new Batch();
  const cup = new THREE.CylinderGeometry(0.13, 0.06, 0.08, 12);
  const gcount = 8;
  for (let k = 0; k < gcount; k++) {
    const a = (k / gcount) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * rUpper;
    const z = Math.sin(a) * rUpper;
    gb.put(globe, p.glass.opal, [x, yUpper + 0.1, z], [0, a * 3, 0], 0.62);
    b.put(cup, p.brass, [x, yUpper + 0.07, z]);
    b.put(bulb, p.warmGlow, [x, yUpper + 0.4, z], [0, 0, 0], 1.1);
  }
  b.build(group);
  const globes = gb.build(group)[0];
  tiered(globes, p.glass.opal, () => p.hero("opal", 0.25));
  // pendants: teardrops on thin stems under the corona, swaying one by one
  const dropGeo = blown(FORMS.drop, { ribs: 8, ribDepth: 0.07, twist: 0.8, segments: 16, rings: 12 });
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5);
  stemGeo.translate(0, -0.5, 0);
  const per = n * 2;
  const kinds: GlassName[] = ["murrine", "cobalt", "murrine", "clear"];
  const sets = kinds.map((name) => new THREE.InstancedMesh(dropGeo, p.glass[name], Math.ceil(per / kinds.length)));
  const stems = new THREE.InstancedMesh(stemGeo, p.brass, per);
  const items: Array<{ set: THREE.InstancedMesh; i: number; x: number; z: number; len: number; size: number; ph: number; a: number }> = [];
  const counts = kinds.map(() => 0);
  for (let k = 0; k < per; k++) {
    const a = (k / per) * Math.PI * 2;
    const kind = k % kinds.length;
    const rr = R + (k % 2 ? 0.12 : -0.05);
    items.push({ set: sets[kind], i: counts[kind]++, x: Math.cos(a) * rr, z: Math.sin(a) * rr, len: 0.25 + ((k * 7) % 5) * 0.16, size: 0.42 + ((k * 3) % 4) * 0.07, ph: k * 1.37, a });
  }
  for (const s of sets) {
    s.frustumCulled = false;
    group.add(s);
  }
  stems.frustumCulled = false;
  group.add(stems);
  const light = new THREE.PointLight(0xffd6a0, o.lightIntensity ?? 90, 30, 1.7);
  light.position.set(0, yRing - 0.3, 0);
  group.add(light);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const place = (t: number) => {
    items.forEach((it, k) => {
      const sway = 0.045;
      e.set(Math.sin(t * 0.83 + it.ph) * sway, it.a + t * 0.02, Math.sin(t * 0.71 + it.ph * 1.7) * sway);
      q.setFromEuler(e);
      pos.set(it.x, yRing - 0.08, it.z);
      m.compose(pos, q, sc.set(1, it.len, 1));
      stems.setMatrixAt(k, m);
      // the drop hangs from the end of its stem
      pos.set(0, -it.len, 0).applyQuaternion(q).add(new THREE.Vector3(it.x, yRing - 0.08, it.z));
      m.compose(pos, q, sc.setScalar(it.size));
      it.set.setMatrixAt(it.i, m);
    });
    for (const s of sets) s.instanceMatrix.needsUpdate = true;
    stems.instanceMatrix.needsUpdate = true;
  };
  place(0);
  return {
    group,
    light,
    update(_dt, t) {
      group.rotation.x = Math.sin(t * 0.31) * 0.006;
      group.rotation.z = Math.sin(t * 0.27 + 1.3) * 0.006;
      group.rotation.y = Math.sin(t * 0.05) * 0.04;
      light.intensity = (o.lightIntensity ?? 90) * (1 + Math.sin(t * 1.9) * 0.012 + Math.sin(t * 7.3) * 0.006);
      place(t);
    },
  };
}

/**
 * A hanging lamp: a brass stem and a blown globe with a bulb in it. Origin = the hanging point.
 * `show` makes the globe a show piece (transmission) on HIGH.
 */
export function hangingLamp(p: Palette, glass: GlassName, length: number, size: number, show = false) {
  const group = new THREE.Group();
  const b = new Batch();
  const stem = new THREE.CylinderGeometry(0.014, 0.014, length, 6);
  b.put(stem, p.brass, [0, -length / 2, 0]);
  b.put(new THREE.CylinderGeometry(0.05, 0.16 * size, 0.14 * size, 14), p.brass, [0, -length - 0.02, 0]);
  b.put(new THREE.SphereGeometry(0.16 * size, 12, 10), p.warmGlow, [0, -length - 0.55 * size, 0]);
  b.build(group);
  const geo = blown(FORMS.globe, { ribs: 12, ribDepth: 0.04, twist: 0.5, segments: 28, rings: 20 });
  geo.rotateX(Math.PI); // hang it neck up
  const globe = new THREE.Mesh(geo, p.glass[glass]);
  globe.scale.setScalar(size);
  globe.position.y = -length - 0.04;
  if (show) tiered(globe, p.glass[glass], () => p.hero(glass, 0.3 * size));
  group.add(globe);
  const ph = Math.random() * 10;
  return {
    group,
    update(t: number) {
      group.rotation.x = Math.sin(t * 0.5 + ph) * 0.02;
      group.rotation.z = Math.sin(t * 0.43 + ph * 2.1) * 0.02;
    },
  };
}

/** A wall sconce into a batch (frame: origin on the wall, +z into the room): brass arm, glass gourd, bulb. */
export function sconce(b: Batch, p: Palette, glass: GlassName, size = 1) {
  const z = 0.15 * size;
  b.put(new THREE.CylinderGeometry(0.07 * size, 0.07 * size, 0.03, 16), p.brass, [0, 0, 0.015], [Math.PI / 2, 0, 0]);
  b.put(new THREE.CylinderGeometry(0.016 * size, 0.016 * size, z, 6), p.brass, [0, 0, z / 2], [Math.PI / 2, 0, 0]);
  b.put(new THREE.CylinderGeometry(0.075 * size, 0.03 * size, 0.06 * size, 12), p.brass, [0, 0.03 * size, z]);
  b.put(blown(FORMS.gourd, { ribs: 9, ribDepth: 0.05, twist: 0.4, segments: 18, rings: 16 }), p.glass[glass], [0, 0.05 * size, z], [0, 0, 0], 0.42 * size);
  b.put(new THREE.SphereGeometry(0.07 * size, 10, 8), p.warmGlow, [0, 0.15 * size, z]);
}
