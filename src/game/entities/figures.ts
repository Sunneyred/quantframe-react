import * as THREE from "three";
import type { Palette } from "../art/materials";
import { hashString } from "../../station/engine/logic";

/**
 * Original figures built from primitives, in the ship's style.
 * The player is the ship's trader: a friendly round-headed automaton in a quilted leather flight
 * jacket and teal trousers, a glass bubble over a cream head with two lamp eyes, a raspberry scarf
 * and a little tape pack on the back. Customers are three kinds of traveller picked from the name:
 * a poncho under a fishbowl helmet with a glowing orb, a tin robot with a dial eye, and a long
 * coat under a wide hat with lit goggles.
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
  const jacket = p.leatherTan;
  const trousers = new THREE.MeshStandardMaterial({ color: 0x1d6f70, roughness: 0.85 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: 0xb8325a, roughness: 0.9, side: THREE.DoubleSide });
  const cream = p.paint.cream;
  const uvk = (g: THREE.BufferGeometry, kx: number, ky: number) => {
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * kx, uv.getY(i) * ky);
    return g;
  };

  // torso: a quilted leather jacket, a fleece collar, a brass gauge on the chest, a belt
  const torso = new THREE.Mesh(uvk(new THREE.LatheGeometry([V(0.0, 0.94), V(0.15, 0.95), V(0.16, 1.02), V(0.19, 1.3), V(0.205, 1.42), V(0.16, 1.52), V(0.07, 1.57), V(0.0, 1.58)], 20), 2, 1.2), jacket);
  torso.scale.z = 0.72;
  body.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.04, 8, 20), cream);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.535;
  body.add(collar);
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 16), p.brass);
  gauge.rotation.x = Math.PI / 2;
  gauge.position.set(-0.075, 1.36, 0.135);
  body.add(gauge);
  const gaugeLamp = new THREE.Mesh(new THREE.CircleGeometry(0.028, 14), p.warmGlow);
  gaugeLamp.position.set(-0.075, 1.36, 0.147);
  body.add(gaugeLamp);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.02, 6, 24), p.leather);
  belt.rotation.x = Math.PI / 2;
  belt.scale.y = 0.72;
  belt.position.y = 0.99;
  body.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), p.brass);
  buckle.position.set(0, 0.99, 0.12);
  body.add(buckle);
  // the tape pack on the back: a rounded cream case with a reel that turns
  const pack = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.16, 4, 12), cream);
  pack.scale.set(1.25, 1, 0.6);
  pack.position.set(0, 1.3, -0.17);
  body.add(pack);
  const reel = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), p.reel);
  reel.position.set(0, 1.32, -0.235);
  reel.rotation.y = Math.PI;
  body.add(reel);
  // a scarf: a roll at the neck and two tails down the back
  const sashes: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.09, 0.5, 1, 6);
    g.translate(0, -0.25, 0);
    const sash = new THREE.Mesh(g, scarfMat);
    sash.position.set(side * 0.05, 1.52, -0.13);
    body.add(sash);
    sashes.push(sash);
  }

  // head: cream, round, a dark face with two lamp eyes, brass ear caps, an aerial, under a glass bubble
  const head = new THREE.Group();
  head.position.y = 1.72;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), cream);
  skull.scale.set(1.05, 0.95, 1);
  head.add(skull);
  const face = plate(0.118, p.bakelite, [Math.PI * 0.22, Math.PI * 0.56], [Math.PI * 0.3, Math.PI * 0.36], [1.05, 0.95, 1.0]);
  head.add(face);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), p.warmGlow);
    eye.position.set(side * 0.042, 0.012, 0.108);
    head.add(eye);
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), p.brass);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(side * 0.122, 0, 0);
    head.add(ear);
  }
  const halo = new THREE.Group(); // the aerial
  halo.position.set(0.122, 0.02, 0);
  head.add(halo);
  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), p.chrome);
  aerial.position.y = 0.1;
  halo.add(aerial);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), p.cyanGlow);
  bead.position.y = 0.21;
  halo.add(bead);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.175, 24, 16), p.glassLike("clear", { opacity: 0.02, density: 0.06, glow: 0.3, irid: 0.25, side: THREE.FrontSide }));
  bubble.position.y = 0.015;
  head.add(bubble);
  const neckRing = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.016, 6, 24), p.brass);
  neckRing.rotation.x = Math.PI / 2;
  neckRing.position.y = -0.125;
  head.add(neckRing);

  // arms: leather sleeves, cream gauntlets with brass cuffs, dark hands
  const arms: THREE.Group[] = [];
  const fores: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), jacket);
    cap.position.set(side * 0.225, 1.47, 0);
    body.add(cap);
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 1.46, 0);
    body.add(shoulder);
    shoulder.add(capsule(0.055, 0.2, jacket));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(capsule(0.048, 0.16, jacket));
    const gauntlet = capsule(0.055, 0.1, cream);
    gauntlet.position.y -= 0.1;
    elbow.add(gauntlet);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.01, 6, 18), p.brass);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.17;
    elbow.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 10), p.bakelite);
    hand.scale.set(0.85, 1.1, 0.9);
    hand.position.y = -0.33;
    elbow.add(hand);
    shoulder.rotation.z = side * 0.08;
    arms.push(shoulder);
    fores.push(elbow);
  }

  // legs: teal trousers, brass knee caps, oxblood boots
  const thighs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.095, 0.93, 0);
    body.add(hip);
    hip.add(capsule(0.075, 0.28, trousers));
    const knee = new THREE.Group();
    knee.position.y = -0.43;
    hip.add(knee);
    const guard = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), p.brass);
    guard.scale.set(1, 1, 0.6);
    guard.position.set(0, 0, 0.055);
    knee.add(guard);
    knee.add(capsule(0.06, 0.2, trousers));
    const boot = capsule(0.07, 0.14, p.leather);
    boot.position.y -= 0.2;
    knee.add(boot);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.13, 4, 8), p.leather);
    foot.rotation.x = Math.PI / 2;
    foot.position.set(0, -0.44, 0.05);
    foot.scale.set(1, 1, 0.75);
    knee.add(foot);
    thighs.push(hip);
    shins.push(knee);
  }
  root.traverse((o) => (o.castShadow = true));
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
      sashes.forEach((sh, i) => {
        sh.rotation.x = 0.1 + amt * (0.5 + sprint * 0.4) + Math.sin(t * 1.7 + i * 1.3 + phase * amt) * (0.04 + amt * 0.08);
        sh.rotation.z = (i ? 1 : -1) * 0.08;
      });
      halo.rotation.z = Math.sin(t * 2.1) * 0.06 - 0.25;
      reel.rotation.z = t * 1.2;
      head.rotation.y = Math.sin(t * 0.4) * 0.12 * (1 - amt);
    },
  };
}

const ROBE_TINTS = [0x1d6f70, 0x8f2c48, 0xb8862a, 0x24386e, 0x5a2a5c, 0xb4502a];
const ACCENTS = [0x35d6c8, 0xb08cff, 0xffb547, 0x5df2b8, 0xff6f91, 0x8fd0ff];

export interface CustomerFigure extends Figure {
  accent: THREE.Color;
  dispose(): void;
}

/** A customer. The look is picked from the name: poncho and fishbowl, tin robot, or long coat and hat. */
export function makeCustomer(p: Palette, name: string): CustomerFigure {
  const h = hashString(name);
  const kind = h % 3;
  const tint = ROBE_TINTS[h % ROBE_TINTS.length];
  const accent = new THREE.Color(ACCENTS[(h >>> 4) % ACCENTS.length]);
  const scale = 1.04 + ((h >>> 8) % 100) / 100 * 0.12;
  const own: THREE.Material[] = [];
  const cloth = new THREE.MeshStandardMaterial({ color: tint, roughness: kind === 1 ? 0.32 : 0.85, metalness: kind === 1 ? 0.3 : 0.05, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(2.2), toneMapped: false });
  own.push(cloth, glow);
  const lathe = (pts: THREE.Vector2[], mat: THREE.Material, segs = 24) => new THREE.Mesh(new THREE.LatheGeometry(pts, segs), mat);
  const hoop = (r: number, w: number, y: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, w, 6, 28), mat);
    m.rotation.x = Math.PI / 2;
    m.position.y = y;
    return m;
  };

  const root = new THREE.Group();
  root.name = `customer:${name}`;
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const head = new THREE.Group();
  head.position.y = 1.66;
  body.add(head);
  if (kind === 0) {
    // poncho and fishbowl: a wide quilted cape, a fleece hem, a glowing orb for a face
    body.add(lathe([V(0.0, 0.04), V(0.4, 0.04), V(0.42, 0.14), V(0.34, 0.7), V(0.24, 1.2), V(0.2, 1.42), V(0.1, 1.5), V(0.0, 1.52)], cloth));
    body.add(hoop(0.41, 0.035, 0.1, p.paint.cream));
    body.add(hoop(0.21, 0.02, 1.4, p.brass));
    body.add(hoop(0.12, 0.022, 1.52, p.brass));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), glow);
    head.add(orb);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), p.glass.clear));
  } else if (kind === 1) {
    // tin robot: an enamel barrel on a skirt, a chrome dome with one dial eye, an aerial
    body.add(lathe([V(0.0, 0.03), V(0.3, 0.03), V(0.33, 0.12), V(0.24, 0.3), V(0.27, 0.5), V(0.3, 1.1), V(0.26, 1.42), V(0.12, 1.5), V(0.0, 1.5)], cloth));
    body.add(hoop(0.3, 0.02, 0.52, p.brass));
    body.add(hoop(0.3, 0.02, 1.1, p.brass));
    body.add(hoop(0.325, 0.025, 0.1, p.chrome));
    const chest = new THREE.Mesh(new THREE.CircleGeometry(0.07, 18), glow);
    chest.position.set(0, 0.86, 0.3);
    body.add(chest);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), p.chrome);
    dome.position.y = -0.12;
    head.add(dome);
    head.add(hoop(0.16, 0.016, -0.12, p.brass));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), p.brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, -0.04, 0.14);
    head.add(rim);
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), glow);
    eye.position.set(0, -0.04, 0.157);
    head.add(eye);
    const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 5), p.chrome);
    aerial.position.y = 0.13;
    head.add(aerial);
  } else {
    // long coat and hat: a tall leather coat, a scarf in the accent colour, lit goggles under a wide brim
    const coat = p.leather.clone();
    coat.color.set(tint).offsetHSL(0, -0.1, 0.05);
    own.push(coat);
    const cg = new THREE.LatheGeometry([V(0.0, 0.03), V(0.34, 0.03), V(0.31, 0.3), V(0.24, 0.9), V(0.2, 1.25), V(0.23, 1.4), V(0.12, 1.5), V(0.0, 1.52)], 24);
    const uv = cg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 3);
    body.add(new THREE.Mesh(cg, coat));
    body.add(hoop(0.14, 0.05, 1.5, cloth));
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), p.bakelite);
    head.add(skull);
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 14), glow);
      lens.position.set(side * 0.045, 0.01, 0.118);
      head.add(lens);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.008, 5, 16), p.brass);
      ring.position.set(side * 0.045, 0.01, 0.116);
      head.add(ring);
    }
    const hat = lathe([V(0.0, 0.22), V(0.09, 0.21), V(0.12, 0.08), V(0.13, 0.06), V(0.3, 0.03), V(0.31, 0.045), V(0.0, 0.05)], p.undersuit, 28);
    hat.rotation.x = -0.08;
    head.add(hat);
  }
  // a little glass lantern bobbing over the shoulder
  const sigil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), glow);
  sigil.position.set(0.34, 1.72, -0.05);
  body.add(sigil);
  root.traverse((o) => (o.castShadow = true));
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
      head.rotation.y = Math.sin(t * 0.7 + seed) * 0.2 * (1 - walk);
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
