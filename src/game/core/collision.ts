/** Level collision on the floor plane: circles and rotated boxes, plus a round outer boundary. */

export type Collider = { kind: "circle"; x: number; z: number; r: number } | { kind: "box"; x: number; z: number; hx: number; hz: number; rot: number };

export interface P2 {
  x: number;
  z: number;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  /** Walkable radius around the origin (the room's inner wall minus clearance). */
  bound = Infinity;

  add(c: Collider) {
    this.colliders.push(c);
    return c;
  }

  circle(x: number, z: number, r: number) {
    return this.add({ kind: "circle", x, z, r });
  }

  /** Box centred at x,z with half sizes, rotated by `rot` around Y (radians, same sense as Object3D.rotation.y). */
  box(x: number, z: number, hx: number, hz: number, rot = 0) {
    return this.add({ kind: "box", x, z, hx, hz, rot });
  }

  /** Push `p` out of every collider. Returns true when anything moved it. */
  resolve(p: P2, radius: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.colliders) if (pushOut(p, radius, c)) moved = true;
      const len = Math.hypot(p.x, p.z);
      const max = this.bound - radius;
      if (len > max && len > 0) {
        p.x *= max / len;
        p.z *= max / len;
        moved = true;
      }
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /** True when a circle of `radius` at p touches nothing. */
  free(p: P2, radius: number): boolean {
    if (Math.hypot(p.x, p.z) > this.bound - radius) return false;
    const q = { x: p.x, z: p.z };
    for (const c of this.colliders) if (pushOut(q, radius, c)) return false;
    return true;
  }

  /** Fraction (0..1) of the segment a->b a circle can travel before touching something. */
  sweep(a: P2, b: P2, radius: number, steps = 16): number {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.free({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, radius)) return (i - 1) / steps;
    }
    return 1;
  }
}

function pushOut(p: P2, radius: number, c: Collider): boolean {
  if (c.kind === "circle") {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const min = c.r + radius;
    if (d >= min) return false;
    if (d < 1e-6) {
      p.x = c.x + min;
      return true;
    }
    p.x = c.x + (dx / d) * min;
    p.z = c.z + (dz / d) * min;
    return true;
  }
  // into the box's frame (Object3D rotation.y: local x axis = (cos, 0, -sin))
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const wx = p.x - c.x;
  const wz = p.z - c.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  const cx = Math.max(-c.hx, Math.min(c.hx, lx));
  const cz = Math.max(-c.hz, Math.min(c.hz, lz));
  let dx = lx - cx;
  let dz = lz - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return false;
  let nx: number;
  let nz: number;
  if (d < 1e-6) {
    // centre inside the box: leave along the shallowest side
    const px = c.hx - Math.abs(lx);
    const pz = c.hz - Math.abs(lz);
    if (px < pz) {
      nx = Math.sign(lx) * (c.hx + radius);
      nz = lz;
    } else {
      nx = lx;
      nz = Math.sign(lz) * (c.hz + radius);
    }
  } else {
    dx /= d;
    dz /= d;
    nx = cx + dx * radius;
    nz = cz + dz * radius;
  }
  // back to world
  p.x = c.x + nx * cos + nz * sin;
  p.z = c.z - nx * sin + nz * cos;
  return true;
}
