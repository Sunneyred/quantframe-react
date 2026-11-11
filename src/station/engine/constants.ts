/** Shared layout and palette for the one-room station. All units are low-res pixels. */

export const VIEW_W = 480;
export const VIEW_H = 270;

export const PAL = {
  void: 0x050412,
  wallTop: 0x0c0a1f,
  wall: 0x17123a,
  wallDark: 0x100d2a,
  wallPanel: 0x1e1848,
  floorA: 0x14112f,
  floorB: 0x181437,
  floorLine: 0x0b0920,
  gold: 0xe8c15a,
  goldLight: 0xfff1b8,
  goldDark: 0x8a6a2f,
  goldDeep: 0x5c4310,
  cyan: 0x2ad4e6,
  cyanLight: 0xb9fbff,
  cyanDark: 0x0f6a85,
  metal: 0x2b2a4d,
  metalLight: 0x45447a,
  metalDark: 0x1a1933,
  shadow: 0x000000,
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Walkable floor area (inside the walls). */
export const FLOOR: Rect = { x: 8, y: 70, w: 464, h: 192 };

/** Vault tank: outer frame on the back wall, and the glass interior the fluid is drawn in. */
export const TANK_FRAME: Rect = { x: 36, y: 10, w: 112, h: 132 };
export const TANK_GLASS: Rect = { x: 42, y: 22, w: 100, h: 108 };
export const TANK_SOLID: Rect = { x: 34, y: 70, w: 116, h: 74 };
/** Where the player stands to "use" the tank. */
export const TANK_USE = { x: 92, y: 156 };

/** Fraction of the glass height that is filled at progress 0 and at progress 1 (the goal line). */
export const TANK_FILL_MIN = 0.05;
export const TANK_FILL_GOAL = 0.86;

/** Trading counter. */
export const COUNTER: Rect = { x: 296, y: 112, w: 120, h: 26 };
export const COUNTER_SOLID: Rect = { x: 296, y: 116, w: 120, h: 22 };
export const COUNTER_BELL = { x: 404, y: 116 };

/** Customer door on the right wall and the queue in front of the counter. */
export const DOOR: Rect = { x: 472, y: 176, w: 8, h: 38 };
export const DOOR_SPAWN = { x: 484, y: 198 };
export const DOOR_INSIDE = { x: 452, y: 198 };
export const QUEUE_SLOTS = 5;
export const queueSlot = (i: number) => ({ x: 312 + i * 23, y: 154 });

/** Decorative crates (solid). */
export const CRATES: Rect[] = [
  { x: 16, y: 222, w: 22, h: 20 },
  { x: 40, y: 232, w: 18, h: 18 },
];

export const SOLIDS: Rect[] = [TANK_SOLID, COUNTER_SOLID, ...CRATES];

export const PLAYER_START = { x: 220, y: 180 };
export const PLAYER_SPEED = 78;
export const CUSTOMER_SPEED = 52;
export const INTERACT_RANGE = 30;
