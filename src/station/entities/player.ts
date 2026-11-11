import { FLOORS, PLAYER_SPEED, PLAYER_START, SOLIDS } from "../engine/constants";
import { moveBody } from "../engine/collision";
import { Character, PLAYER_PALETTE, dirFromAngle, dirFromVector } from "./character";

export interface MoveIntent {
  /** Movement in world space, each -1..1 (normalised here). */
  ax: number;
  ay: number;
}

/**
 * The player: movement, click-to-move and sliding collision in world space.
 * `angle` is the facing shared by both views: the top-down view sets it from
 * the direction of travel, the first-person view turns it directly.
 */
export class Player {
  readonly sprite = new Character(PLAYER_PALETTE);
  x = PLAYER_START.x;
  y = PLAYER_START.y;
  /** Facing in radians, 0 = east, PI/2 = south (screen down). */
  angle = Math.PI / 2;
  /** Velocity actually achieved last update, px/s. */
  vx = 0;
  vy = 0;
  private path: Array<{ x: number; y: number }> = [];
  private stuck = 0;

  constructor() {
    this.sprite.setPosition(this.x, this.y);
  }

  /** Walk to a point, optionally through waypoints first. */
  moveTo(x: number, y: number, via: Array<{ x: number; y: number }> = []) {
    this.path = [...via, { x, y }];
    this.stuck = 0;
  }

  stop() {
    this.path = [];
  }

  get hasTarget() {
    return this.path.length > 0;
  }

  /** `steer` false (first person): facing is owned by the caller and movement does not change it. */
  update(dt: number, intent: MoveIntent, steer = true) {
    let dx = intent.ax;
    let dy = intent.ay;
    if (dx !== 0 || dy !== 0) {
      this.path = []; // keys override a click
    } else if (this.path.length > 0) {
      const next = this.path[0];
      const tx = next.x - this.x;
      const ty = next.y - this.y;
      const dist = Math.hypot(tx, ty);
      if (dist < 1.5) {
        this.path.shift();
        this.stuck = 0;
      } else {
        dx = tx / dist;
        dy = ty / dist;
      }
    }
    const len = Math.hypot(dx, dy);
    const px = this.x;
    const py = this.y;
    if (len > 0 && dt > 0) {
      const step = PLAYER_SPEED * dt;
      const res = moveBody(this, (dx / len) * step, (dy / len) * step, FLOORS, SOLIDS);
      this.x = res.x;
      this.y = res.y;
      if (steer) {
        this.sprite.dir = dirFromVector(dx, dy, this.sprite.dir);
        this.angle = Math.atan2(dy, dx);
      }
    }
    if (!steer) this.sprite.dir = dirFromAngle(this.angle);
    this.vx = dt > 0 ? (this.x - px) / dt : 0;
    this.vy = dt > 0 ? (this.y - py) / dt : 0;
    const moved = Math.hypot(this.x - px, this.y - py);
    this.sprite.walking = moved > 0.01;
    if (this.path.length > 0) {
      // give up on a click target we cannot reach
      this.stuck = moved < PLAYER_SPEED * dt * 0.2 ? this.stuck + dt : 0;
      if (this.stuck > 0.35) this.path = [];
    }
    this.sprite.setPosition(this.x, this.y);
    this.sprite.update(dt);
  }

  destroy() {
    this.sprite.destroy();
  }
}
