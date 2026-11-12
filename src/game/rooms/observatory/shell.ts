import * as THREE from "three";
import type { Palette } from "../../art/materials";
import { additive, archPath, gyroOrnament, OUTPUT_CHUNKS } from "../../art/kit";
import { canvas, GOLD } from "../../art/textures";
import { makeMotes } from "../../art/void";

/**
 * The Market Observatory's architecture, built around its own centre (the caller places the group):
 * a sixteen-sided hall of pearl walls between ivory pillars, tall arched windows onto the Void,
 * a ribbed glass dome, a dark polished floor with a gold astrolabe ring around the Orrery, the
 * entrance arch to the south (towards the Vault), and the lights.
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
/** The great north window behind the Order Spire: the Void as a dark backdrop for the column. */
const GREAT = { half: 2.05, sill: 0.35, spring: 5.0 };

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

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Dark polished floor with the astrolabe ring (rim of the Orrery), drawn once on a canvas. */
function observatoryFloor(radius: number) {
  const S = 2048;
  const [c, ctx] = canvas(S, S);
  const [m, mc] = canvas(S, S);
  const px = S / 2 / radius;
  const ctr = S / 2;
  // base: deep violet-black stone with soft clouds
  const g = ctx.createRadialGradient(ctr, ctr, 0, ctr, ctr, S / 2);
  g.addColorStop(0, "#1a1828");
  g.addColorStop(0.5, "#121120");
  g.addColorStop(1, "#0b0a14");
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
    // stone joints
    k.strokeStyle = seam;
    k.lineWidth = 3;
    for (const r of [8.2, 10.4, 12.6]) {
      k.beginPath();
      k.arc(ctr, ctr, r * px, 0, Math.PI * 2);
      k.stroke();
    }
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      k.beginPath();
      k.moveTo(ctr + Math.cos(a) * 7.6 * px, ctr + Math.sin(a) * 7.6 * px);
      k.lineTo(ctr + Math.cos(a) * radius * px, ctr + Math.sin(a) * radius * px);
      k.stroke();
    }
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
    // a path from the entrance (south = +y on the canvas) to the ring
    k.lineWidth = 3;
    for (const dx of [-1.1, 1.1]) {
      k.beginPath();
      k.moveTo(ctr + dx * px, ctr + 7.7 * px);
      k.lineTo(ctr + dx * px, ctr + radius * px);
      k.stroke();
    }
  });
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

export function buildObservatoryShell(p: Palette, quality: () => boolean): ObservatoryShell {
  const group = new THREE.Group();
  group.name = "observatory-shell";
  const updates: Array<(dt: number, t: number) => void> = [];
  const disposables: Array<{ dispose(): void }> = [];

  // --- floor
  const fl = observatoryFloor(OBS_R + 0.4);
  disposables.push(fl.map, fl.mr);
  const floorMat = new THREE.MeshStandardMaterial({ map: fl.map, roughnessMap: fl.mr, metalnessMap: fl.mr, roughness: 1, metalness: 1, envMapIntensity: 1.4 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(OBS_R + 0.4, 96), floorMat);
  floor.rotation.x = -Math.PI / 2;
  // canvas +y is world +z after the rotation (south), as drawn
  group.add(floor);

  // --- walls
  const glassMat = additive(
    new THREE.ShaderMaterial({
      vertexShader: UV_VERT,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float sheen = 0.5 + 0.5 * sin((vUv.x * 0.7 + vUv.y) * 7.0 + uTime * 0.1);
          float a = 0.025 + 0.035 * sheen * smoothstep(0.0, 1.0, vUv.y);
          gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * a, a);
          ${OUTPUT_CHUNKS}
        }`,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
    }),
  );
  updates.push((_dt, t) => (glassMat.uniforms.uTime.value = t));

  for (let i = 0; i < OBS_SIDES; i++) {
    const deg = segAngle(i);
    const kind = segmentKind(i);
    const seg = new THREE.Group();
    seg.position.copy(lpolar(deg, OBS_APOTHEM));
    seg.rotation.y = lface(deg);
    group.add(seg);
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
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * p.tile + 0.5, uv.getY(k) * p.tile);
    seg.add(new THREE.Mesh(geo, p.pearl));
    const cornice = new THREE.Mesh(new THREE.PlaneGeometry(SEG_W, 0.42), p.filigree);
    cornice.position.set(0, OBS_WALL_H - 0.5, 0.012);
    seg.add(cornice);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.12, 0.3), p.gold);
    ledge.position.set(0, OBS_WALL_H - 0.24, 0.12);
    seg.add(ledge);
    if (kind !== "door") {
      const base = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.32, 0.12), p.ivory);
      base.position.set(0, 0.16, 0.06);
      seg.add(base);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(SEG_W, 0.035, 0.14), p.gold);
      trim.position.set(0, 0.33, 0.06);
      seg.add(trim);
    }
    if (opening) {
      const outer = archPath(new THREE.Shape(), opening.half + 0.2, opening.sill, opening.spring) as THREE.Shape;
      outer.holes.push(archPath(new THREE.Path(), opening.half, opening.sill, opening.spring, true) as THREE.Path);
      const reveal = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.7, bevelEnabled: false, curveSegments: 20 }), p.ivory);
      reveal.position.z = -0.62;
      seg.add(reveal);
      const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), p.gold);
      key.scale.set(0.8, 1.3, 0.4);
      key.position.set(0, opening.spring + opening.half + 0.2, 0.1);
      seg.add(key);
    }
    if (kind === "window") {
      const glass = new THREE.Mesh(new THREE.ShapeGeometry(archPath(new THREE.Shape(), win.half, win.sill, win.spring) as THREE.Shape, 20), glassMat);
      const guv = glass.geometry.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < guv.count; k++) guv.setXY(k, guv.getX(k) / (win.half * 2) + 0.5, guv.getY(k) / (win.spring + win.half));
      glass.position.z = -0.4;
      seg.add(glass);
      if (i === 0) {
        // the great window: only a ring of tracery in the arch, nothing across the column's view
        const rose = new THREE.Mesh(new THREE.TorusGeometry(win.half * 0.55, 0.03, 8, 64), p.gold);
        rose.position.set(0, win.spring + win.half * 0.42, -0.38);
        seg.add(rose);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(win.half * 2, 0.05, 0.05), p.gold);
        bar.position.set(0, win.spring, -0.38);
        seg.add(bar);
      } else {
        for (const y of [2.6, 4.1]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(win.half * 2, 0.05, 0.05), p.gold);
          bar.position.set(0, y, -0.38);
          seg.add(bar);
        }
        const mull = new THREE.Mesh(new THREE.BoxGeometry(0.06, win.spring - win.sill + win.half * 0.9, 0.06), p.gold);
        mull.position.set(0, (win.spring + win.sill + win.half * 0.9) / 2, -0.38);
        seg.add(mull);
      }
      const sill = new THREE.Mesh(new THREE.BoxGeometry(win.half * 2 + 0.4, 0.1, 0.8), p.ivory);
      sill.position.set(0, win.sill - 0.05, -0.15);
      seg.add(sill);
    }
  }

  // --- pillars at the corners
  const pillarGeo = new THREE.CylinderGeometry(0.32, 0.38, OBS_WALL_H, 18);
  const baseGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.56, 0), new THREE.Vector2(0.54, 0.2), new THREE.Vector2(0.44, 0.3), new THREE.Vector2(0.42, 0.48), new THREE.Vector2(0, 0.48)], 20);
  const capGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.36, 0), new THREE.Vector2(0.46, 0.16), new THREE.Vector2(0.58, 0.3), new THREE.Vector2(0.6, 0.4), new THREE.Vector2(0, 0.4)], 20);
  const filGeo = new THREE.BoxGeometry(0.03, OBS_WALL_H - 2.4, 0.03);
  for (let i = 0; i < OBS_SIDES; i++) {
    const deg = segAngle(i) + 180 / OBS_SIDES;
    const at = lpolar(deg, OBS_R - 0.2);
    const pillar = new THREE.Group();
    pillar.position.copy(at);
    group.add(pillar);
    const shaft = new THREE.Mesh(pillarGeo, p.pearlPlain);
    shaft.position.y = OBS_WALL_H / 2;
    pillar.add(shaft);
    pillar.add(new THREE.Mesh(baseGeo, p.ivory));
    const cap = new THREE.Mesh(capGeo, p.gold);
    cap.position.y = OBS_WALL_H - 0.56;
    pillar.add(cap);
    const fil = new THREE.Mesh(filGeo, p.cyanGlow);
    fil.position.copy(lpolar(deg, -0.37)).setY(0.9 + (OBS_WALL_H - 2.4) / 2);
    pillar.add(fil);
  }

  // --- ledge ring and the glass dome with gold ribs
  const ledgeRing = new THREE.Mesh(new THREE.RingGeometry(OBS_APOTHEM - 0.3, OBS_R + 0.4, 96, 1), p.ivory);
  ledgeRing.rotation.x = Math.PI / 2;
  ledgeRing.position.y = OBS_WALL_H;
  group.add(ledgeRing);
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
            float rim = smoothstep(0.75, 0.0, vN.y);
            float bands = smoothstep(0.985, 1.0, abs(sin(vUv.x * 3.14159 * 48.0)));
            float a = 0.015 + rim * 0.05 + bands * 0.02 * (0.6 + 0.4 * sin(uTime * 0.3 + vUv.x * 20.0));
            gl_FragColor = vec4(vec3(0.55, 0.75, 1.0) * a, a);
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
    const curve = new THREE.CatmullRomCurve3(pts);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, i % 2 ? 0.07 : 0.13, 6, false), i % 2 ? p.gold : p.ivory));
  }
  for (const theta of [1.15, 0.75, 0.42]) {
    const r = OBS_R * Math.sin(theta) * 0.985;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 128), p.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = OBS_WALL_H + OBS_DOME_H * Math.cos(theta) * 0.985;
    group.add(ring);
  }
  const crownY = OBS_WALL_H + OBS_DOME_H * Math.cos(topRing) * 0.99;
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(OBS_R * Math.sin(topRing), 0.16, 10, 64), p.gold);
  crownRing.rotation.x = Math.PI / 2;
  crownRing.position.y = crownY;
  group.add(crownRing);
  // the dome's lantern: a gyroscope hanging over the Orrery
  const crown = gyroOrnament(0.9, p.gold, p.cyanGlow, p.pearlPlain);
  crown.group.position.set(0, crownY - 2.2, 0);
  group.add(crown.group);
  updates.push((_dt, t) => {
    crown.update(t * 0.6);
    crown.group.position.y = crownY - 2.2 + Math.sin(t * 0.35) * 0.12;
  });

  // --- entrance arch: a gold frame inside the door opening, and a lit threshold
  const threshold = new THREE.Mesh(new THREE.BoxGeometry(ENTRANCE.half * 2, 0.02, 0.5), p.cyanGlow);
  threshold.position.copy(lpolar(180, OBS_APOTHEM - 0.25, 0.012));
  group.add(threshold);

  // --- motes, and the lights
  const motes = makeMotes(260, 11, p.dot, 1);
  group.add(motes);
  updates.push((_dt, t) => ((motes.material as THREE.ShaderMaterial).uniforms.uTime.value = t));
  const top = new THREE.PointLight(0xa8b8ff, 18, 26, 1.4);
  top.position.set(0, 11, 0);
  group.add(top);
  const warm = new THREE.PointLight(0xffd9a0, 3, 12, 1.6);
  warm.position.set(0, 4.5, 6);
  group.add(warm);
  void quality;

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

/**
 * The corridor between the Vault's north arch and the observatory's south arch, in world space:
 * a pearl tunnel with ribbed gold arches, a glowing floor seam and a holographic way-marker.
 */
export function buildCorridor(p: Palette, z0: number, z1: number, half: number, spring: number): { group: THREE.Group; update(dt: number, t: number): void } {
  const group = new THREE.Group();
  group.name = "corridor";
  const len = z0 - z1;
  const zc = (z0 + z1) / 2;
  const h = spring + half;
  // walls and vault as an extruded arch profile seen from inside
  const profile = archPath(new THREE.Shape(), half + 0.25, 0, spring) as THREE.Shape;
  profile.holes.push(archPath(new THREE.Path(), half, 0, spring, true) as THREE.Path);
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(profile, { depth: len, bevelEnabled: false, curveSegments: 24 }), p.pearlPlain);
  shell.position.set(0, 0, z1);
  group.add(shell);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, len), new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.25, metalness: 0.4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.006, zc);
  group.add(floor);
  for (const x of [-half + 0.18, half - 0.18]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, len), p.cyanGlow);
    strip.position.set(x, 0.012, zc);
    group.add(strip);
  }
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, len), p.goldGlow);
  seam.position.set(0, 0.012, zc);
  group.add(seam);
  const n = Math.max(3, Math.round(len / 1.6));
  for (let k = 0; k <= n; k++) {
    const z = z1 + (len * k) / n;
    const rib = new THREE.Mesh(new THREE.TorusGeometry(half - 0.02, 0.05, 6, 32, Math.PI), k % 2 ? p.goldDark : p.gold);
    rib.position.set(0, spring, z);
    group.add(rib);
    for (const x of [-half + 0.02, half - 0.02]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, spring, 0.08), k % 2 ? p.goldDark : p.gold);
      jamb.position.set(x, spring / 2, z);
      group.add(jamb);
    }
  }
  // a floating chevron of light pointing on to the observatory
  const chevMat = additive(new THREE.MeshBasicMaterial({ color: 0x2ad4e6, opacity: 0.5, side: THREE.DoubleSide, toneMapped: false }), false);
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
  const lamp = new THREE.PointLight(0xfff0d8, 5, 9, 1.5);
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
