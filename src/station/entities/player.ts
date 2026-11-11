import { FLOOR, PLAYER_SPEED, PLAYER_START, SOLIDS } from "../engine/constants";
import { moveBody } from "../engine/collision";
import { Character, PLAYER_PALETTE, dirFromVector } from "./character";

export interface MoveIntent {
  /** Keyboard axis, each -1..1. */
  ax: number;
  ay: number;
}

/** The player: keyboard movement, click-to-move, sliding collision. */
export class Player {
  readonly sprite = new Character(PLAYER_PALETTE);
  x = PLAYER_START.x;
  y = PLAYER_START.y;
  /** Velocity actually achieved last update, px/s. */
  vx = 0;
  vy = 0;
  private target: { x: number; y: number } | null = null;
  private stuck = 0;

  constructor() {
    this.sprite.setPosition(this.x, this.y);
  }

  moveTo(x: number, y: number) {
    this.target = { x, y };
    this.stuck = 0;
  }

  stop() {
    this.target = null;
  }

  get hasTarget() {
    return this.target !== null;
  }

  update(dt: number, intent: MoveIntent) {
    let dx = intent.ax;
    let dy = intent.ay;
    if (dx !== 0 || dy !== 0) {
      this.target = null; // keys override a click
    } else if (this.target) {
      const tx = this.target.x - this.x;
      const ty = this.target.y - this.y;
      const dist = Math.hypot(tx, ty);
      if (dist < 1.5) this.target = null;
      else {
        dx = tx / dist;
        dy = ty / dist;
      }
    }
    const len = Math.hypot(dx, dy);
    const px = this.x;
    const py = this.y;
    if (len > 0 && dt > 0) {
      const step = PLAYER_SPEED * dt;
      const res = moveBody(this, (dx / len) * step, (dy / len) * step, FLOOR, SOLIDS);
      this.x = res.x;
      this.y = res.y;
      this.sprite.dir = dirFromVector(dx, dy, this.sprite.dir);
    }
    this.vx = dt > 0 ? (this.x - px) / dt : 0;
    this.vy = dt > 0 ? (this.y - py) / dt : 0;
    const moved = Math.hypot(this.x - px, this.y - py);
    this.sprite.walking = moved > 0.01;
    if (this.target) {
      // give up on a click target we cannot reach
      this.stuck = moved < PLAYER_SPEED * dt * 0.2 ? this.stuck + dt : 0;
      if (this.stuck > 0.35) this.target = null;
    }
    this.sprite.setPosition(this.x, this.y);
    this.sprite.update(dt);
  }

  destroy() {
    this.sprite.destroy();
  }
}
