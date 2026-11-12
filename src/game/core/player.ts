import * as THREE from "three";
import type { Figure } from "../entities/figures";
import type { CollisionWorld } from "./collision";
import type { Input } from "./input";

export type ViewMode = "first" | "third";

const EYE = 1.64;
const RADIUS = 0.34;
const WALK = 3.0;
const SPRINT = 5.6;
const LOOK = 0.0022;
const TURN = 2.1;

/** The player: movement with acceleration and collision, first person and over-the-shoulder cameras. */
export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector2();
  yaw = 0;
  pitch = -0.04;
  view: ViewMode = "first";
  private bob = 0;
  private bobAmt = 0;
  private bodyYaw = 0;
  private camDist = 2.5;
  speed = 0;

  constructor(
    readonly avatar: Figure,
    private world: CollisionWorld,
  ) {}

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.bodyYaw = yaw;
    this.vel.set(0, 0);
  }

  /** `control` is false while docked or flying to a screen. */
  update(dt: number, input: Input, control: boolean, t: number) {
    if (control) {
      const [mx, my] = input.consumeMouse();
      this.yaw -= mx * LOOK;
      this.pitch -= my * LOOK;
      if (input.down("ArrowLeft")) this.yaw += TURN * dt;
      if (input.down("ArrowRight")) this.yaw -= TURN * dt;
      if (input.down("ArrowUp")) this.pitch += TURN * 0.6 * dt;
      if (input.down("ArrowDown")) this.pitch -= TURN * 0.6 * dt;
      this.pitch = Math.max(-1.3, Math.min(1.25, this.pitch));
    } else input.consumeMouse();

    let fx = 0;
    let fz = 0;
    if (control) {
      const f = (input.down("KeyW") ? 1 : 0) - (input.down("KeyS") ? 1 : 0);
      const r = (input.down("KeyD") ? 1 : 0) - (input.down("KeyA") ? 1 : 0);
      const sy = Math.sin(this.yaw);
      const cy = Math.cos(this.yaw);
      // forward (-sin, -cos), right (cos, -sin)
      fx = -sy * f + cy * r;
      fz = -cy * f - sy * r;
      const len = Math.hypot(fx, fz);
      if (len > 0) {
        const sp = input.down("ShiftLeft") || input.down("ShiftRight") ? SPRINT : WALK;
        fx = (fx / len) * sp;
        fz = (fz / len) * sp;
      }
    }
    const accel = fx || fz ? 9 : 11;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (fx - this.vel.x) * k;
    this.vel.y += (fz - this.vel.y) * k;
    if (Math.abs(this.vel.x) < 0.002) this.vel.x = 0;
    if (Math.abs(this.vel.y) < 0.002) this.vel.y = 0;

    const before = { x: this.pos.x, z: this.pos.z };
    const p = { x: this.pos.x + this.vel.x * dt, z: this.pos.z + this.vel.y * dt };
    this.world.resolve(p, RADIUS);
    this.pos.x = p.x;
    this.pos.z = p.z;
    // real speed after collision, so walking into a wall does not animate a run
    this.speed = dt > 0 ? Math.hypot(p.x - before.x, p.z - before.z) / dt : 0;

    this.bob += dt * (4 + this.speed * 2.1);
    this.bobAmt += (Math.min(1, this.speed / WALK) - this.bobAmt) * (1 - Math.exp(-dt * 6));

    // the body turns toward where you walk in third person, and toward the view otherwise
    let targetYaw = this.yaw;
    if (this.view === "third" && this.speed > 0.4) targetYaw = Math.atan2(-this.vel.x, -this.vel.y);
    let d = targetYaw - this.bodyYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.bodyYaw += d * (1 - Math.exp(-dt * 10));
    this.avatar.root.position.copy(this.pos);
    this.avatar.root.rotation.y = this.bodyYaw + Math.PI; // the figure is modelled facing +z
    this.avatar.update(dt, this.speed, t);
  }

  eye(out: THREE.Vector3) {
    return out.set(this.pos.x, EYE, this.pos.z);
  }

  /** Where the camera wants to be this frame for the current view. */
  cameraPose(outPos: THREE.Vector3, outQuat: THREE.Quaternion, dt: number) {
    const e = new THREE.Euler(this.pitch, this.yaw, 0, "YXZ");
    outQuat.setFromEuler(e);
    if (this.view === "first") {
      const bobY = Math.sin(this.bob * 2) * 0.03 * this.bobAmt;
      const bobX = Math.sin(this.bob) * 0.022 * this.bobAmt;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      outPos.set(this.pos.x, EYE + bobY, this.pos.z).addScaledVector(right, bobX);
      // a hair forward so the camera is never inside the helmet
      outPos.x += -Math.sin(this.yaw) * 0.08;
      outPos.z += -Math.cos(this.yaw) * 0.08;
      return;
    }
    // over the right shoulder, pulled in when something is behind
    const pivot = new THREE.Vector3(this.pos.x, 1.62, this.pos.z);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(outQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(outQuat);
    const want = 2.6;
    const target = pivot.clone().addScaledVector(right, 0.58).addScaledVector(back, want);
    const frac = this.world.sweep({ x: pivot.x, z: pivot.z }, { x: target.x, z: target.z }, 0.22);
    const dist = Math.max(0.6, want * frac);
    this.camDist += (dist - this.camDist) * (1 - Math.exp(-dt * (dist < this.camDist ? 30 : 5)));
    outPos.copy(pivot).addScaledVector(right, 0.58 * Math.min(1, this.camDist / want)).addScaledVector(back, this.camDist);
    outPos.y = Math.max(0.35, Math.min(8, outPos.y + 0.15));
  }
}
