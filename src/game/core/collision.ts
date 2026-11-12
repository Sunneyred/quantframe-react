/**
 * Level collision on the floor plane: circles and rotated boxes to stay out of, and walkable areas
 * to stay inside. With no areas the walkable space is the round `bound` around the origin (one
 * room); with areas it is their union (rooms joined by corridors).
 */

export type Area = { kind: "circle"; x: number; z: number; r: number } | { kind: "rect"; x0: number; z0: number; x1: number; z1: number };

export type Collider = { kind: "circle"; x: number; z: number; r: number } | { kind: "box"; x: number; z: number; hx: number; hz: number; rot: number };

export interface P2 {
  x: number;
  z: number;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  /** Walkable radius around the origin (the room's inner wall minus clearance); used when there are no areas. */
  bound = Infinity;
  readonly areas: Area[] = [];

  /** Add a walkable area (a round room, an axis-aligned corridor). */
  area(a: Area) {
    this.areas.push(a);
    return a;
  }

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
      if (this.keepInside(p, radius)) moved = true;
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /** True when a circle of `radius` at p touches nothing. */
  free(p: P2, radius: number): boolean {
    if (!this.inside(p, radius)) return false;
    const q = { x: p.x, z: p.z };
    for (const c of this.colliders) if (pushOut(q, radius, c)) return false;
    return true;
  }

  /** True when a circle of `radius` at p lies inside the walkable space. */
  inside(p: P2, radius: number): boolean {
    if (this.areas.length === 0) return Math.hypot(p.x, p.z) <= this.bound - radius;
    return this.areas.some((a) => inArea(p, radius, a));
  }

  /** Move p to the nearest walkable point. Returns true when it moved. */
  private keepInside(p: P2, radius: number): boolean {
    if (this.areas.length === 0) {
      const len = Math.hypot(p.x, p.z);
      const max = this.bound - radius;
      if (len > max && len > 0) {
        p.x *= max / len;
        p.z *= max / len;
        return true;
      }
      return false;
    }
    if (this.areas.some((a) => inArea(p, radius, a))) return false;
    let best: P2 | null = null;
    let bestD = Infinity;
    for (const a of this.areas) {
      const q = clampToArea(p, radius, a);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    if (!best) return false;
    p.x = best.x;
    p.z = best.z;
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

const EPS = 1e-6;

function inArea(p: P2, radius: number, a: Area): boolean {
  if (a.kind === "circle") return Math.hypot(p.x - a.x, p.z - a.z) <= a.r - radius + EPS;
  return p.x >= a.x0 + radius - EPS && p.x <= a.x1 - radius + EPS && p.z >= a.z0 + radius - EPS && p.z <= a.z1 - radius + EPS;
}

function clampToArea(p: P2, radius: number, a: Area): P2 {
  if (a.kind === "circle") {
    const dx = p.x - a.x;
    const dz = p.z - a.z;
    const d = Math.hypot(dx, dz);
    const max = Math.max(0, a.r - radius);
    if (d <= max || d < 1e-9) return { x: p.x, z: p.z };
    return { x: a.x + (dx / d) * max, z: a.z + (dz / d) * max };
  }
  // an area narrower than the player clamps to its centre line
  const clamp = (v: number, v0: number, v1: number) => {
    const c = (v0 + v1) / 2;
    return Math.max(Math.min(c, v0 + radius), Math.min(Math.max(c, v1 - radius), v));
  };
  return { x: clamp(p.x, a.x0, a.x1), z: clamp(p.z, a.z0, a.z1) };
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
