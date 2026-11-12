import * as THREE from "three";
import { hangingLamp, lightPatches, sconce, type LightPatch } from "../../art/fixtures";
import { additive, archPath, Batch, OUTPUT_CHUNKS } from "../../art/kit";
import type { EnamelName, GlassName, Palette } from "../../art/materials";
import { boxM, Idlers, instrumentCluster, pedestal, reelUnit, scaleUV } from "../../art/props";
import { CANDY } from "../../art/surfaces";
import { canvas, GOLD } from "../../art/textures";
import { makeMotes } from "../../art/void";

/**
 * The Market Observatory's architecture, built around its own centre (the caller places the group):
 * the ship's instrument room. Sixteen bays of deep navy and plum enamel over a walnut wainscot,
 * between slim columns with chrome bands; tall arched windows onto deep space, a dichroic glass
 * dome on brass ribs, a dark studded floor with the brass astrolabe ring around the Orrery and a
 * runner from the entrance, a cluster of blown-glass lamps under the crown, and the lights.
 * It is kept darker and cooler than the Vault so the stars of the Orrery carry the room.
 *
 * Local frame: north is -Z, like the Vault. Angles are degrees clockwise from north.
 */

export const OBS_R = 13.6; // vertex radius
export const OBS_SIDES = 16;
export const OBS_APOTHEM = OBS_R * Math.cos(Math.PI / OBS_SIDES);
export const OBS_WALL_H = 7.2;
export const OBS_DOME_H = 7.4;
const SEG_W = 2 * OBS_R * Math.sin(Math.PI / OBS_SIDES);
export const ENTRANCE = { half: 1.45, spring: 2.85 };
const WINDOW = { half: 1.25, sill: 1.1, spring: 4.9 };
/** The great north window behind the Order Spire: deep space as a dark backdrop for the column. */
const GREAT = { half: 2.05, sill: 0.35, spring: 5.0 };
const WAINSCOT = 1.04;

/** What fills each wall segment: index 0 faces north, clockwise. */
function segmentKind(i: number): "window" | "wall" | "door" {
  if (i === 8) return "door"; // south: the corridor to the Vault
  if (i === 4 || i === 12 || i === 3 || i === 5) return "wall"; // east (weather wall), west (legend)
  return "window";
}

export const segAngle = (i: number) => (i * 360) / OBS_SIDES;
export const lpolar = (deg: number, r: number, y = 0) => {
  const a = THREE.MathUtils.degToRad(deg);
  return new THREE.Vector3(Math.sin(a) * r, y, -Math.cos(a) * r);
};
export const lface = (deg: number) => -THREE.MathUtils.degToRad(deg);

const css = (hex: number, a = 1) => `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${a})`;

/**
 * The instrument room's floor, drawn once on a canvas: dark studded rubber, a polished disc under
 * the Orrery with the brass astrolabe ring (its rim), a raspberry runner from the entrance, and the
 * walls' shade baked in.
 */
function observatoryFloor(radius: number) {
  const S = 2048;
  const [c, ctx] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const px = S / 2 / radius;
  const ctr = S / 2;
  // base: deep violet-black stone with soft clouds
  const g = ctx.createRadialGradient(ctr, ctr, 0, ctr, ctr, S / 2);
  g.addColorStop(0, "#1c1a2e");
  g.addColorStop(0.5, "#141426");
  g.addColorStop(1, "#0c0c18");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const y = (Math.sin(i * 78.233) * 12543.123) % 1;
    ctx.fillStyle = `rgba(160, 150, 210, ${0.012 + (i % 7) * 0.003})`;
    ctx.beginPath();
    ctx.arc(Math.abs(x) * S, Math.abs(y) * S, 20 + (i % 13) * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  mc.fillStyle = "rgb(0, 95, 25)"; // polished stone, a soft sheen (no hot spots under the lamps)
  mc.fillRect(0, 0, S, S);
  const both = (fn: (k: CanvasRenderingContext2D, mr: boolean) => void) => {
    ctx.save();
    fn(ctx, false);
    ctx.restore();
    mc.save();
    fn(mc, true);
    mc.restore();
  };
  both((k, mr) => {
    const gold = mr ? "rgb(0, 70, 255)" : GOLD;
    const seam = mr ? "rgb(0, 140, 0)" : "rgba(120, 110, 160, 0.35)";
    // the walkway outside the ring: rubber studs in rings
    void seam;
    for (let ringK = 0; ringK < 14; ringK++) {
      const rr = 8.0 + ringK * 0.42;
      const n = Math.round((rr * Math.PI * 2) / 0.42);
      k.fillStyle = mr ? "rgb(0, 150, 0)" : "rgba(70, 78, 120, 0.5)";
      for (let i = 0; i < n; i++) {
        const a = ((i + (ringK % 2) * 0.5) / n) * Math.PI * 2;
        k.beginPath();
        k.arc(ctr + Math.cos(a) * rr * px, ctr + Math.sin(a) * rr * px, 0.07 * px, 0, Math.PI * 2);
        k.fill();
      }
    }
    // the runner from the entrance (south = +y on the canvas) to the ring
    k.fillStyle = mr ? "rgb(0, 245, 0)" : css(0x8a2a48);
    k.fillRect(ctr - 1.25 * px, ctr + 7.75 * px, 2.5 * px, (radius - 7.75) * px);
    k.fillStyle = mr ? "rgb(0, 245, 0)" : css(CANDY.mustard);
    for (const dx of [-1.25, 1.13]) k.fillRect(ctr + dx * px, ctr + 7.75 * px, 0.12 * px, (radius - 7.75) * px);
    k.fillStyle = mr ? "rgb(0, 245, 0)" : css(CANDY.cream, 0.9);
    for (const dx of [-1.02, 0.98]) k.fillRect(ctr + dx * px, ctr + 7.75 * px, 0.04 * px, (radius - 7.75) * px);
    // the astrolabe ring: two gold bands with degree ticks between them
    k.strokeStyle = gold;
    for (const [r, w] of [
      [6.55, 6],
      [6.75, 2],
      [7.45, 2],
      [7.6, 7],
      [1.0, 4],
    ]) {
      k.lineWidth = w;
      k.beginPath();
      k.arc(ctr, ctr, r * px, 0, Math.PI * 2);
      k.stroke();
    }
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const long = i % 10 === 0;
      const r0 = 6.78 * px;
      const r1 = (long ? 7.42 : i % 5 === 0 ? 7.12 : 6.98) * px;
      k.lineWidth = long ? 4 : 2;
      k.beginPath();
      k.moveTo(ctr + Math.cos(a) * r0, ctr + Math.sin(a) * r0);
      k.lineTo(ctr + Math.cos(a) * r1, ctr + Math.sin(a) * r1);
      k.stroke();
    }
  });
  // baked shade: darker towards the walls
  ctx.globalCompositeOperation = "multiply";
  const shade = ctx.createRadialGradient(ctr, ctr, 0, ctr, ctr, radius * px);
  shade.addColorStop(0, "#ffffff");
  shade.addColorStop(0.7, "#e6e2ee");
  shade.addColorStop(0.92, "#8a8496");
  shade.addColorStop(1, "#4a4654");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const mr = new THREE.CanvasTexture(m);
  mr.anisotropy = 8;
  return { map, mr };
}

export interface ObservatoryShell {
  group: THREE.Group;
  update(dt: number, t: number): void;
  dispose(): void;
}

const BAY_GLASS: GlassName[] = ["teal", "cobalt", "rose", "cobalt"];
const LIGHT: Record<string, number> = { teal: 0x35d6c8, cobalt: 0x5a86ff, rose: 0xff6f96 };

export function buildObservatoryShell(p: Palette, quality: () => boolean): ObservatoryShell {
  const group = new THREE.Group();
  group.name = "observatory-shell";
  const updates: Array<(dt: number, t: number) => void> = [];
  const disposables: Array<{ dispose(): void }> = [];
  const b = new Batch();
  const idlers = new Idlers(p);
  void quality;

  // --- floor
  const fl = observatoryFloor(OBS_R + 0.4);
  disposables.push(fl.map, fl.mr);
  const floorMat = new THREE.MeshStandardMaterial({ map: fl.map, roughnessMap: fl.mr, metalnessMap: fl.mr, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(OBS_R + 0.4, 96), floorMat);
  floor.rotation.x = -Math.PI / 2;
  // canvas +y is world +z after the rotation (south), as drawn
  group.add(floor);

  // --- walls
  const paneGlass = p.glassLike("clear", { opacity: 0, density: 0.08, glow: 0.2, irid: 0.1, repeat: [0.5, 0.5], side: THREE.FrontSide });
  const lunetteMats = new Map<GlassName, THREE.Material>();
  const lunetteGlass = (kind: GlassName) => {
    let m = lunetteMats.get(kind);
    if (!m) lunetteMats.set(kind, (m = p.glassLike(kind, { glow: 1.2, opacity: 0.5, repeat: [0.8, 0.8], side: THREE.FrontSide })));
    return m;
  };
  const patches: LightPatch[] = [];
  for (let i = 0; i < OBS_SIDES; i++) {
    const deg = segAngle(i);
    const kind = segmentKind(i);
    const here = new THREE.Matrix4().makeRotationY(lface(deg)).setPosition(lpolar(deg, OBS_APOTHEM));
    const seg = b.frame(here);
    const enamel: EnamelName = kind === "wall" ? "plum" : "navy";
    const shape = new THREE.Shape();
    shape.moveTo(-SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, 0);
    shape.lineTo(SEG_W / 2, OBS_WALL_H);
    shape.lineTo(-SEG_W / 2, OBS_WALL_H);
    shape.closePath();
    const win = i === 0 ? GREAT : WINDOW;
    const opening = kind === "window" ? { half: win.half, sill: win.sill, spring: win.spring } : kind === "door" ? { half: ENTRANCE.half, sill: 0, spring: ENTRANCE.spring } : null;
    if (opening) shape.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
    const geo = new THREE.ShapeGeometry(shape, 20);
    const shadeGeo = geo.clone();
    const suv = shadeGeo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < suv.count; k++) suv.setXY(k, 0.5, suv.getY(k) / OBS_WALL_H);
    seg.put(shadeGeo, p.wallShade, [0, 0, 0.006]);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * p.tile + 0.5, uv.getY(k) * p.tile);
    seg.put(geo, p.enamel[enamel]);
    // cornice
    const band = new THREE.PlaneGeometry(SEG_W, 0.42);
    scaleUV(band, SEG_W / 2, 1);
    seg.put(band, p.filigree, [0, OBS_WALL_H - 0.5, 0.012]);
    seg.put(boxM(SEG_W, 0.14, 0.34), p.wood, [0, OBS_WALL_H - 0.2, 0.15]);
    seg.put(new THREE.CylinderGeometry(0.03, 0.03, SEG_W, 8), p.chrome, [0, OBS_WALL_H - 0.29, 0.3], [0, 0, Math.PI / 2]);
    if (kind !== "door") {
      // wainscot: walnut boards and a brass rail (the great window comes down through it)
      if (i !== 0) seg.put(boxM(SEG_W, WAINSCOT, 0.05), p.wood, [0, WAINSCOT / 2, 0.025]);
      else for (const sx of [-1, 1]) seg.put(boxM(SEG_W / 2 - GREAT.half - 0.2, WAINSCOT, 0.05), p.wood, [sx * (SEG_W / 2 + GREAT.half + 0.2) * 0.5, WAINSCOT / 2, 0.025]);
      if (i !== 0) seg.put(new THREE.CylinderGeometry(0.022, 0.022, SEG_W, 8), p.brass, [0, WAINSCOT + 0.03, 0.06], [0, 0, Math.PI / 2]);
    }
    if (opening) {
      const outer = archPath(new THREE.Shape(), opening.half + 0.2, opening.sill, opening.spring) as THREE.Shape;
      outer.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
      seg.put(new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false, curveSegments: 20 }), p.wood, [0, 0, -0.62]);
      seg.put(new THREE.TubeGeometry(new ArchCurve(opening.half + 0.14, opening.sill, opening.spring), 32, 0.04, 5, false), p.brass, [0, 0, 0.07]);
    }
    if (kind === "window") {
      const pane = new THREE.Shape();
      pane.moveTo(-win.half, win.sill);
      pane.lineTo(win.half, win.sill);
      pane.lineTo(win.half, win.spring);
      pane.lineTo(-win.half, win.spring);
      pane.closePath();
      seg.put(new THREE.ShapeGeometry(pane), paneGlass, [0, 0, -0.4]);
      seg.put(new THREE.BoxGeometry(win.half * 2, 0.06, 0.06), p.brass, [0, win.spring, -0.37]);
      if (i === 0) {
        // the great window: clear glass in the arch too, only a hoop of tracery
        const top = new THREE.Shape();
        top.moveTo(-win.half, win.spring);
        top.lineTo(win.half, win.spring);
        top.absarc(0, win.spring, win.half, 0, Math.PI, false);
        seg.put(new THREE.ShapeGeometry(top, 20), paneGlass, [0, 0, -0.4]);
        seg.put(new THREE.TorusGeometry(win.half * 0.55, 0.03, 8, 48), p.brass, [0, win.spring + win.half * 0.42, -0.38]);
      } else {
        const glassKind = BAY_GLASS[i % BAY_GLASS.length];
        const lun = new THREE.Shape();
        lun.moveTo(-win.half, win.spring);
        lun.lineTo(win.half, win.spring);
        lun.absarc(0, win.spring, win.half, 0, Math.PI, false);
        const lunGeo = new THREE.ShapeGeometry(lun, 20);
        const luv = lunGeo.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < luv.count; k++) luv.setXY(k, luv.getX(k) / 1.25, (luv.getY(k) - win.spring) / 1.25);
        seg.put(lunGeo, lunetteGlass(glassKind), [0, 0, -0.36]);
        seg.put(new THREE.BoxGeometry(0.035, win.half - 0.1, 0.035), p.brass, [0, win.spring + win.half / 2, -0.35]);
        seg.put(new THREE.BoxGeometry(win.half * 2, 0.04, 0.04), p.brass, [0, 3.0, -0.38]);
        seg.put(new THREE.BoxGeometry(0.045, win.spring - win.sill, 0.045), p.brass, [0, (win.spring + win.sill) / 2, -0.38]);
        if (i % 2 === 1) patches.push({ from: lpolar(deg, OBS_APOTHEM - 0.8), to: lpolar(deg, 8.6), width: 1.8, color: LIGHT[glassKind], strength: 0.22 });
      }
      seg.put(boxM(win.half * 2 + 0.4, 0.08, 0.8), p.wood, [0, win.sill - 0.04, -0.2]);
    }
    // instruments on the piers either side of the entrance bay's neighbours
    const pier = (SEG_W / 2 + WINDOW.half + 0.2) / 2;
    if (i === 7) instrumentCluster(b, idlers, p, here.clone().multiply(new THREE.Matrix4().makeTranslation(pier - 0.06, 1.75, 0.012)), 0.56);
    if (i === 9) reelUnit(b, idlers, p, here.clone().multiply(new THREE.Matrix4().makeTranslation(-pier + 0.06, 1.75, 0.012)), 0.52, "raspberry");
  }

  // --- columns at the corners: slim, navy, chrome bands, a brass tulip capital; a sconce on every other one
  const shaftGeo = new THREE.CylinderGeometry(0.26, 0.3, OBS_WALL_H - WAINSCOT - 0.56, 20);
  const footGeo = new THREE.LatheGeometry([[0, 0], [0.5, 0], [0.5, 0.1], [0.4, 0.16], [0.37, 0.3], [0.35, WAINSCOT], [0.39, WAINSCOT + 0.05], [0.32, WAINSCOT + 0.12], [0, WAINSCOT + 0.12]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const capGeo = new THREE.LatheGeometry([[0, 0], [0.27, 0], [0.29, 0.1], [0.37, 0.22], [0.5, 0.32], [0.58, 0.38], [0.58, 0.46], [0, 0.46]].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const bandGeo = new THREE.TorusGeometry(0.29, 0.022, 5, 16);
  bandGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < OBS_SIDES; i++) {
    const deg = segAngle(i) + 180 / OBS_SIDES;
    const at = lpolar(deg, OBS_R - 0.2);
    const col = b.at(at.x, 0, at.z, lface(deg));
    col.put(footGeo, p.wood);
    col.put(shaftGeo, p.paint.navy, [0, WAINSCOT + 0.1 + (OBS_WALL_H - WAINSCOT - 0.56) / 2, 0]);
    col.put(capGeo, p.brass, [0, OBS_WALL_H - 0.46, 0]);
    for (const y of [WAINSCOT + 0.26, OBS_WALL_H - 0.58]) col.put(bandGeo, p.chrome, [0, y, 0]);
    col.put(bandGeo, p.brass, [0, WAINSCOT + 0.34, 0]);
    if (i % 2 === 0 && i !== 0 && i !== 15) sconce(col.frame(new THREE.Matrix4().makeTranslation(0, 3.0, 0.28)), p, i % 4 === 0 ? "amber" : "teal", 1.1);
  }

  // --- ledge ring and the glass dome with brass ribs
  const ledgeGeo = new THREE.RingGeometry(OBS_APOTHEM - 0.3, OBS_R + 0.4, 96, 1);
  scaleUV(ledgeGeo, 12, 12);
  b.put(ledgeGeo, p.wood, [0, OBS_WALL_H, 0], [Math.PI / 2, 0, 0]);
  const domeGlass = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    additive(
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec2 vUv;
          void main() { vUv = uv; vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vN;
          varying vec2 vUv;
          void main() {
            // dichroic panes: the film's hue drifts across the dome and with height
            float rim = smoothstep(0.75, 0.0, vN.y);
            float bands = smoothstep(0.985, 1.0, abs(sin(vUv.x * 3.14159 * 48.0)));
            vec3 film = 0.5 + 0.5 * cos(6.2832 * (vUv.x * 2.0 + vN.y * 1.3 + vec3(0.0, 0.33, 0.67)) + uTime * 0.05);
            float a = 0.012 + rim * 0.055 + bands * 0.02 * (0.6 + 0.4 * sin(uTime * 0.3 + vUv.x * 20.0));
            gl_FragColor = vec4(mix(vec3(0.55, 0.75, 1.0), film, 0.55) * a, a);
            ${OUTPUT_CHUNKS}
          }`,
        uniforms: { uTime: { value: 0 } },
        side: THREE.BackSide,
      }),
    ),
  );
  domeGlass.scale.set(OBS_R, OBS_DOME_H, OBS_R);
  domeGlass.position.y = OBS_WALL_H;
  group.add(domeGlass);
  updates.push((_dt, t) => ((domeGlass.material as THREE.ShaderMaterial).uniforms.uTime.value = t));
  const domeAt = (deg: number, theta: number, inset = 0.99) => {
    const d = lpolar(deg, 1);
    return new THREE.Vector3(d.x * OBS_R * Math.sin(theta) * inset, OBS_WALL_H + OBS_DOME_H * Math.cos(theta) * inset, d.z * OBS_R * Math.sin(theta) * inset);
  };
  const topRing = 0.16;
  for (let i = 0; i < OBS_SIDES; i++) {
    const deg = segAngle(i) + 180 / OBS_SIDES;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 28; k++) pts.push(domeAt(deg, Math.PI / 2 - (k / 28) * (Math.PI / 2 - topRing)));
    b.put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, i % 2 ? 0.06 : 0.11, 5, false), i % 2 ? p.brass : p.brassDark);
  }
  for (const theta of [1.15, 0.75, 0.42]) {
    const r = OBS_R * Math.sin(theta) * 0.985;
    b.put(new THREE.TorusGeometry(r, 0.06, 6, 96), p.brass, [0, OBS_WALL_H + OBS_DOME_H * Math.cos(theta) * 0.985, 0], [Math.PI / 2, 0, 0]);
  }
  const crownY = OBS_WALL_H + OBS_DOME_H * Math.cos(topRing) * 0.99;
  b.put(new THREE.TorusGeometry(OBS_R * Math.sin(topRing), 0.16, 10, 48), p.brass, [0, crownY, 0], [Math.PI / 2, 0, 0]);
  // the dome's lantern: three blown lamps on stems of different lengths, over the Orrery
  const lantern: Array<[GlassName, number, number, number]> = [
    ["cobalt", 2.6, 0.9, 0],
    ["teal", 1.7, 0.62, 2.1],
    ["rose", 2.1, 0.5, 4.2],
  ];
  for (const [glass, len, size, a] of lantern) {
    const lamp = hangingLamp(p, glass, len, size, true);
    lamp.group.position.set(Math.cos(a) * 0.9, crownY - 0.1, Math.sin(a) * 0.9);
    group.add(lamp.group);
    updates.push((_dt, t) => lamp.update(t * 0.8));
  }

  // --- the Orrery's foot: a small brass and walnut projector under the axis
  pedestal(b, p, 0.2, 0.34);
  b.put(new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), p.glass.cobalt, [0, 0.34, 0]);

  // --- entrance: a brass threshold with a warm strip
  const th = lpolar(180, OBS_APOTHEM - 0.25, 0.012);
  b.put(new THREE.BoxGeometry(ENTRANCE.half * 2 + 0.3, 0.02, 0.9), p.brassDark, [th.x, 0.008, th.z]);
  b.put(new THREE.BoxGeometry(ENTRANCE.half * 2, 0.02, 0.06), p.goldGlow, [th.x, 0.022, th.z]);

  // --- coloured light through the lunettes, motes, and the lights
  const thrown = lightPatches(p, patches);
  group.add(thrown.mesh);
  const motes = makeMotes(260, 11, p.dot, 1);
  group.add(motes);
  updates.push((_dt, t) => {
    (motes.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    thrown.material.uniforms.uTime.value = t;
    idlers.update(t);
  });
  const top = new THREE.PointLight(0xb4b8ff, 16, 26, 1.4);
  top.position.set(0, 11, 0);
  group.add(top);

  b.build(group);
  idlers.build();
  group.add(idlers.group);
  return {
    group,
    update(dt, t) {
      for (const u of updates) u(dt, t);
    },
    dispose() {
      for (const d of disposables) d.dispose();
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

/**
 * The corridor between the Vault's north arch and the observatory's south arch, in world space:
 * a teal enamel tunnel with brass hoops, a leather dado, a runner, glass sconces and a chevron of
 * light on the floor pointing on to the observatory.
 */
export function buildCorridor(p: Palette, z0: number, z1: number, half: number, spring: number): { group: THREE.Group; update(dt: number, t: number): void } {
  const group = new THREE.Group();
  group.name = "corridor";
  const len = z0 - z1;
  const zc = (z0 + z1) / 2;
  const h = spring + half;
  const b = new Batch();
  // walls and vault as an extruded arch profile seen from inside
  const profile = archPath(new THREE.Shape(), half + 0.25, 0, spring) as THREE.Shape;
  profile.holes.push(archPath(new THREE.Path(), half, 0, spring, true) as THREE.Path);
  b.put(new THREE.ExtrudeGeometry(profile, { depth: len, bevelEnabled: false, curveSegments: 24 }), p.paint.teal, [0, 0, z1]);
  b.put(boxM(half * 2, 0.012, len), p.rubber, [0, 0.0, zc]);
  // the runner
  const runner = new THREE.MeshStandardMaterial({ color: 0x8a2a48, roughness: 1 });
  b.put(new THREE.BoxGeometry(2.3, 0.014, len), runner, [0, 0.006, zc]);
  for (const x of [-1.19, 1.19]) b.put(new THREE.BoxGeometry(0.1, 0.016, len), p.paint.mustard, [x, 0.006, zc]);
  for (const x of [-1, 1]) {
    b.put(new THREE.BoxGeometry(0.04, 0.02, len), p.goldGlow, [x * (half - 0.08), 0.012, zc]);
    b.put(boxM(0.05, 0.86, len, 2.5), p.leather, [x * (half - 0.03), 0.56, zc]);
    b.put(new THREE.CylinderGeometry(0.02, 0.02, len, 6), p.brass, [x * (half - 0.07), 1.02, zc], [Math.PI / 2, 0, 0]);
  }
  const n = Math.max(3, Math.round(len / 1.6));
  for (let k = 0; k <= n; k++) {
    const z = z1 + (len * k) / n;
    b.put(new THREE.TorusGeometry(half - 0.02, 0.05, 6, 32, Math.PI), k % 2 ? p.brassDark : p.brass, [0, spring, z]);
    for (const x of [-half + 0.02, half - 0.02]) b.put(new THREE.BoxGeometry(0.08, spring, 0.08), k % 2 ? p.brassDark : p.brass, [x, spring / 2, z]);
    if (k % 2 === 1 && k < n) {
      for (const x of [-1, 1]) {
        const glass: GlassName = (k + (x > 0 ? 1 : 0)) % 4 < 2 ? "amber" : "rose";
        sconce(b.frame(new THREE.Matrix4().makeRotationY((-x * Math.PI) / 2).setPosition(x * (half - 0.02), 1.9, z + len / n / 2)), p, glass, 1.0);
      }
    }
  }
  b.build(group);
  // a floating chevron of light pointing on to the observatory
  const chevMat = additive(new THREE.MeshBasicMaterial({ color: 0xffb45a, opacity: 0.5, side: THREE.DoubleSide, toneMapped: false }), false);
  const chevrons: THREE.Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Shape();
    s.moveTo(-0.35, 0);
    s.lineTo(0, -0.25);
    s.lineTo(0.35, 0);
    s.lineTo(0.35, 0.08);
    s.lineTo(0, -0.17);
    s.lineTo(-0.35, 0.08);
    s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), chevMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.03, zc + 1.2 - k * 0.9);
    group.add(m);
    chevrons.push(m);
  }
  const lamp = new THREE.PointLight(0xffd0a0, 6, 9, 1.5);
  lamp.position.set(0, h - 0.4, zc);
  group.add(lamp);
  return {
    group,
    update(_dt, t) {
      chevMat.opacity = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
      chevrons.forEach((c, i) => (c.scale.setScalar(1 + 0.08 * Math.sin(t * 2.2 - i * 0.9))));
    },
  };
}
