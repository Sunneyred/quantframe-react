import * as THREE from "three";
import type { Palette } from "../art/materials";
import { hashString } from "../../station/engine/logic";

/**
 * Original figures built from primitives. The player is a sleek armoured humanoid
 * (pearl plates over a dark undersuit, gold keel lines, a cyan visor slit, a floating
 * half halo); customers are robed or armoured silhouettes with a glowing mask.
 */

const V = (x: number, y: number) => new THREE.Vector2(x, y);

function capsule(r: number, len: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.position.y = -len / 2 - r * 0.4;
  return m;
}

export interface Figure {
  root: THREE.Group;
  /** speed in m/s drives the walk cycle */
  update(dt: number, speed: number, t: number): void;
}

/** A shell: part of a sphere, scaled, used for armour plates. */
function plate(r: number, mat: THREE.Material, phi: [number, number], theta: [number, number], scale: [number, number, number]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14, phi[0], phi[1], theta[0], theta[1]), mat);
  m.scale.set(...scale);
  return m;
}

export function makePlayerAvatar(p: Palette): Figure {
  const root = new THREE.Group();
  root.name = "player-avatar";
  const body = new THREE.Group();
  root.add(body);
  const armor = p.pearlPlain;
  const suit = p.undersuit;

  // torso: dark undersuit lathe, with pearl chest and back plates over it
  const torso = new THREE.Mesh(
    new THREE.LatheGeometry([V(0.0, 0.92), V(0.135, 0.95), V(0.12, 1.08), V(0.18, 1.3), V(0.195, 1.42), V(0.15, 1.52), V(0.065, 1.58), V(0.0, 1.6)], 20),
    suit,
  );
  torso.scale.z = 0.68;
  body.add(torso);
  const chest = plate(0.2, armor, [-Math.PI * 0.42, Math.PI * 0.84], [Math.PI * 0.2, Math.PI * 0.3], [1.04, 1.0, 0.74]);
  chest.position.y = 1.3;
  chest.rotation.y = Math.PI / 2;
  body.add(chest);
  const chestTrim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 32, Math.PI * 0.8), p.gold);
  chestTrim.rotation.set(Math.PI / 2, 0, Math.PI * 0.1);
  chestTrim.scale.set(1.04, 0.74, 1);
  chestTrim.position.y = 1.2;
  body.add(chestTrim);
  const back = plate(0.2, armor, [Math.PI * 0.55, Math.PI * 0.9], [Math.PI * 0.15, Math.PI * 0.45], [1.0, 1.05, 0.72]);
  back.position.y = 1.31;
  back.rotation.y = Math.PI / 2;
  body.add(back);
  const abs = plate(0.14, armor, [-Math.PI * 0.35, Math.PI * 0.7], [Math.PI * 0.35, Math.PI * 0.3], [1, 1.2, 0.8]);
  abs.position.y = 1.08;
  abs.rotation.y = Math.PI / 2;
  body.add(abs);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 24), p.gold);
  collar.rotation.x = Math.PI / 2;
  collar.scale.y = 0.8;
  collar.position.y = 1.53;
  body.add(collar);
  const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 18), suit);
  waist.position.y = 0.98;
  waist.scale.z = 0.75;
  body.add(waist);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.142, 0.014, 6, 28), p.gold);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.75;
  belt.position.y = 0.99;
  body.add(belt);
  // gold keel lines and a cyan core
  for (const side of [-1, 1]) {
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.26, 0.012), p.gold);
    keel.position.set(side * 0.06, 1.3, 0.152);
    keel.rotation.set(-0.15, 0, side * 0.32);
    body.add(keel);
  }
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 0), p.cyanGlow);
  core.position.set(0, 1.34, 0.158);
  core.scale.set(0.8, 1.4, 0.5);
  body.add(core);
  // a tabard hanging from the belt
  const tabardGeo = new THREE.PlaneGeometry(0.15, 0.44, 1, 6);
  tabardGeo.translate(0, -0.22, 0);
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.7, side: THREE.DoubleSide });
  const tabard = new THREE.Mesh(tabardGeo, cloth);
  tabard.position.set(0, 0.98, 0.118);
  body.add(tabard);
  const tabardTrim = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.022, 0.01), p.gold);
  tabardTrim.position.set(0, -0.43, 0.004);
  tabard.add(tabardTrim);
  // twin sash tails from the shoulders: the silhouette's long lines
  const sashes: THREE.Mesh[] = [];
  const sashCloth = new THREE.MeshStandardMaterial({ color: 0x23204a, roughness: 0.75, side: THREE.DoubleSide, emissive: 0x0a0820 });
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.075, 1.0, 1, 10);
    g.translate(0, -0.5, 0);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (1 - (-pos.getY(i)) * 0.55));
    const sash = new THREE.Mesh(g, sashCloth);
    sash.position.set(side * 0.07, 1.5, -0.15);
    body.add(sash);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.95, 0.006), p.goldDark);
    edge.position.set(side * 0.032, -0.5, 0.004);
    sash.add(edge);
    sashes.push(sash);
  }

  // head: an egg helmet, a dark faceplate with a visor slit, a swept crest
  const head = new THREE.Group();
  head.position.y = 1.7;
  body.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 18), armor);
  helm.scale.set(0.82, 1.08, 1.0);
  head.add(helm);
  const face = plate(0.122, p.steel, [Math.PI * 0.2, Math.PI * 0.6], [Math.PI * 0.3, Math.PI * 0.42], [0.84, 1.08, 1.02]);
  face.rotation.y = 0;
  head.add(face);
  const visorGeo = new THREE.TorusGeometry(0.1, 0.008, 6, 24, 1.5);
  visorGeo.rotateZ(Math.PI / 2 - 0.75); // centre the arc on +y...
  visorGeo.rotateX(Math.PI / 2); // ...then swing +y to the front (+z)
  const visor = new THREE.Mesh(visorGeo, p.cyanGlow);
  visor.scale.set(1.04, 1, 1.28);
  visor.position.y = 0.0;
  visor.rotation.x = 0.08;
  head.add(visor);
  const crestShape = new THREE.Shape();
  crestShape.moveTo(0, 0);
  crestShape.quadraticCurveTo(-0.05, 0.12, -0.26, 0.11);
  crestShape.quadraticCurveTo(-0.1, 0.06, -0.02, -0.04);
  crestShape.lineTo(0, 0);
  const crest = new THREE.Mesh(new THREE.ExtrudeGeometry(crestShape, { depth: 0.012, bevelEnabled: false }), p.gold);
  crest.rotation.y = Math.PI / 2;
  crest.position.set(-0.006, 0.08, 0.06);
  head.add(crest);
  // a half halo of light and three shards behind the head
  const halo = new THREE.Group();
  halo.position.set(0, 0.04, -0.16);
  head.add(halo);
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.005, 6, 40, Math.PI), p.goldGlow);
  arc.rotation.z = Math.PI * 0.0;
  halo.add(arc);
  for (let i = 0; i < 3; i++) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), p.goldGlow);
    const a = Math.PI * (0.2 + i * 0.3);
    shard.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
    shard.scale.y = 1.8;
    shard.rotation.z = a - Math.PI / 2;
    halo.add(shard);
  }

  // shoulders and arms
  const arms: THREE.Group[] = [];
  const fores: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), armor);
    pauldron.scale.set(1.3, 0.95, 1.15);
    pauldron.position.set(side * 0.235, 1.49, 0);
    pauldron.rotation.z = -side * 0.35;
    body.add(pauldron);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.009, 6, 24), p.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.026;
    pauldron.add(rim);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.16, 4), p.gold);
    fin.position.set(side * 0.04, 0.09, -0.03);
    fin.rotation.z = -side * 0.5;
    pauldron.add(fin);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 1.46, 0);
    body.add(shoulder);
    shoulder.add(capsule(0.046, 0.22, suit));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(capsule(0.04, 0.2, suit));
    const gauntlet = capsule(0.054, 0.15, armor);
    gauntlet.position.y -= 0.03;
    elbow.add(gauntlet);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 6, 20), p.gold);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.25;
    elbow.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), p.steel);
    hand.scale.set(0.8, 1.15, 0.9);
    hand.position.y = -0.32;
    elbow.add(hand);
    shoulder.rotation.z = side * 0.08;
    arms.push(shoulder);
    fores.push(elbow);
  }

  // legs: undersuit with pearl thigh plates and shin guards
  const thighs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, 0.93, 0);
    body.add(hip);
    hip.add(capsule(0.066, 0.3, suit));
    const thighPlate = plate(0.085, armor, [-Math.PI * 0.4, Math.PI * 0.8], [Math.PI * 0.15, Math.PI * 0.6], [0.95, 2.4, 0.9]);
    thighPlate.rotation.y = Math.PI / 2;
    thighPlate.position.set(side * 0.012, -0.2, 0.006);
    hip.add(thighPlate);
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    const guard = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), p.gold);
    guard.scale.set(0.9, 1.4, 0.6);
    guard.position.set(0, 0, 0.065);
    knee.add(guard);
    knee.add(capsule(0.052, 0.32, suit));
    const shin = plate(0.07, armor, [-Math.PI * 0.42, Math.PI * 0.84], [Math.PI * 0.12, Math.PI * 0.7], [0.95, 2.9, 0.95]);
    shin.rotation.y = Math.PI / 2;
    shin.position.set(0, -0.21, 0.008);
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 4, 8), p.steel);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.44, 0.05);
    foot.scale.set(1, 1, 0.7);
    knee.add(foot);
    thighs.push(hip);
    shins.push(knee);
  }

  const shadow = p.shadowDecal(0.9);
  root.add(shadow);

  let phase = 0;
  let amt = 0;
  return {
    root,
    update(dt, speed, t) {
      const target = Math.min(1, speed / 3.0);
      amt += (target - amt) * (1 - Math.exp(-dt * 8));
      phase += dt * (3.2 + speed * 1.7);
      const s = Math.sin(phase);
      const sprint = Math.max(0, (speed - 3.4) / 3);
      for (let i = 0; i < 2; i++) {
        const sign = i === 0 ? 1 : -1;
        thighs[i].rotation.x = sign * s * (0.55 + sprint * 0.25) * amt;
        shins[i].rotation.x = Math.max(0, -sign * Math.sin(phase + 0.9)) * (0.9 + sprint * 0.4) * amt;
        arms[i].rotation.x = -sign * s * (0.4 + sprint * 0.35) * amt;
        fores[i].rotation.x = -(0.25 + 0.35 * amt + sprint * 0.5);
      }
      body.position.y = Math.abs(Math.cos(phase)) * 0.04 * amt + Math.sin(t * 1.6) * 0.006 * (1 - amt);
      body.rotation.x = 0.05 * amt + sprint * 0.12;
      tabard.rotation.x = -0.15 * amt - Math.sin(phase * 2) * 0.05 * amt;
      sashes.forEach((sh, i) => {
        sh.rotation.x = 0.12 + amt * (0.35 + sprint * 0.4) + Math.sin(t * 1.7 + i * 1.3 + phase * amt) * (0.04 + amt * 0.06);
        sh.rotation.z = (i ? 1 : -1) * 0.05;
      });
      halo.rotation.z = Math.sin(t * 0.6) * 0.15;
    },
  };
}

const ROBE_TINTS = [0x24234a, 0x1b3a44, 0x3a1f2e, 0x2b2f3f, 0x30263f, 0x1f3530];
const ACCENTS = [0x2ad4e6, 0xb08cff, 0xffb547, 0x5df2b8, 0xff6f91, 0x8fd0ff];

export interface CustomerFigure extends Figure {
  accent: THREE.Color;
  dispose(): void;
}

/** A customer: robed (hooded, with a mask glow) or armoured (tall crested helm). Look is picked from the name. */
export function makeCustomer(p: Palette, name: string): CustomerFigure {
  const h = hashString(name);
  const armoured = h % 3 === 0;
  const tint = ROBE_TINTS[h % ROBE_TINTS.length];
  const accent = new THREE.Color(ACCENTS[(h >>> 4) % ACCENTS.length]);
  const scale = 1.04 + ((h >>> 8) % 100) / 100 * 0.12;
  const own: THREE.Material[] = [];
  const cloth = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.82, metalness: 0.1, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.2), toneMapped: false });
  own.push(cloth, glow);

  const root = new THREE.Group();
  root.name = `customer:${name}`;
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const robe = new THREE.Mesh(
    new THREE.LatheGeometry([V(0.0, 0.02), V(0.36, 0.02), V(0.33, 0.25), V(0.26, 0.75), V(0.19, 1.15), V(0.22, 1.38), V(0.13, 1.5), V(0.05, 1.56)], 28),
    cloth,
  );
  body.add(robe);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.012, 6, 40), p.gold);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.05;
  body.add(hem);
  for (const side of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.1, 0.01), p.gold);
    trim.position.set(side * 0.06, 0.62, 0.27);
    trim.rotation.x = -0.12;
    body.add(trim);
  }
  const mantleMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint).offsetHSL(0, 0.05, 0.08), roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  own.push(mantleMat);
  const mantle = new THREE.Mesh(new THREE.LatheGeometry([V(0.33, 1.12), V(0.3, 1.3), V(0.19, 1.48), V(0.08, 1.56)], 24), armoured ? p.goldDark : mantleMat);
  const mantleTrim = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 40), p.gold);
  mantleTrim.rotation.x = Math.PI / 2;
  mantleTrim.position.y = 1.12;
  body.add(mantleTrim);
  body.add(mantle);

  const head = new THREE.Group();
  head.position.y = 1.68;
  body.add(head);
  if (armoured) {
    const helm = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 6), p.pearlPlain);
    helm.position.y = 0.08;
    head.add(helm);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 6, 6), p.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.06;
    head.add(ring);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.014, 0.02), glow);
    slit.position.set(0, -0.0, 0.105);
    head.add(slit);
  } else {
    // the hood's opening (the missing wedge) faces forward, +z
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14, Math.PI / 2 + Math.PI * 0.17, Math.PI * 1.66, 0, Math.PI * 0.8), cloth);
    hood.scale.set(1, 1.25, 1.1);
    hood.position.y = 0.02;
    head.add(hood);
    const hoodTrim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.01, 6, 24, Math.PI * 1.2), p.gold);
    hoodTrim.position.set(0, 0.0, 0.1);
    hoodTrim.rotation.set(0, 0, -Math.PI * 0.1);
    hoodTrim.scale.set(0.75, 1.15, 1);
    head.add(hoodTrim);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: 0x030208 }));
    own.push(face.material as THREE.Material);
    face.position.z = 0.02;
    head.add(face);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), glow);
    mask.scale.set(2.2, 0.5, 0.6);
    mask.position.set(0, 0.0, 0.125);
    head.add(mask);
  }
  // a small floating sigil over the shoulder
  const sigil = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), glow);
  sigil.position.set(0.32, 1.72, -0.05);
  body.add(sigil);
  root.add(p.shadowDecal(1.0));

  const seed = (h % 1000) / 160;
  return {
    root,
    accent,
    update(_dt, speed, t) {
      const walk = Math.min(1, speed / 1.2);
      body.position.y = 0.03 + Math.sin(t * 1.4 + seed) * 0.015 + Math.abs(Math.sin(t * 6)) * 0.02 * walk;
      body.rotation.z = Math.sin(t * 3 + seed) * 0.02 * walk;
      body.rotation.x = 0.06 * walk;
      sigil.rotation.y = t * 1.5;
      sigil.position.y = 1.72 + Math.sin(t * 2 + seed) * 0.04;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of own) m.dispose();
    },
  };
}
