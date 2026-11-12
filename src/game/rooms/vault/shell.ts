import * as THREE from "three";
import type { Palette } from "../../art/materials";
import { additive, archPath, faceCentre, gyroOrnament, OUTPUT_CHUNKS, polar } from "../../art/kit";
import { makeMotes, makeShaft, makeShards, makeSky } from "../../art/void";

/**
 * The Vault's architecture: a twelve-sided hall of pearl walls between ivory pillars, a ribbed
 * dome with an oculus onto the Void, arched windows, two doors, a holographic ticker ring,
 * floating ornaments, light shafts and the lights themselves.
 */

export const R = 12; // vertex radius of the 12-gon
export const APOTHEM = R * Math.cos(Math.PI / 12);
export const WALL_H = 6.4;
export const DOME_H = 7.6;
export const OCULUS = 2.4;
export const SEG_W = 2 * R * Math.sin(Math.PI / 12);

export type SegmentKind = "wall" | "window" | "door-sealed" | "door-open";

/** What stands in each of the twelve wall segments, by angle (degrees clockwise from north). */
export const SEGMENTS: Record<number, SegmentKind> = {
  0: "door-sealed",
  30: "window",
  60: "door-open",
  90: "wall",
  120: "wall",
  150: "window",
  180: "window",
  210: "window",
  240: "wall",
  270: "wall",
  300: "wall",
  330: "window",
};

const WINDOW = { half: 1.75, sill: 1.0, spring: 3.9 };
const DOOR = { half: 1.45, sill: 0, spring: 2.85 };

export interface Shell {
  group: THREE.Group;
  ticker: THREE.Mesh;
  tickerTexture: (tex: THREE.Texture) => void;
  update(dt: number, t: number): void;
}

const GLASS_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  float sheen = 0.5 + 0.5 * sin((vUv.x + vUv.y) * 9.0 + uTime * 0.12);
  float a = 0.035 + 0.04 * sheen * smoothstep(0.0, 1.0, vUv.y);
  gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * a, a);
  ${OUTPUT_CHUNKS}
}`;
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function buildShell(p: Palette, scene: THREE.Scene): Shell {
  const group = new THREE.Group();
  group.name = "vault-shell";
  const updates: Array<(dt: number, t: number) => void> = [];

  // --- the Void outside
  const sky = makeSky();
  scene.add(sky);
  const shards = makeShards(p.gold);
  scene.add(shards.group);
  updates.push((dt, t) => {
    (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    shards.update(dt);
  });

  // --- floor
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 96), p.floor);
  floor.rotation.x = -Math.PI / 2;
  // the canvas is drawn with +y down the page; map it so the medallion is centred
  group.add(floor);

  // --- walls, one segment at a time
  const glassMat = additive(new THREE.ShaderMaterial({ vertexShader: UV_VERT, fragmentShader: GLASS_FRAG, uniforms: { uTime: { value: 0 } }, side: THREE.DoubleSide }));
  updates.push((_dt, t) => (glassMat.uniforms.uTime.value = t));
  const revealMat = p.ivory;

  for (const [degS, kind] of Object.entries(SEGMENTS)) {
    const deg = Number(degS);
    const seg = new THREE.Group();
    seg.position.copy(polar(deg, APOTHEM));
    seg.rotation.y = faceCentre(deg);
    group.add(seg);

    const shape = new THREE.Shape();
    shape.moveTo(-SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, WALL_H);
    shape.lineTo(-SEG_W / 2, WALL_H);
    shape.closePath();
    const opening = kind === "window" ? WINDOW : kind === "wall" ? null : DOOR;
    if (opening) shape.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
    const wallGeo = new THREE.ShapeGeometry(shape, 24);
    // world-scale UVs: one tile per 2 m
    const uv = wallGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.tile + 0.5, uv.getY(i) * p.tile);
    const wall = new THREE.Mesh(wallGeo, p.pearl);
    seg.add(wall);

    // cornice band on every segment, base band where there is no door
    const cornice = new THREE.Mesh(new THREE.PlaneGeometry(SEG_W, 0.42), p.filigree);
    cornice.position.set(0, WALL_H - 0.5, 0.012);
    setBandUV(cornice.geometry as THREE.PlaneGeometry, SEG_W / 2);
    seg.add(cornice);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.12, 0.3), p.gold);
    ledge.position.set(0, WALL_H - 0.24, 0.12);
    seg.add(ledge);
    if (!kind.startsWith("door")) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.32, 0.12), p.ivory);
      base.position.set(0, 0.16, 0.06);
      seg.add(base);
      const baseTrim = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.035, 0.14), p.gold);
      baseTrim.position.set(0, 0.33, 0.06);
      seg.add(baseTrim);
    }

    if (opening) {
      // reveal: the thickness of the wall around the opening, with a gold lip
      const outer = archPath(new THREE.Shape(), opening.half + 0.22, opening.sill, opening.spring) as THREE.Shape;
      outer.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
      const reveal = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false, curveSegments: 24 }), revealMat);
      reveal.position.z = -0.62;
      seg.add(reveal);
      const lip = new THREE.Mesh(new THREE.TubeGeometry(new ArchCurve(opening.half + 0.16, opening.sill, opening.spring), 64, 0.05, 6, false), p.gold);
      lip.position.z = 0.1;
      seg.add(lip);
      const keystone = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), p.gold);
      keystone.scale.set(0.8, 1.3, 0.4);
      keystone.position.set(0, opening.spring + opening.half + 0.22, 0.1);
      seg.add(keystone);
    }

    if (kind === "window") {
      const glassShape = archPath(new THREE.Shape(), WINDOW.half, WINDOW.sill, WINDOW.spring) as THREE.Shape;
      const glass = new THREE.Mesh(new THREE.ShapeGeometry(glassShape, 24), glassMat);
      setShapeUV(glass.geometry as THREE.BufferGeometry, WINDOW.half * 2, WINDOW.spring + WINDOW.half);
      glass.position.z = -0.4;
      seg.add(glass);
      // tracery: a mullion, a transom and a ring in the arch
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.07, WINDOW.spring - WINDOW.sill, 0.07), p.gold);
      mull.position.set(0, (WINDOW.spring + WINDOW.sill) / 2, -0.38);
      seg.add(mull);
      const transom = new THREE.Mesh(new THREE.BoxGeometry(WINDOW.half * 2, 0.06, 0.06), p.gold);
      transom.position.set(0, WINDOW.spring, -0.38);
      seg.add(transom);
      const rose = new THREE.Mesh(new THREE.TorusGeometry(WINDOW.half * 0.55, 0.035, 8, 48), p.gold);
      rose.position.set(0, WINDOW.spring + WINDOW.half * 0.45, -0.38);
      seg.add(rose);
      const roseCore = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), p.cyanGlow);
      roseCore.position.copy(rose.position);
      seg.add(roseCore);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(WINDOW.half * 2 + 0.5, 0.1, 0.9), p.ivory);
      sill.position.set(0, WINDOW.sill - 0.05, -0.15);
      seg.add(sill);
    }

    if (kind === "door-sealed") seg.add(sealedDoor(p));
    if (kind === "door-open") seg.add(corridor(p));
  }

  // --- pillars at the corners
  const pillarGeo = new THREE.CylinderGeometry(0.36, 0.42, WALL_H, 20);
  const baseGeo = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.62, 0), new THREE.Vector2(0.6, 0.22), new THREE.Vector2(0.5, 0.3), new THREE.Vector2(0.46, 0.5), new THREE.Vector2(0.0, 0.5)], 24);
  const capGeo = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.4, 0), new THREE.Vector2(0.5, 0.18), new THREE.Vector2(0.62, 0.32), new THREE.Vector2(0.64, 0.42), new THREE.Vector2(0.0, 0.42)], 24);
  const ringGeo = new THREE.TorusGeometry(0.4, 0.035, 8, 32);
  const sconceCup = new THREE.LatheGeometry([new THREE.Vector2(0.0, -0.12), new THREE.Vector2(0.03, -0.1), new THREE.Vector2(0.05, 0.0), new THREE.Vector2(0.13, 0.12), new THREE.Vector2(0.15, 0.16)], 12);
  sconceCup.translate(0, 0, 0.14);
  const sconceFlame = new THREE.OctahedronGeometry(0.06, 0);
  const sconceMat = p.gold.clone();
  sconceMat.side = THREE.DoubleSide;
  const haloGeo = new THREE.PlaneGeometry(1.6, 2.2);
  const haloMat = additive(
    new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vec2 d = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 0.75);
          float a = exp(-dot(d, d) * 14.0) * 0.4;
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a, a);
          ${OUTPUT_CHUNKS}
        }`,
    }),
  );
  for (let k = 0; k < 12; k++) {
    const deg = k * 30 + 15;
    const at = polar(deg, R - 0.2);
    const pillar = new THREE.Group();
    pillar.position.copy(at);
    group.add(pillar);
    const shaft = new THREE.Mesh(pillarGeo, p.pearlPlain);
    shaft.position.y = WALL_H / 2;
    pillar.add(shaft);
    pillar.add(new THREE.Mesh(baseGeo, p.ivory));
    const cap = new THREE.Mesh(capGeo, p.gold);
    cap.position.y = WALL_H - 0.6;
    pillar.add(cap);
    for (const y of [0.55, 1.4, WALL_H - 0.75]) {
      const ring = new THREE.Mesh(ringGeo, p.gold);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      pillar.add(ring);
    }
    // a cyan filament up the inner face, and a sconce with a soft halo of light on the pillar
    const fil = new THREE.Mesh(new THREE.BoxGeometry(0.03, WALL_H - 2.6, 0.03), p.cyanGlow);
    fil.position.copy(polar(deg, -0.41)).setY(0.95 + (WALL_H - 2.6) / 2);
    pillar.add(fil);
    const sconce = new THREE.Group();
    sconce.position.copy(polar(deg, -0.46)).setY(3.05);
    sconce.rotation.y = faceCentre(deg);
    pillar.add(sconce);
    const cup = new THREE.Mesh(sconceCup, sconceMat);
    sconce.add(cup);
    const flame = new THREE.Mesh(sconceFlame, p.goldGlow);
    flame.position.set(0, 0.27, 0.14);
    flame.scale.y = 1.8;
    sconce.add(flame);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0.3, 0.02);
    sconce.add(halo);
  }

  // --- the ledge ring that closes the gap between the flat walls and the round dome
  const ledgeRing = new THREE.Mesh(new THREE.RingGeometry(APOTHEM - 0.3, R + 0.4, 96, 1), p.ivory);
  ledgeRing.rotation.x = Math.PI / 2;
  ledgeRing.position.y = WALL_H;
  group.add(ledgeRing);

  // --- dome with oculus
  const theta0 = Math.asin(OCULUS / R);
  const domeGeo = new THREE.SphereGeometry(1, 96, 32, 0, Math.PI * 2, theta0, Math.PI / 2 - theta0);
  // the wall tile, repeated as coffers across the dome
  const domeMap = p.pearl.map!.clone();
  const domeMr = (p.pearl.roughnessMap as THREE.Texture).clone();
  for (const t of [domeMap, domeMr]) {
    t.repeat.set(24, 5);
    t.needsUpdate = true;
  }
  const domeMat = new THREE.MeshPhysicalMaterial({ map: domeMap, roughnessMap: domeMr, metalnessMap: domeMr, roughness: 1, metalness: 1, color: 0xd8d0c2, side: THREE.BackSide, iridescence: 0.4, iridescenceIOR: 1.35, clearcoat: 0.3 });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.scale.set(R, DOME_H, R);
  dome.position.y = WALL_H;
  group.add(dome);
  const domeAt = (deg: number, theta: number, inset: number) => {
    const d = polar(deg, 1);
    return new THREE.Vector3(d.x * R * Math.sin(theta) * inset, WALL_H + DOME_H * Math.cos(theta) * inset, d.z * R * Math.sin(theta) * inset);
  };
  for (let k = 0; k < 12; k++) {
    const deg = k * 30 + 15;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) pts.push(domeAt(deg, Math.PI / 2 - (i / 32) * (Math.PI / 2 - theta0), 0.985));
    const curve = new THREE.CatmullRomCurve3(pts);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.17, 8, false), p.ivory));
    const inner = new THREE.CatmullRomCurve3(pts.map((v) => v.clone().multiplyScalar(0.986).setY(WALL_H + (v.y - WALL_H) * 0.986)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(inner, 64, 0.045, 6, false), p.gold));
  }
  // rings across the ribs
  for (const theta of [1.05, 0.62]) {
    const r = R * Math.sin(theta) * 0.975;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.08, 8, 128), p.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = WALL_H + DOME_H * Math.cos(theta) * 0.975;
    group.add(ring);
  }
  const oculusY = WALL_H + DOME_H * Math.cos(theta0);
  const oculus = new THREE.Mesh(new THREE.TorusGeometry(OCULUS, 0.22, 12, 96), p.gold);
  oculus.rotation.x = Math.PI / 2;
  oculus.position.y = oculusY;
  group.add(oculus);
  const oculusGlow = new THREE.Mesh(new THREE.TorusGeometry(OCULUS - 0.24, 0.025, 6, 96), p.cyanGlow);
  oculusGlow.rotation.x = Math.PI / 2;
  oculusGlow.position.y = oculusY - 0.1;
  group.add(oculusGlow);

  // --- ticker ring: a band of light floating in front of the walls
  const tickerGeo = new THREE.CylinderGeometry(10.9, 10.9, 0.44, 160, 1, true);
  flipU(tickerGeo);
  const tickerMat = additive(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false }), false);
  const ticker = new THREE.Mesh(tickerGeo, tickerMat);
  ticker.position.y = 4.45;
  ticker.renderOrder = 6;
  group.add(ticker);
  const tickerBack = new THREE.Mesh(
    new THREE.CylinderGeometry(10.93, 10.93, 0.5, 160, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x04101c, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false }),
  );
  tickerBack.position.y = 4.45;
  group.add(tickerBack);
  for (const dy of [-0.27, 0.27]) {
    const edge = new THREE.Mesh(new THREE.TorusGeometry(10.9, 0.012, 4, 200), p.cyanGlow);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 4.45 + dy;
    group.add(edge);
  }

  // --- floating ornaments
  const crown = gyroOrnament(1.15, p.gold, p.cyanGlow, p.pearlPlain);
  crown.group.position.set(0, 10.6, 0);
  group.add(crown.group);
  const small = [45, 135, 225, 315].map((deg, i) => {
    const o = gyroOrnament(0.45, p.gold, i % 2 ? p.goldGlow : p.cyanGlow, p.pearlPlain);
    o.group.position.copy(polar(deg, 6.4, 8.4));
    group.add(o.group);
    return { o, base: o.group.position.y, ph: i * 1.7 };
  });
  const diamonds: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), i % 3 ? p.gold : p.cyanGlow);
    d.scale.y = 1.8;
    group.add(d);
    diamonds.push(d);
  }
  updates.push((_dt, t) => {
    crown.update(t);
    crown.group.position.y = 10.6 + Math.sin(t * 0.4) * 0.15;
    for (const s of small) {
      s.o.update(t + s.ph);
      s.o.group.position.y = s.base + Math.sin(t * 0.5 + s.ph) * 0.25;
    }
    diamonds.forEach((d, i) => {
      const a = t * 0.05 + (i / diamonds.length) * Math.PI * 2;
      const r = 8.5 + Math.sin(i * 2.3) * 0.8;
      d.position.set(Math.sin(a) * r, 7.9 + Math.sin(t * 0.6 + i) * 0.35, -Math.cos(a) * r);
      d.rotation.y = t * 0.8 + i;
    });
  });

  // --- light: shafts and lamps
  const shafts = [
    makeShaft(new THREE.Vector3(0, oculusY + 0.5, 0), new THREE.Vector3(0, 7.8, 0), 3.6, 0xfff1d0, 0.05),
    ...[30, 330, 180].map((deg) => {
      const from = polar(deg, APOTHEM + 0.6, 4.9);
      const to = polar(deg, 5.2, 0.0);
      to.add(polar(deg + 90, 1.2));
      return makeShaft(from, to, 2.4, 0xcfe6ff, 0.05);
    }),
  ];
  for (const s of shafts) group.add(s.group);
  updates.push((_dt, t) => shafts.forEach((s) => (s.material.uniforms.uTime.value = t)));

  const motes = makeMotes(420, 10, p.dot, 1);
  group.add(motes);
  updates.push((_dt, t) => ((motes.material as THREE.ShaderMaterial).uniforms.uTime.value = t));

  group.add(new THREE.HemisphereLight(0xc4ccff, 0x2c2232, 0.22));
  const sun = new THREE.DirectionalLight(0xbcd2ff, 0.35);
  sun.position.set(-6, 12, 9);
  group.add(sun);
  const spot = new THREE.SpotLight(0xfff0d2, 22, 26, 0.5, 0.9, 1.3);
  spot.position.set(0, oculusY, 0);
  spot.target.position.set(0, 0, 0);
  group.add(spot, spot.target);
  const rim = new THREE.PointLight(0x7f6bff, 3, 18, 1.5);
  rim.position.set(0, 9.5, 0);
  group.add(rim);

  scene.add(group);
  return {
    group,
    ticker,
    tickerTexture(tex) {
      tickerMat.map = tex;
      tickerMat.needsUpdate = true;
    },
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
  };
}

/** An arch outline as a curve (for tubes along an opening). */
class ArchCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private half: number,
    private sill: number,
    private spring: number,
  ) {
    super();
  }
  getPoint(t: number, out = new THREE.Vector3()) {
    const jamb = this.spring - this.sill;
    const arc = Math.PI * this.half;
    const total = jamb * 2 + arc;
    let d = t * total;
    if (d < jamb) return out.set(-this.half, this.sill + d, 0);
    d -= jamb;
    if (d < arc) {
      const a = Math.PI - d / this.half;
      return out.set(Math.cos(a) * this.half, this.spring + Math.sin(a) * this.half, 0);
    }
    d -= arc;
    return out.set(this.half, this.spring - d, 0);
  }
}

function setBandUV(geo: THREE.PlaneGeometry, repeatX: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeatX);
}

function setShapeUV(geo: THREE.BufferGeometry, w: number, h: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / w + 0.5, uv.getY(i) / h);
}

function flipU(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
}

/** The sealed door to the next sector: two pearl leaves, a glowing seam, a seal of rings. */
function sealedDoor(p: Palette): THREE.Group {
  const g = new THREE.Group();
  for (const side of [-1, 1]) {
    const s = new THREE.Shape();
    if (side < 0) {
      s.moveTo(-DOOR.half, 0);
      s.lineTo(-0.01, 0);
      s.lineTo(-0.01, DOOR.spring + DOOR.half);
      s.absarc(0, DOOR.spring, DOOR.half, Math.PI / 2, Math.PI, false);
      s.lineTo(-DOOR.half, 0);
    } else {
      s.moveTo(0.01, 0);
      s.lineTo(DOOR.half, 0);
      s.lineTo(DOOR.half, DOOR.spring);
      s.absarc(0, DOOR.spring, DOOR.half, 0, Math.PI / 2, false);
      s.lineTo(0.01, 0);
    }
    const leaf = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1, curveSegments: 24 }), p.pearlPlain);
    leaf.position.z = -0.35;
    g.add(leaf);
    // relief ribs on each leaf
    for (let k = 0; k < 3; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2 - k * 0.4, 0.05), p.gold);
      rib.position.set(side * (0.35 + k * 0.32), 1.3 + k * 0.1, -0.2);
      g.add(rib);
    }
  }
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, DOOR.spring + DOOR.half - 0.1, 0.02), p.cyanGlow);
  seam.position.set(0, (DOOR.spring + DOOR.half) / 2, -0.2);
  g.add(seam);
  const seal = new THREE.Group();
  seal.position.set(0, 2.3, -0.16);
  for (const [r, w] of [
    [0.62, 0.05],
    [0.48, 0.025],
    [0.3, 0.04],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 64), p.gold);
    seal.add(ring);
  }
  const tri = new THREE.Mesh(new THREE.CircleGeometry(0.22, 3), p.cyanGlow);
  tri.rotation.z = Math.PI / 2;
  tri.position.z = 0.02;
  seal.add(tri);
  for (let k = 0; k < 8; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), p.gold);
    const a = (k / 8) * Math.PI * 2;
    spoke.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0);
    spoke.rotation.z = a + Math.PI / 2;
    seal.add(spoke);
  }
  g.add(seal);
  return g;
}

/** The customers' entrance: a short corridor behind an open arch, lit cyan along the floor. */
function corridor(p: Palette): THREE.Group {
  const g = new THREE.Group();
  const depth = 7;
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2836, roughness: 0.6, metalness: 0.3, side: THREE.BackSide });
  const box = new THREE.Mesh(new THREE.BoxGeometry(DOOR.half * 2 + 0.2, 4.6, depth), mat);
  box.position.set(0, 2.3, -0.6 - depth / 2);
  g.add(box);
  for (const x of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, depth), p.cyanGlow);
    strip.position.set(x * (DOOR.half - 0.1), 0.02, -0.6 - depth / 2);
    g.add(strip);
  }
  for (let k = 0; k < 4; k++) {
    const arch = new THREE.Mesh(new THREE.TorusGeometry(DOOR.half, 0.05, 6, 32, Math.PI), p.goldDark);
    arch.position.set(0, DOOR.spring, -1.5 - k * 1.6);
    g.add(arch);
  }
  const lamp = new THREE.PointLight(0x2ad4e6, 5, 8, 1.6);
  lamp.position.set(0, 3.2, -3.5);
  g.add(lamp);
  return g;
}
