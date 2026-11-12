import type { Engine, Room } from "../core/Engine";
import { ObservatoryRoom, OBS_Z } from "./observatory";
import { VaultRoom } from "./vault";

/**
 * The walkable ship: the Vault and the Market Observatory joined by a corridor, all in one scene
 * (no loading between rooms; the corridor is short and both halls stay lit). The engine runs one
 * Room, so this composes them and reports where the player is.
 */
export class Ship implements Room {
  readonly id = "ship";
  readonly spawn: { x: number; z: number; yaw: number };

  constructor(
    private engine: Engine,
    readonly vault: VaultRoom,
    readonly observatory: ObservatoryRoom,
  ) {
    this.spawn = vault.spawn;
  }

  /** Which part of the ship the player is in. */
  get where(): "vault" | "corridor" | "observatory" {
    const z = this.engine.player.pos.z;
    if (z > -11.6) return "vault";
    if (z > OBS_Z + 13) return "corridor";
    return "observatory";
  }

  update(dt: number, t: number) {
    this.vault.update(dt, t);
    this.observatory.update(dt, t);
  }

  dispose() {
    this.vault.dispose();
    this.observatory.dispose();
  }
}
