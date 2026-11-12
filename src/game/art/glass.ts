import * as THREE from "three";
import { OUTPUT_CHUNKS } from "./kit";
import { canvas, fbm, rng, tex } from "./textures";

/**
 * Art glass, the ship's signature material, in two tiers:
 *
 *  - `cheapGlass`: one small shader used for nearly everything and for the whole LOW tier. A fresnel
 *    rim, a reflection of the painted environment (sampled as an equirect, no PMREM lookups), a
 *    thin-film tint, and the glass body "lit from within" (premultiplied: the body tints what is
 *    behind it by its density, reflections and glow add on top). Alpha stays honest, so glass in
 *    front of a DOM screen dims it instead of punching through.
 *  - `heroGlass`: MeshPhysicalMaterial with transmission, thickness, ior, dispersion and
 *    iridescence, for a handful of show pieces on HIGH only (transmission costs a scene pass).
 *
 * `tiered(mesh, low, high)` registers both on a mesh; the engine swaps them with the quality.
 *
 * Patterns are RGBA canvases: rgb = the colour of the canes or murrine (white where the glass is
 * clear, so the material's tint colours it), a = density (0 clear .. 1 opaque cane).
 */

export type GlassPatternName = "swirl" | "millefiori" | "dichroic";

const S = 512;

function bubbles(data: Uint8ClampedArray, seed: number, count: number) {
  const r = rng(seed);
  for (let k = 0; k < count; k++) {
    const cx = r() * S;
    const cy = r() * S;
    const rad = 1.5 + r() * r() * 7;
    const x0 = Math.floor(cx - rad - 1);
    const y0 = Math.floor(cy - rad - 1);
    for (let y = y0; y <= y0 + rad * 2 + 2; y++)
      for (let x = x0; x <= x0 + rad * 2 + 2; x++) {
        const d = Math.hypot(x - cx, y - cy);
        // a bright ring, brighter on the upper left like a tiny lens
        const ringK = Math.max(0, 1 - Math.abs(d - rad) / 1.3) * (0.55 + 0.45 * Math.max(0, (cx - x + (cy - y)) / (rad * 1.5)));
        if (ringK <= 0) continue;
        const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4;
        data[i] += (255 - data[i]) * ringK;
        data[i + 1] += (255 - data[i + 1]) * ringK;
        data[i + 2] += (255 - data[i + 2]) * ringK;
        data[i + 3] = Math.min(255, data[i + 3] + ringK * 90);
      }
  }
}

/** Latticino: twisted white and gold canes over a fine counter-twisted net, with seed bubbles. */
function swirl(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const wob = fbm(S, S, seed);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const U = x / S;
      const V = y / S;
      const w = (wob[y * S + x] - 0.5) * 0.35;
      const ph = U * 12 + V * 3 + w;
      const k = ((Math.floor(ph) % 4) + 4) % 4;
      const f = ph - Math.floor(ph);
      let r = 255;
      let g = 255;
      let b = 255;
      let a = 0.04;
      if (k === 0) {
        // a broad white cane with a soft edge
        const t = Math.max(0, 1 - Math.abs(f - 0.5) / 0.3);
        a = Math.max(a, Math.min(1, t * 1.6) * 0.92);
      } else if (k === 2) {
        // a pair of thin gold threads
        const t = Math.max(0, 1 - Math.abs(f - 0.32) / 0.1) + Math.max(0, 1 - Math.abs(f - 0.68) / 0.1);
        if (t > 0) {
          r = 240;
          g = 176;
          b = 64;
          a = Math.max(a, Math.min(1, t * 1.5) * 0.9);
        }
      }
      // the net: hair-thin white threads twisting the other way
      const ph2 = U * 24 - V * 6 - w;
      const f2 = ph2 - Math.floor(ph2);
      const net = Math.max(0, 1 - Math.abs(f2 - 0.5) / 0.09);
      a = Math.max(a, net * 0.4);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = a * 255;
    }
  bubbles(img.data, seed + 1, 46);
  ctx.putImageData(img, 0, 0);
  return tex(c, true);
}

const MURRINE: Array<[number, number, number]> = [
  [240, 119, 43],
  [226, 170, 44],
  [24, 163, 155],
  [201, 58, 102],
  [245, 236, 214],
  [42, 87, 216],
  [250, 250, 250],
  [120, 30, 90],
];

/** Millefiori: packed murrine, each a little flower of concentric canes, fused in dark cobalt. */
function millefiori(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const N = 8;
  const cell = S / N;
  const hash = (ix: number, iy: number, k: number) => {
    const h = Math.sin((((ix % N) + N) % N) * 127.1 + (((iy % N) + N) % N) * 311.7 + k * 74.7 + seed * 13.3) * 43758.5453;
    return h - Math.floor(h);
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const gy = Math.floor(y / cell);
      let best = 9;
      let bx = 0;
      let by = 0;
      let bdx = 0;
      let bdy = 0;
      for (let jy = gy - 1; jy <= gy + 1; jy++) {
        const off = (((jy % 2) + 2) % 2) * 0.5;
        const gx = Math.floor(x / cell - off);
        for (let jx = gx - 1; jx <= gx + 1; jx++) {
          const cx = (jx + off + 0.5 + (hash(jx, jy, 1) - 0.5) * 0.16) * cell;
          const cy = (jy + 0.5 + (hash(jx, jy, 2) - 0.5) * 0.16) * cell;
          const d = Math.hypot(x - cx, y - cy);
          if (d < best) {
            best = d;
            bx = jx;
            by = jy;
            bdx = x - cx;
            bdy = y - cy;
          }
        }
      }
      const rad = cell * (0.47 + hash(bx, by, 3) * 0.07);
      const d = Math.hypot(bdx, bdy) / rad;
      const ang = Math.atan2(bdy, bdx) + hash(bx, by, 4) * 6.28;
      const petals = 5 + Math.floor(hash(bx, by, 5) * 4);
      const c1 = MURRINE[Math.floor(hash(bx, by, 6) * MURRINE.length)];
      const c2 = MURRINE[Math.floor(hash(bx, by, 7) * MURRINE.length)];
      const c3 = MURRINE[Math.floor(hash(bx, by, 8) * MURRINE.length)];
      let col: [number, number, number] = [26, 34, 96];
      let a = 0.3;
      if (d < 1) {
        a = 0.94;
        const star = 0.42 + 0.2 * Math.cos(ang * petals);
        if (d < 0.16) col = c2;
        else if (d < star) col = c1;
        else if (d < 0.78) col = c3;
        else if (d < 0.9) col = [250, 246, 236];
        else col = c2;
        // fused edges darken a little
        const e = Math.max(0, (d - 0.86) / 0.14);
        col = [col[0] * (1 - e * 0.5), col[1] * (1 - e * 0.5), col[2] * (1 - e * 0.5)];
      }
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = a * 255;
    }
  bubbles(img.data, seed + 2, 24);
  ctx.putImageData(img, 0, 0);
  return tex(c, true);
}

/** Dichroic: slow bands of interference colour, nearly clear, with seed bubbles. */
function dichroic(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(S, S);
  const img = ctx.createImageData(S, S);
  const n = fbm(S, S, seed);
  const n2 = fbm(S, S, seed + 31);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const t = n[y * S + x] * 2.6 + n2[y * S + x] * 1.3;
      const band = 0.5 + 0.5 * Math.sin(t * 12.566);
      img.data[i] = 150 + 105 * Math.cos(6.2832 * (t + 0.0));
      img.data[i + 1] = 150 + 105 * Math.cos(6.2832 * (t + 0.33));
      img.data[i + 2] = 150 + 105 * Math.cos(6.2832 * (t + 0.67));
      img.data[i + 3] = (0.1 + band * 0.22) * 255;
    }
  bubbles(img.data, seed + 3, 70);
  ctx.putImageData(img, 0, 0);
  return tex(c, true);
}

export function glassPattern(name: GlassPatternName, seed = 1): THREE.CanvasTexture {
  return name === "swirl" ? swirl(seed) : name === "millefiori" ? millefiori(seed) : dichroic(seed);
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface GlassShared {
  uTime: { value: number };
  uEnv: { value: THREE.Texture | null };
}

export interface GlassOptions {
  pattern: THREE.Texture;
  tint: THREE.ColorRepresentation;
  /** How strongly the body glows (1 = a lit lamp shade, 0.3 = unlit glass in a warm room). */
  glow?: number;
  /** Density of the clear glass, 0..1. */
  opacity?: number;
  /** How much the pattern's canes add to the density (1 = opaque canes). */
  density?: number;
  /** Thin-film iridescence, 0..1. */
  irid?: number;
  repeat?: [number, number];
  side?: THREE.Side;
}

const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  mat4 mm = modelMatrix;
  #ifdef USE_INSTANCING
  mm = modelMatrix * instanceMatrix;
  #endif
  vec4 w = mm * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(mm) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GLASS_FRAG = /* glsl */ `
uniform sampler2D uPattern;
uniform sampler2D uEnv;
uniform vec3 uTint;
uniform float uGlow;
uniform float uOpacity;
uniform float uDensity;
uniform float uIrid;
uniform float uTime;
uniform vec2 uRepeat;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
vec2 equirect(vec3 d) { return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5); }
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  if (!gl_FrontFacing) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  vec4 pat = texture2D(uPattern, vUv * uRepeat);
  vec3 body = pat.rgb * uTint;
  vec3 env = texture2D(uEnv, equirect(reflect(-v, n))).rgb;
  // thin film: the hue walks with the view angle and the thickness of the glass
  vec3 film = 0.5 + 0.5 * cos(6.2832 * (ndv * 1.3 + pat.a * 0.35 + vec3(0.0, 0.33, 0.67)) + uTime * 0.15);
  float lum = dot(env, vec3(0.3, 0.6, 0.1));
  vec3 spec = env * (0.07 + 0.85 * fres) + env * smoothstep(0.5, 0.95, lum) * 1.3;
  spec *= mix(vec3(1.0), film * 1.7, uIrid);
  float a = clamp(uOpacity + pat.a * uDensity + fres * 0.35, 0.0, 0.96);
  // lit from within: the middle glows, the rim (more glass along the eye line) is deeper in colour
  vec3 inner = body * uGlow * (0.4 + 0.8 * ndv) + body * body * fres * uGlow * 0.6;
  vec3 col = inner * a + spec + film * uIrid * fres * 0.22;
  gl_FragColor = vec4(col, a);
  ${OUTPUT_CHUNKS}
}`;

export function cheapGlass(shared: GlassShared, o: GlassOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GLASS_VERT,
    fragmentShader: GLASS_FRAG,
    uniforms: {
      uTime: shared.uTime,
      uEnv: shared.uEnv,
      uPattern: { value: o.pattern },
      uTint: { value: new THREE.Color(o.tint) },
      uGlow: { value: o.glow ?? 0.6 },
      uOpacity: { value: o.opacity ?? 0.22 },
      uDensity: { value: o.density ?? 0.55 },
      uIrid: { value: o.irid ?? 0.25 },
      uRepeat: { value: new THREE.Vector2(...(o.repeat ?? [1, 1])) },
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: o.side ?? THREE.DoubleSide,
  });
}

/** The show-piece glass: real transmission and refraction. Create it only on HIGH (see `tiered`). */
export function heroGlass(o: GlassOptions & { thickness?: number }): THREE.MeshPhysicalMaterial {
  const tint = new THREE.Color(o.tint);
  const m = new THREE.MeshPhysicalMaterial({
    color: tint.clone().lerp(new THREE.Color(0xffffff), 0.35),
    map: o.pattern,
    transmission: 0.9,
    thickness: o.thickness ?? 0.3,
    ior: 1.5,
    dispersion: 4,
    iridescence: Math.min(1, (o.irid ?? 0.25) * 2),
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [180, 520],
    roughness: 0.06,
    metalness: 0,
    attenuationColor: tint,
    attenuationDistance: 0.9,
    envMapIntensity: 2.4,
    emissive: tint,
    emissiveIntensity: (o.glow ?? 0.6) * 0.22,
    emissiveMap: o.pattern,
    side: o.side === THREE.DoubleSide ? THREE.FrontSide : (o.side ?? THREE.FrontSide),
  });
  return m;
}

export interface Tier {
  low: THREE.Material;
  /** Made on first use, so LOW never pays for it. */
  high: () => THREE.Material;
  made?: THREE.Material;
}

/** Give a mesh a cheap material and a lazily made show material; the engine picks by quality. */
export function tiered<T extends THREE.Mesh>(mesh: T, low: THREE.Material, high: () => THREE.Material): T {
  mesh.material = low;
  (mesh.userData as { tier?: Tier }).tier = { low, high };
  return mesh;
}

/** Swap every tiered mesh under `root` to the material of the given quality. */
export function applyTier(root: THREE.Object3D, high: boolean) {
  root.traverse((o) => {
    const t = (o.userData as { tier?: Tier }).tier;
    if (!t) return;
    const mesh = o as THREE.Mesh;
    if (high) mesh.material = t.made ??= t.high();
    else mesh.material = t.low;
    // show glass refracts what is behind it; keep it out of the cheap transparent queue's order
    mesh.renderOrder = high ? 0 : mesh.userData.lowOrder ?? 0;
  });
}

// ---------------------------------------------------------------------------
// Blown shapes
// ---------------------------------------------------------------------------

export interface BlownOptions {
  /** Radial segments. */
  segments?: number;
  /** Ribs pressed into the gather (costolato): how many, how deep (fraction of the radius). */
  ribs?: number;
  ribDepth?: number;
  /** Turns the ribs make from foot to lip. */
  twist?: number;
  /** Rings sampled along the smoothed profile. */
  rings?: number;
}

/**
 * A blown form: the profile (radius, height pairs, foot first) is smoothed, turned on the lathe,
 * then optionally ribbed and twisted the way a gather is pressed in an optic mould and spun.
 */
export function blown(profile: Array<[number, number]>, o: BlownOptions = {}): THREE.BufferGeometry {
  const rings = o.rings ?? 28;
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)));
  const pts = curve.getPoints(rings);
  const geo = new THREE.LatheGeometry(pts, o.segments ?? 32);
  if (o.ribs) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const y0 = pts[0].y;
    const y1 = pts[pts.length - 1].y;
    const depth = o.ribDepth ?? 0.06;
    const twist = (o.twist ?? 0) * Math.PI * 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const t = (y - y0) / (y1 - y0 || 1);
      const k = 1 + depth * Math.cos(o.ribs * a + twist * t);
      pos.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    // the lathe's seam: copy the first column's normals onto the last so the join stays smooth
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const cols = (o.segments ?? 32) + 1;
    const rows = pts.length;
    for (let rI = 0; rI < rows; rI++) {
      const a = rI;
      const b = (cols - 1) * rows + rI;
      const nx = nrm.getX(a) + nrm.getX(b);
      const ny = nrm.getY(a) + nrm.getY(b);
      const nz = nrm.getZ(a) + nrm.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(a, nx / l, ny / l, nz / l);
      nrm.setXYZ(b, nx / l, ny / l, nz / l);
    }
  }
  return geo;
}

/** Stock profiles (unit sized: scale the mesh). Foot first, y up. */
export const FORMS = {
  /** A teardrop pendant hanging from its tip at y = 0, the belly at the bottom. */
  drop: [
    [0.02, 0],
    [0.05, -0.08],
    [0.1, -0.3],
    [0.24, -0.62],
    [0.3, -0.82],
    [0.22, -0.97],
    [0.02, -1.02],
  ] as Array<[number, number]>,
  /** A bell shade, open downwards, hung from y = 0. */
  bell: [
    [0.06, 0],
    [0.1, -0.06],
    [0.2, -0.16],
    [0.3, -0.36],
    [0.36, -0.6],
    [0.46, -0.78],
    [0.6, -0.86],
  ] as Array<[number, number]>,
  /** A globe with a short neck, standing on y = 0. */
  globe: [
    [0.12, 0],
    [0.3, 0.04],
    [0.48, 0.26],
    [0.5, 0.5],
    [0.44, 0.76],
    [0.26, 0.94],
    [0.14, 1.0],
  ] as Array<[number, number]>,
  /** A gourd vase standing on y = 0. */
  gourd: [
    [0.16, 0],
    [0.3, 0.03],
    [0.42, 0.22],
    [0.36, 0.46],
    [0.2, 0.62],
    [0.26, 0.8],
    [0.2, 0.94],
    [0.24, 1.0],
  ] as Array<[number, number]>,
};
