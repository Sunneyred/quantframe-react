import * as THREE from "three";
import { chandelier, haloMaterial, hangingLamp, lightPatches, sconce, type LightPatch } from "../../art/fixtures";
import { tiered } from "../../art/glass";
import { additive, archPath, Batch, faceCentre, OUTPUT_CHUNKS, polar } from "../../art/kit";
import type { EnamelName, GlassName, Palette } from "../../art/materials";
import { banquette, boxM, Idlers, instrumentCluster, reelUnit, scaleUV } from "../../art/props";
import { makeMotes, makePlanets, makeShaft, makeShards, makeSky } from "../../art/void";

/**
 * The Vault's architecture: the ship's lounge. Twelve bays of candy enamel panels over a tufted
 * leather wainscot, between cream columns with chrome bands and blown-glass sconces; arched
 * windows onto deep space with art-glass lunettes that throw coloured light on the floor; a padded
 * plum ceiling on brass ribs with an oculus, from which the great glass chandelier hangs around
 * the reservoir; the ticker ring; the lights.
 *
 * Almost all of it is merged by material (see `Batch`): the shell is a few dozen draw calls.
 */

export const R = 12; // vertex radius of the 12-gon
export const APOTHEM = R * Math.cos(Math.PI / 12);
export const WALL_H = 6.4;
export const DOME_H = 7.6;
export const OCULUS = 2.4;
export const SEG_W = 2 * R * Math.sin(Math.PI / 12);

export type SegmentKind = "wall" | "window" | "door-sealed" | "door-open" | "door-arch";

/** What stands in each of the twelve wall segments, by angle (degrees clockwise from north). */
export const SEGMENTS: Record<number, SegmentKind> = {
  0: "door-arch", // to the Market Observatory (rooms/observatory)
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

/** The enamel of each bay, and the glass of each window's lunette. */
const BAY: Record<number, EnamelName> = { 0: "cream", 30: "cream", 60: "cream", 90: "tangerine", 120: "mustard", 150: "cream", 180: "cream", 210: "cream", 240: "mustard", 270: "teal", 300: "tangerine", 330: "cream" };
const LUNETTE: Record<number, GlassName> = { 30: "teal", 150: "rose", 180: "murrine", 210: "amber", 330: "cobalt" };
const LIGHT: Record<GlassName, number> = { teal: 0x35d6c8, rose: 0xff6f96, murrine: 0xffc06a, amber: 0xffa63a, cobalt: 0x5a86ff, clear: 0xffffff, opal: 0xffe6c0 };

const WINDOW = { half: 1.75, sill: 1.0, spring: 3.9 };
const DOOR = { half: 1.45, sill: 0, spring: 2.85 };
const WAINSCOT = 0.98;

export interface Shell {
  group: THREE.Group;
  ticker: THREE.Mesh;
  tickerTexture: (tex: THREE.Texture) => void;
  update(dt: number, t: number): void;
}

export function buildShell(p: Palette, scene: THREE.Scene): Shell {
  // lunette glass: back-lit by the sky, so it glows more than room glass and is denser
  // window panes: clear, a faint dichroic sheen, the room mirrored at grazing angles
  const paneGlass = p.glassLike("clear", { opacity: 0, density: 0.1, glow: 0.25, irid: 0.1, repeat: [0.5, 0.5], side: THREE.FrontSide });
  const lunetteMats = new Map<GlassName, THREE.Material>();
  const lunetteGlass = (kind: GlassName) => {
    let m = lunetteMats.get(kind);
    if (!m) lunetteMats.set(kind, (m = p.glassLike(kind, { glow: 1.5, opacity: 0.55, repeat: kind === "murrine" ? [2.4, 2.4] : [0.8, 0.8], side: THREE.FrontSide })));
    return m;
  };
  const group = new THREE.Group();
  group.name = "vault-shell";
  const updates: Array<(dt: number, t: number) => void> = [];
  const b = new Batch();
  const idlers = new Idlers(p);

  // --- deep space outside
  const sky = makeSky();
  scene.add(sky);
  const shards = makeShards(p.brass);
  scene.add(shards.group);
  const planets = makePlanets();
  scene.add(planets.group);
  updates.push((dt, t) => {
    (sky.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    shards.update(dt);
    planets.update(dt);
  });

  // --- floor (the canvas is drawn once for the whole disc)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 96), p.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // --- walls, one bay at a time
  const patches: LightPatch[] = [];
  const haloGeo = new THREE.PlaneGeometry(1.5, 1.9);
  const halos = new Batch();
  const haloMat = haloMaterial(0xffc890, 0.42);
  for (const [degS, kind] of Object.entries(SEGMENTS)) {
    const deg = Number(degS);
    const seg = b.at(...(polar(deg, APOTHEM).toArray() as [number, number, number]), faceCentre(deg));
    const door = kind.startsWith("door");

    const shape = new THREE.Shape();
    shape.moveTo(-SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, WALL_H);
    shape.lineTo(-SEG_W / 2, WALL_H);
    shape.closePath();
    const opening = kind === "window" ? WINDOW : kind === "wall" ? null : DOOR;
    if (opening) shape.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
    const wallGeo = new THREE.ShapeGeometry(shape, 24);
    // the baked shade over the same shape: dark at the foot and under the cornice
    const shadeGeo = wallGeo.clone();
    const suv = shadeGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < suv.count; i++) suv.setXY(i, 0.5, suv.getY(i) / WALL_H);
    seg.put(shadeGeo, p.wallShade, [0, 0, 0.006]);
    // world-scale UVs: one enamel panel per 2 m
    const uv = wallGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.tile + 0.5, uv.getY(i) * p.tile);
    seg.put(wallGeo, p.enamel[BAY[deg]]);

    // cornice: the riveted brass band under a walnut crown with a chrome bead
    const band = new THREE.PlaneGeometry(SEG_W, 0.42);
    scaleUV(band, SEG_W / 2, 1);
    seg.put(band, p.filigree, [0, WALL_H - 0.5, 0.012]);
    seg.put(boxM(SEG_W, 0.14, 0.34), p.wood, [0, WALL_H - 0.2, 0.15]);
    seg.put(new THREE.CylinderGeometry(0.03, 0.03, SEG_W, 8), p.chrome, [0, WALL_H - 0.29, 0.3], [0, 0, Math.PI / 2]);
    seg.put(new THREE.CylinderGeometry(0.02, 0.02, SEG_W, 6), p.brass, [0, WALL_H - 0.74, 0.03], [0, 0, Math.PI / 2]);

    if (!door) {
      // wainscot: walnut skirting, tufted leather, a brass dado rail
      const w = kind === "window" ? SEG_W : SEG_W;
      seg.put(boxM(w, 0.16, 0.1), p.wood, [0, 0.08, 0.05]);
      if (kind === "wall") seg.put(boxM(w - 0.5, WAINSCOT - 0.2, 0.06, 2.5), p.leather, [0, 0.16 + (WAINSCOT - 0.2) / 2, 0.03]);
      seg.put(boxM(w, 0.07, 0.11), p.wood, [0, WAINSCOT + 0.0, 0.055]);
      seg.put(new THREE.CylinderGeometry(0.022, 0.022, w, 8), p.brass, [0, WAINSCOT + 0.06, 0.09], [0, 0, Math.PI / 2]);
    }

    if (opening) {
      // reveal: the thickness of the wall around the opening, a brass lip on the room side
      const outer = archPath(new THREE.Shape(), opening.half + 0.22, opening.sill, opening.spring) as THREE.Shape;
      outer.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
      seg.put(new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false, curveSegments: 24 }), p.wood, [0, 0, -0.62]);
      seg.put(new THREE.TubeGeometry(new ArchCurve(opening.half + 0.16, opening.sill, opening.spring), 40, 0.05, 6, false), p.brass, [0, 0, 0.1]);
    }

    if (kind === "window") {
      const glassKind = LUNETTE[deg] ?? "amber";
      // the pane: clear glass that mirrors the room at grazing angles
      const pane = new THREE.Shape();
      pane.moveTo(-WINDOW.half, WINDOW.sill);
      pane.lineTo(WINDOW.half, WINDOW.sill);
      pane.lineTo(WINDOW.half, WINDOW.spring);
      pane.lineTo(-WINDOW.half, WINDOW.spring);
      pane.closePath();
      seg.put(new THREE.ShapeGeometry(pane), paneGlass, [0, 0, -0.4]);
      // the lunette: art glass in the arch, leaded with brass
      const lun = new THREE.Shape();
      lun.moveTo(-WINDOW.half, WINDOW.spring);
      lun.lineTo(WINDOW.half, WINDOW.spring);
      lun.absarc(0, WINDOW.spring, WINDOW.half, 0, Math.PI, false);
      const lunGeo = new THREE.ShapeGeometry(lun, 24);
      const luv = lunGeo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < luv.count; i++) luv.setXY(i, luv.getX(i) / 1.75, (luv.getY(i) - WINDOW.spring) / 1.75);
      seg.put(lunGeo, lunetteGlass(glassKind), [0, 0, -0.36]);
      seg.put(new THREE.BoxGeometry(WINDOW.half * 2, 0.07, 0.07), p.brass, [0, WINDOW.spring, -0.36]);
      for (const a of [Math.PI / 4, Math.PI / 2, (Math.PI * 3) / 4]) {
        const spoke = new THREE.BoxGeometry(0.035, WINDOW.half - 0.5, 0.035);
        seg.put(spoke, p.brass, [Math.cos(a) * (WINDOW.half + 0.5) * 0.5, WINDOW.spring + Math.sin(a) * (WINDOW.half + 0.5) * 0.5, -0.35], [0, 0, a - Math.PI / 2]);
      }
      const hub = new THREE.TorusGeometry(0.5, 0.03, 6, 24, Math.PI);
      seg.put(hub, p.brass, [0, WINDOW.spring, -0.35]);
      seg.put(new THREE.BoxGeometry(0.05, WINDOW.spring - WINDOW.sill, 0.05), p.brass, [0, (WINDOW.spring + WINDOW.sill) / 2, -0.38]);
      seg.put(boxM(WINDOW.half * 2 + 0.5, 0.08, 0.86), p.wood, [0, WINDOW.sill - 0.04, -0.2]);
      // a banquette under the north windows, and an instrument on the pier beside each
      // (the south windows stay clear: a bank of terminals stands in front of them)
      if (deg === 30 || deg === 330) banquette(seg.frame(new THREE.Matrix4().makeTranslation(0, 0, 0.06)), p, WINDOW.half * 2 - 0.2);
      const pier = (SEG_W / 2 + WINDOW.half + 0.3) / 2 - 0.12;
      const here = new THREE.Matrix4().makeRotationY(faceCentre(deg)).setPosition(polar(deg, APOTHEM));
      if (deg === 30) instrumentCluster(b, idlers, p, here.clone().multiply(new THREE.Matrix4().makeTranslation(-pier, 1.75, 0.012)), 0.62);
      if (deg === 330) reelUnit(b, idlers, p, here.clone().multiply(new THREE.Matrix4().makeTranslation(pier, 1.75, 0.012)), 0.56, deg === 330 ? "teal" : "tangerine");
      // the light it throws
      patches.push({ from: polar(deg, APOTHEM - 1.0), to: polar(deg, 5.0), width: 2.5, color: LIGHT[glassKind], strength: 0.16 });
    }
    if (kind === "door-open") corridor(p, seg, group, deg);
    if (door) {
      seg.put(boxM(DOOR.half * 2 + 0.3, 0.02, 0.9), p.brassDark, [0, 0.008, -0.2]);
      patches.push({ from: polar(deg, APOTHEM - 0.4), to: polar(deg, 7.4), width: 2.2, color: 0xffb060, strength: 0.32 });
    }
  }

  // --- columns at the corners: cream enamel with chrome bands, walnut foot, a tulip capital in brass
  const shaftGeo = new THREE.CylinderGeometry(0.31, 0.35, WALL_H - 1.5, 24);
  const footGeo = new THREE.LatheGeometry([[0, 0], [0.56, 0], [0.56, 0.1], [0.46, 0.16], [0.43, 0.3], [0.41, WAINSCOT], [0.45, WAINSCOT + 0.04], [0.45, WAINSCOT + 0.1], [0.36, WAINSCOT + 0.16], [0, WAINSCOT + 0.16]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
  const capGeo = new THREE.LatheGeometry([[0, 0], [0.32, 0], [0.34, 0.1], [0.42, 0.24], [0.56, 0.36], [0.66, 0.42], [0.66, 0.5], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 24);
  const bandGeo = new THREE.TorusGeometry(0.335, 0.026, 5, 18);
  bandGeo.rotateX(Math.PI / 2);
  const sconceGlass: GlassName[] = ["amber", "opal", "amber", "rose", "amber", "teal"];
  for (let k = 0; k < 12; k++) {
    const deg = k * 30 + 15;
    const at = polar(deg, R - 0.2);
    const col = b.at(at.x, 0, at.z, faceCentre(deg));
    col.put(footGeo, p.wood);
    col.put(shaftGeo, p.paint.cream, [0, WAINSCOT + 0.14 + (WALL_H - 1.5) / 2, 0]);
    col.put(capGeo, p.brass, [0, WALL_H - 0.5, 0]);
    for (const y of [WAINSCOT + 0.3, WAINSCOT + 0.42, WALL_H - 0.62]) col.put(bandGeo, p.chrome, [0, y, 0]);
    col.put(bandGeo, p.brass, [0, WAINSCOT + 0.36, 0]);
    // the sconce on the room side, and the pool of light it leaves on the column
    const sc = col.frame(new THREE.Matrix4().makeTranslation(0, 2.95, 0.33));
    sconce(sc, p, sconceGlass[k % sconceGlass.length], 1.25);
    halos.frame(new THREE.Matrix4().makeRotationY(faceCentre(deg)).setPosition(at.x, 0, at.z)).put(haloGeo, haloMat, [0, 3.35, 0.37]);
  }

  // --- the crown: a walnut ledge closing the gap between the flat walls and the round ceiling
  const ledgeGeo = new THREE.RingGeometry(APOTHEM - 0.32, R + 0.4, 96, 1);
  scaleUV(ledgeGeo, 12, 12);
  b.put(ledgeGeo, p.wood, [0, WALL_H, 0], [Math.PI / 2, 0, 0]);

  // --- the padded ceiling with its oculus
  const theta0 = Math.asin(OCULUS / R);
  const domeGeo = new THREE.SphereGeometry(1, 72, 20, 0, Math.PI * 2, theta0, Math.PI / 2 - theta0);
  // LOW: the tufting is only painted (colour and gloss); HIGH adds the normal map
  const quilt = p.quilt.clone();
  const quiltMaps: Partial<Record<"map" | "roughnessMap" | "metalnessMap" | "normalMap", THREE.Texture>> = {};
  for (const key of ["map", "roughnessMap", "metalnessMap", "normalMap"] as const) {
    const t = (p.quilt[key] as THREE.Texture).clone();
    t.repeat.set(36, 7);
    t.needsUpdate = true;
    quiltMaps[key] = t;
    quilt[key] = key === "normalMap" ? null : t;
  }
  const dome = tiered(new THREE.Mesh(domeGeo, quilt), quilt, () => {
    const m = quilt.clone();
    m.normalMap = quiltMaps.normalMap!;
    return m;
  });
  dome.scale.set(R, DOME_H, R);
  dome.position.y = WALL_H;
  group.add(dome);
  const domeAt = (deg: number, theta: number, inset: number) => {
    const d = polar(deg, 1);
    return new THREE.Vector3(d.x * R * Math.sin(theta) * inset, WALL_H + DOME_H * Math.cos(theta) * inset, d.z * R * Math.sin(theta) * inset);
  };
  const lampGeo = new THREE.SphereGeometry(0.11, 10, 8);
  for (let k = 0; k < 12; k++) {
    const deg = k * 30 + 15;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) pts.push(domeAt(deg, Math.PI / 2 - (i / 32) * (Math.PI / 2 - theta0), 0.985));
    b.put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.13, 6, false), p.brassDark);
    const inner = new THREE.CatmullRomCurve3(pts.map((v) => v.clone().multiplyScalar(0.988).setY(WALL_H + (v.y - WALL_H) * 0.988)));
    b.put(new THREE.TubeGeometry(inner, 28, 0.045, 5, false), p.brass);
    // little cabin lamps where the ribs cross the rings
    for (const theta of [1.05, 0.62]) {
      const at = domeAt(deg, theta, 0.955);
      b.put(lampGeo, p.warmGlow, [at.x, at.y, at.z]);
    }
  }
  for (const theta of [1.05, 0.62]) {
    const r = R * Math.sin(theta) * 0.975;
    const ring = new THREE.TorusGeometry(r, 0.07, 6, 72);
    b.put(ring, p.brass, [0, WALL_H + DOME_H * Math.cos(theta) * 0.975, 0], [Math.PI / 2, 0, 0]);
  }
  const oculusY = WALL_H + DOME_H * Math.cos(theta0);
  b.put(new THREE.TorusGeometry(OCULUS, 0.22, 12, 96), p.brass, [0, oculusY, 0], [Math.PI / 2, 0, 0]);
  b.put(new THREE.TorusGeometry(OCULUS - 0.24, 0.03, 6, 96), p.warmGlow, [0, oculusY - 0.1, 0], [Math.PI / 2, 0, 0]);
  // cove light: the glow of hidden lamps behind the crown, washing up the padding
  const cove = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.985, R * 0.995, 3.2, 96, 1, true),
    additive(
      new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float a = pow(1.0 - vUv.y, 2.2) * 0.12;
            gl_FragColor = vec4(vec3(1.0, 0.62, 0.34) * a, a);
            ${OUTPUT_CHUNKS}
          }`,
        side: THREE.BackSide,
      }),
    ),
  );
  cove.position.y = WALL_H + 1.62;
  cove.renderOrder = 1;
  group.add(cove);

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
    new THREE.MeshBasicMaterial({ color: 0x120a10, transparent: true, opacity: 0.72, side: THREE.BackSide, depthWrite: false }),
  );
  tickerBack.position.y = 4.45;
  group.add(tickerBack);
  for (const dy of [-0.27, 0.27]) b.put(new THREE.TorusGeometry(10.92, 0.016, 4, 96), p.brass, [0, 4.45 + dy, 0], [Math.PI / 2, 0, 0]);

  // --- the chandelier around the reservoir's crown, and four hanging lamps further out
  const chand = chandelier(p, { radius: 3.5, drop: oculusY - 8.25, hangRadius: OCULUS - 0.1, shades: 12, lightIntensity: 70 });
  chand.group.position.y = oculusY;
  group.add(chand.group);
  updates.push((dt, t) => chand.update(dt, t));
  const lampGlass: GlassName[] = ["cobalt", "rose", "teal", "amber"];
  [45, 135, 225, 315].forEach((deg, i) => {
    const top = domeAt(deg, Math.asin(6.9 / R), 0.97);
    const lamp = hangingLamp(p, lampGlass[i], top.y - 8.0, 0.95);
    lamp.group.position.copy(top);
    group.add(lamp.group);
    updates.push((_dt, t) => lamp.update(t));
  });

  // --- light: coloured light through the glass, shafts, dust, and the lamps themselves
  const thrown = lightPatches(p, patches);
  group.add(thrown.mesh);
  const shafts = [
    makeShaft(new THREE.Vector3(0, oculusY + 0.5, 0), new THREE.Vector3(0, 9.0, 0), 3.6, 0xffe2b8, 0.035),
    ...[30, 330, 180].map((deg) => {
      const from = polar(deg, APOTHEM + 0.6, 4.9);
      const to = polar(deg, 5.2, 0.0);
      to.add(polar(deg + 90, 1.2));
      return makeShaft(from, to, 2.4, LIGHT[LUNETTE[deg]], 0.04);
    }),
  ];
  for (const s of shafts) group.add(s.group);
  updates.push((_dt, t) => {
    shafts.forEach((s) => (s.material.uniforms.uTime.value = t));
    thrown.material.uniforms.uTime.value = t;
    idlers.update(t);
  });

  const motes = makeMotes(420, 10, p.dot, 1);
  group.add(motes);
  updates.push((_dt, t) => ((motes.material as THREE.ShaderMaterial).uniforms.uTime.value = t));

  // ambient comes from the baked environment (see art/env.ts): no hemisphere or fill lights
  const spot = new THREE.SpotLight(0xffe8c8, 26, 26, 0.62, 0.9, 1.3);
  spot.position.set(0, oculusY, 0);
  spot.target.position.set(0, 0, 0);
  group.add(spot, spot.target);

  b.build(group);
  for (const m of halos.build(group)) m.renderOrder = 3;
  idlers.build();
  group.add(idlers.group);
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

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

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

function flipU(geo: THREE.BufferGeometry) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
}

/**
 * The customers' entrance: a short passage behind an open arch, plum enamel with brass hoops, warm
 * strips along the floor and a pair of glass sconces. `seg` is the bay's frame.
 */
function corridor(p: Palette, seg: Batch, group: THREE.Group, deg: number) {
  const depth = 7;
  const inside = p.paint.plum.clone();
  inside.side = THREE.BackSide;
  inside.emissive.set(0x2a0e18); // its lamps are the sconces' glow: no light of its own
  seg.put(new THREE.BoxGeometry(DOOR.half * 2 + 0.2, 4.6, depth), inside, [0, 2.3, -0.6 - depth / 2]);
  seg.put(boxM(DOOR.half * 2, 0.02, depth), p.rubber, [0, 0.012, -0.6 - depth / 2]);
  for (const x of [-1, 1]) {
    seg.put(new THREE.BoxGeometry(0.05, 0.02, depth), p.goldGlow, [x * (DOOR.half - 0.1), 0.03, -0.6 - depth / 2]);
    seg.put(boxM(0.06, 0.9, depth, 2.5), p.leather, [x * (DOOR.half + 0.06), 0.5, -0.6 - depth / 2]);
    const sc = seg.frame(new THREE.Matrix4().makeRotationY((-x * Math.PI) / 2).setPosition(x * (DOOR.half + 0.08), 2.2, -3.2));
    sconce(sc, p, x < 0 ? "teal" : "rose", 1.1);
  }
  for (let k = 0; k < 4; k++) seg.put(new THREE.TorusGeometry(DOOR.half, 0.05, 6, 32, Math.PI), k % 2 ? p.brassDark : p.brass, [0, DOOR.spring, -1.5 - k * 1.6]);
  void group;
  void deg;
}
