import * as THREE from "three";
import { additive, OUTPUT_CHUNKS } from "./kit";

/** The Void outside the windows: a nebula sky sphere, distant drifting shards, and motes inside the room. */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float t = uTime * 0.004;
  vec3 q = d * 2.2 + vec3(t, 0.0, -t);
  float n = fbm(q + fbm(q * 1.6 + 3.1) * 1.3);
  float band = exp(-pow((d.y + 0.12 + 0.25 * sin(d.x * 2.0 + d.z)) * 2.4, 2.0));
  vec3 voidC = vec3(0.010, 0.008, 0.045);
  vec3 violet = vec3(0.30, 0.06, 0.46);
  vec3 magenta = vec3(0.62, 0.08, 0.34);
  vec3 teal = vec3(0.02, 0.36, 0.40);
  vec3 ember = vec3(0.85, 0.48, 0.10);
  vec3 col = voidC;
  // saturated space-pop clouds: violet body, a magenta seam, teal wisps, and the old gold of the Void in the cores
  col += violet * smoothstep(0.35, 0.85, n) * (0.4 + band);
  col += magenta * pow(smoothstep(0.45, 0.8, fbm(q * 1.3 - 4.0)), 2.0) * (0.25 + band) * 0.8;
  col += teal * smoothstep(0.5, 0.95, fbm(q * 0.8 + 7.0)) * band * 1.3;
  col += ember * pow(smoothstep(0.62, 0.95, n), 3.0) * band * 1.7;
  // stars: sparse cells, a few brighter
  vec3 sp = d * 220.0;
  vec3 cell = floor(sp);
  float h = hash(cell);
  if (h > 0.985) {
    vec3 c = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.1), hash(cell + 4.7)) - 0.5) * 0.6;
    float dist = length(sp - c);
    float tw = 0.7 + 0.3 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
    col += vec3(0.9, 0.92, 1.0) * smoothstep(0.35, 0.0, dist) * (h - 0.985) * 120.0 * tw;
  }
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_CHUNKS}
}`;

export function makeSky(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: { uTime: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.name = "sky";
  return sky;
}

/** Slow floating shards far outside, catching gold rim light. */
export function makeShards(gold: THREE.Material): { group: THREE.Group; update: (dt: number) => void } {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a2a44, roughness: 0.8, metalness: 0.1, emissive: 0x140a20, flatShading: true });
  const items: Array<{ m: THREE.Object3D; spin: THREE.Vector3 }> = [];
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + r(-0.15, 0.15);
    const dist = r(45, 110);
    const g = new THREE.Group();
    const s = r(1.2, 4.5);
    // tumbling rocks, a few of them ringed in brass
    const rock = new THREE.IcosahedronGeometry(s, 1);
    const rp = rock.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < rp.count; v++) {
      const k = 0.78 + 0.44 * Math.abs(Math.sin(rp.getX(v) * 12.9 + rp.getY(v) * 78.2 + rp.getZ(v) * 37.7 + i));
      rp.setXYZ(v, rp.getX(v) * k, rp.getY(v) * k, rp.getZ(v) * k);
    }
    rock.computeVertexNormals();
    const body = new THREE.Mesh(rock, dark);
    body.scale.set(r(0.6, 1.0), r(0.8, 1.4), r(0.6, 1.0));
    g.add(body);
    if (i % 3 === 0) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 1.4, s * 0.04, 6, 48), gold);
      ring.rotation.x = r(0, Math.PI);
      g.add(ring);
    }
    g.position.set(Math.sin(a) * dist, r(-12, 26), -Math.cos(a) * dist);
    group.add(g);
    items.push({ m: g, spin: new THREE.Vector3(r(-0.05, 0.05), r(-0.08, 0.08), r(-0.05, 0.05)) });
  }
  return {
    group,
    update: (dt) => {
      for (const it of items) {
        it.m.rotation.x += it.spin.x * dt;
        it.m.rotation.y += it.spin.y * dt;
        it.m.rotation.z += it.spin.z * dt;
      }
    },
  };
}

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uScale;
attribute vec3 seed;
varying float vA;
varying vec3 vC;
void main() {
  vec3 p = position;
  float t = uTime * (0.05 + seed.x * 0.08);
  p.x += sin(t * 3.0 + seed.y * 20.0) * 0.6;
  p.z += cos(t * 2.0 + seed.z * 20.0) * 0.6;
  p.y = mod(p.y + uTime * (0.04 + seed.x * 0.1), 11.0) + 0.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min(5.0, uScale * (0.6 + seed.y * 1.4) / -mv.z);
  vA = (0.35 + 0.65 * sin(uTime * (0.5 + seed.z) + seed.x * 30.0) * 0.5 + 0.5) * smoothstep(0.2, 1.5, p.y) * smoothstep(11.2, 9.0, p.y);
  // dust in lamp light: mostly warm, a few flecks in the colours of the glass
  vC = mix(vec3(1.0, 0.8, 0.5), mix(vec3(0.4, 0.95, 0.9), vec3(1.0, 0.5, 0.7), step(0.9, seed.z)), step(0.78, seed.z));
}`;
const MOTE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vA;
varying vec3 vC;
void main() {
  float a = texture2D(uMap, gl_PointCoord).r * vA;
  gl_FragColor = vec4(vC * a * 1.6, a);
  ${OUTPUT_CHUNKS}
}`;

/** Dust motes drifting up through the room, inside `radius`. */
export function makeMotes(count: number, radius: number, dot: THREE.Texture, pixelScale: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = Math.random() * 11;
    pos[i * 3 + 2] = Math.cos(a) * r;
    seed[i * 3] = Math.random();
    seed[i * 3 + 1] = Math.random();
    seed[i * 3 + 2] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("seed", new THREE.BufferAttribute(seed, 3));
  const m = additive(
    new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { uTime: { value: 0 }, uMap: { value: dot }, uScale: { value: 9 * pixelScale } },
    }),
  );
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SHAFT_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
  float len = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y) ;
  float streak = 0.65 + 0.35 * sin(vUv.x * 23.0 + uTime * 0.3) * sin(vUv.x * 7.0 - uTime * 0.17);
  float a = edge * len * streak * uStrength;
  gl_FragColor = vec4(uColor * a, a);
  ${OUTPUT_CHUNKS}
}`;

/** A soft volumetric-looking light shaft: two crossed additive quads from `from` to `to`. */
export function makeShaft(from: THREE.Vector3, to: THREE.Vector3, width: number, color: THREE.ColorRepresentation, strength: number) {
  const mat = additive(
    new THREE.ShaderMaterial({
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
      side: THREE.DoubleSide,
    }),
  );
  const len = from.distanceTo(to);
  const g = new THREE.Group();
  for (let k = 0; k < 2; k++) {
    const geo = new THREE.PlaneGeometry(width, len, 1, 1);
    geo.translate(0, -len / 2, 0); // top at origin
    // widen toward the floor
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -len / 2) p.setX(i, p.getX(i) * 1.8);
    // uv.y: 1 at the top
    const q = new THREE.Mesh(geo, mat);
    q.rotation.y = k * (Math.PI / 2);
    g.add(q);
  }
  g.position.copy(from);
  const dir = to.clone().sub(from).normalize();
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  g.renderOrder = 5;
  return { group: g, material: mat };
}

const PLANET_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vP;
void main() { vN = normalize(mat3(modelMatrix) * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PLANET_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uSun;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  float lat = normalize(vP).y;
  // candy stripes with a wobble, like a gas giant
  float s = lat * 9.0 + sin(lat * 23.0 + normalize(vP).x * 2.0) * 0.35;
  float t = 0.5 + 0.5 * sin(s * 3.14159);
  vec3 col = mix(uA, uB, smoothstep(0.2, 0.8, t));
  col = mix(col, uC, smoothstep(0.75, 1.0, 0.5 + 0.5 * sin(s * 1.7 + 1.0)) * 0.6);
  float l = max(0.0, dot(n, normalize(uSun)));
  float rim = pow(1.0 - abs(n.z), 3.0);
  col = col * (0.05 + 1.1 * smoothstep(-0.05, 0.6, l)) + uB * rim * 0.25 * l;
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_CHUNKS}
}`;

/**
 * Two worlds far outside: a striped giant with a ring to the north west, high enough to hang over
 * the observatory's glass dome, and a small teal moon to the south for the Vault's windows.
 */
export function makePlanets(): { group: THREE.Group; update(dt: number): void } {
  const group = new THREE.Group();
  group.name = "planets";
  const world = (radius: number, at: THREE.Vector3, a: number, b: number, c: number) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 40, 24),
      new THREE.ShaderMaterial({
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
        uniforms: { uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(b) }, uC: { value: new THREE.Color(c) }, uSun: { value: new THREE.Vector3(0.7, 0.45, 0.55) } },
      }),
    );
    m.position.copy(at);
    group.add(m);
    return m;
  };
  const giant = world(70, new THREE.Vector3(-330, 250, -520), 0xf0772b, 0xf6e2b8, 0xc93a66);
  giant.rotation.z = 0.42;
  const ringGeo = new THREE.RingGeometry(92, 140, 96, 1);
  const ringMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        float r = (length(vP) - 92.0) / 48.0;
        float bands = 0.55 + 0.45 * sin(r * 40.0) * sin(r * 13.0 + 1.0);
        float a = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.9, r) * bands * 0.13;
        gl_FragColor = vec4(vec3(0.9, 0.7, 0.42) * a, a);
        ${OUTPUT_CHUNKS}
      }`,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2 - 0.35;
  giant.add(ring);
  const moon = world(26, new THREE.Vector3(150, 70, 360), 0x18a39b, 0xbff0e0, 0x16264a);
  return {
    group,
    update(dt) {
      giant.rotation.y += dt * 0.004;
      moon.rotation.y += dt * 0.01;
    },
  };
}
