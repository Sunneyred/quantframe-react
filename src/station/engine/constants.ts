/** Shared layout and palette for the station. All units are low-res pixels in world space (the vault starts at x 0, the warehouse at x WH_OX). */

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

// ---------------------------------------------------------------------------
// Warehouse: a second room to the right of the vault, joined by a short corridor
// through the door. Everything is aligned to the 4px grid the first-person view uses.
// ---------------------------------------------------------------------------

export const WH_OX = 480;
export const WORLD_W = 960;
export const WORLD_H = 544;
export const WH_FLOOR: Rect = { x: WH_OX + 8, y: 70, w: 464, h: 192 };
/** Walkable passage through the two walls between the rooms. */
export const CORRIDOR: Rect = { x: 470, y: 178, w: 20, h: 34 };
/** Everything walkable. A body must lie fully inside the union. */
export const FLOORS: Rect[] = [FLOOR, CORRIDOR, WH_FLOOR];
/** Where a click on the door sends the player, per side. */
export const DOOR_WH_SIDE = { x: WH_OX + 20, y: 198 };
export const DOOR_VAULT_SIDE = { x: 456, y: 198 };

/** Six shelving bays (racks), each two columns of five crate slots. */
export const RACK = { count: 6, x0: WH_OX + 40, pitch: 72, w: 40, y: 92, rows: 5, rowPitch: 28, colW: 16 } as const;
export const SLOTS_PER_BAY = RACK.rows * 2;
export const rackRect = (bay: number): Rect => ({ x: RACK.x0 + bay * RACK.pitch, y: RACK.y, w: RACK.w, h: RACK.rows * RACK.rowPitch });
/** Top-left corners of the four 4x4 uprights of a bay. */
export const rackPosts = (bay: number): Array<[number, number]> => {
  const r = rackRect(bay);
  return [
    [r.x, r.y],
    [r.x + r.w - 4, r.y],
    [r.x, r.y + r.h - 4],
    [r.x + r.w - 4, r.y + r.h - 4],
  ];
};
/** The terminal at the aisle end of a bay. */
export const terminalRect = (bay: number): Rect => ({ x: RACK.x0 + bay * RACK.pitch + 12, y: RACK.y + RACK.rows * RACK.rowPitch + 4, w: 16, h: 8 });
/** Wall display plate in the warehouse (room-local x). */
export const WH_DISPLAY: Rect = { x: 150, y: 8, w: 180, h: 34 };

// ---------------------------------------------------------------------------
// Second row: the Control Deck under the vault and the Shop Floor under the
// warehouse. Rooms are cells of a 480 x 272 grid; a room's own drawing uses
// room-local coordinates and is placed at its origin.
// ---------------------------------------------------------------------------

export const ROW_H = 272;
export type RoomId = "vault" | "warehouse" | "bridge" | "shop";
export const ROOMS: Record<RoomId, { ox: number; oy: number; name: string }> = {
  vault: { ox: 0, oy: 0, name: "Vault" },
  warehouse: { ox: WH_OX, oy: 0, name: "Warehouse" },
  bridge: { ox: 0, oy: ROW_H, name: "Control Deck" },
  shop: { ox: WH_OX, oy: ROW_H, name: "Shop Floor" },
};
export const ROOM_IDS = Object.keys(ROOMS) as RoomId[];
export const roomAt = (x: number, y: number): RoomId => (y < ROW_H ? (x < WH_OX ? "vault" : "warehouse") : x < WH_OX ? "bridge" : "shop");

export const BR_FLOOR: Rect = { x: 8, y: ROW_H + 70, w: 464, h: 192 };
export const SHOP_FLOOR: Rect = { x: WH_OX + 8, y: ROW_H + 70, w: 464, h: 192 };
/** Door between the Control Deck and the Shop Floor (same place as the one above it). */
export const CORRIDOR_LOW: Rect = { x: 470, y: ROW_H + 178, w: 20, h: 34 };
/** Room-local x span of the doors that join the two rows. */
export const SOUTH_DOOR = { x: 220, w: 36 };
/** Passages down from the vault and from the warehouse: through the bottom wall and the back wall of the room below. */
export const CORRIDOR_SV: Rect = { x: 222, y: 256, w: 32, h: ROW_H + 76 - 256 };
export const CORRIDOR_SW: Rect = { x: WH_OX + 222, y: 256, w: 32, h: ROW_H + 76 - 256 };
FLOORS.push(BR_FLOOR, SHOP_FLOOR, CORRIDOR_LOW, CORRIDOR_SV, CORRIDOR_SW);

/** Shop Floor: three shelving units for stock items and a display case for rivens. */
export const SHOP_RACK = { count: 3, x0: WH_OX + 48, pitch: 60, w: 40, y: ROW_H + 92, rows: 5, rowPitch: 28, colW: 16 } as const;
export const SHOP_SLOTS_PER_RACK = SHOP_RACK.rows * 2;
export const shopRackRect = (i: number): Rect => ({ x: SHOP_RACK.x0 + i * SHOP_RACK.pitch, y: SHOP_RACK.y, w: SHOP_RACK.w, h: SHOP_RACK.rows * SHOP_RACK.rowPitch });
export const RIVEN_CASE = { x: WH_OX + 300, y: ROW_H + 92, w: 40, rows: 4, rowPitch: 28 } as const;
export const RIVEN_SLOTS = RIVEN_CASE.rows * 2;
export const rivenCaseRect = (): Rect => ({ x: RIVEN_CASE.x, y: RIVEN_CASE.y, w: RIVEN_CASE.w, h: RIVEN_CASE.rows * RIVEN_CASE.rowPitch });
export const postsOf = (r: Rect): Array<[number, number]> => [
  [r.x, r.y],
  [r.x + r.w - 4, r.y],
  [r.x, r.y + r.h - 4],
  [r.x + r.w - 4, r.y + r.h - 4],
];
/** "Wanted" posters on the Shop Floor back wall (room-local plates), one per wish list entry. */
export const WANTED = { count: 6, x0: 266, pitch: 34, w: 31, y: 16, h: 38 } as const;
export const wantedPlate = (i: number): Rect => ({ x: WANTED.x0 + i * WANTED.pitch, y: WANTED.y, w: WANTED.w, h: WANTED.h });
/** Shop Floor wall display (room-local). */
export const SHOP_DISPLAY: Rect = { x: 16, y: 8, w: 160, h: 34 };
/** Control Deck wall plates (room-local). */
export const TRADER_DISPLAY: Rect = { x: 62, y: 10, w: 146, h: 44 };

// ---------------------------------------------------------------------------
// Fixtures: everything you can walk up to and use that is not stock.
// ---------------------------------------------------------------------------

export type FixtureId =
  | "ledger"
  | "scanner"
  | "lever"
  | "manager"
  | "about"
  | "overview"
  | "docks"
  | "comms"
  | "tradechat"
  | "engineering"
  | "captain"
  | "hatch"
  | "stockconsole"
  | "market";
/** terminal/lever/desk are solid boxes on the floor; wall is a plate on the back wall; hatch is a floor plate. */
export type FixtureKind = "terminal" | "lever" | "desk" | "wall" | "hatch";

export interface Fixture {
  id: FixtureId;
  room: RoomId;
  kind: FixtureKind;
  /** Short sign text. */
  label: string;
  /** What the interact prompt says. */
  prompt: string;
  /** World footprint (solid for boxes; the strip of floor under a wall plate; the plate itself for the hatch). */
  rect: Rect;
  /** Room-local rectangle on the back wall, for kind "wall". */
  plate?: Rect;
  /** Where fast travel puts the player, and the way they face. */
  use: { x: number; y: number };
  face: number;
}

const NORTH = -Math.PI / 2;
const terminal = (id: FixtureId, room: RoomId, label: string, prompt: string, lx: number, ly: number, below = true): Fixture => {
  const { ox, oy } = ROOMS[room];
  return { id, room, kind: "terminal", label, prompt, rect: { x: ox + lx, y: oy + ly, w: 16, h: 8 }, use: { x: ox + lx + 8, y: oy + ly + (below ? 20 : -6) }, face: below ? NORTH : -NORTH };
};
const wallPlate = (id: FixtureId, room: RoomId, label: string, prompt: string, plate: Rect): Fixture => {
  const { ox, oy } = ROOMS[room];
  return { id, room, kind: "wall", label, prompt, plate, rect: { x: ox + plate.x, y: oy + 70, w: plate.w, h: 1 }, use: { x: ox + plate.x + plate.w / 2, y: oy + 84 }, face: NORTH };
};

export const FIXTURES: Fixture[] = [
  terminal("ledger", "vault", "LEDGER", "Ledger terminal", 208, 84),
  terminal("scanner", "warehouse", "SCANNER", "Cargo scanner", 448, 80),
  { id: "lever", room: "bridge", kind: "lever", label: "TRADER", prompt: "Trader lever", rect: { x: 112, y: ROW_H + 92, w: 48, h: 16 }, use: { x: 136, y: ROW_H + 120 }, face: NORTH },
  { id: "manager", room: "bridge", kind: "desk", label: "MANAGER", prompt: "Talk to the manager", rect: { x: 300, y: ROW_H + 104, w: 56, h: 16 }, use: { x: 328, y: ROW_H + 132 }, face: NORTH },
  wallPlate("about", "bridge", "INFO", "Info plaque", { x: 14, y: 20, w: 38, h: 26 }),
  wallPlate("overview", "bridge", "OVERVIEW", "Overview screen", { x: 300, y: 12, w: 84, h: 40 }),
  wallPlate("docks", "bridge", "DOCKS", "Docks board", { x: 392, y: 12, w: 72, h: 40 }),
  terminal("comms", "bridge", "COMMS", "Comms terminal", 48, 224),
  terminal("tradechat", "bridge", "TRADE CHAT", "Trade chat terminal", 112, 224),
  terminal("engineering", "bridge", "ENGINEERING", "Engineering terminal", 336, 224),
  terminal("captain", "bridge", "CAPTAIN", "Captain's console", 400, 224),
  { id: "hatch", room: "bridge", kind: "hatch", label: "HATCH", prompt: "Maintenance hatch", rect: { x: 440, y: ROW_H + 100, w: 20, h: 16 }, use: { x: 450, y: ROW_H + 126 }, face: NORTH },
  terminal("stockconsole", "shop", "STOCK DESK", "Stock desk", 372, 224),
  terminal("market", "shop", "MARKET", "Market terminal", 424, 224),
];
export const fixtureById = (id: FixtureId): Fixture => FIXTURES.find((f) => f.id === id)!;
/** Where the manager stands, behind the desk. */
export const MANAGER_POS = { x: 328, y: ROW_H + 100 };

const WH_SOLIDS: Rect[] = [];
for (let i = 0; i < RACK.count; i++) WH_SOLIDS.push(rackRect(i), terminalRect(i));
const LOW_SOLIDS: Rect[] = [rivenCaseRect()];
for (let i = 0; i < SHOP_RACK.count; i++) LOW_SOLIDS.push(shopRackRect(i));
for (const f of FIXTURES) if (f.kind === "terminal" || f.kind === "lever" || f.kind === "desk") LOW_SOLIDS.push(f.rect);

export const SOLIDS: Rect[] = [TANK_SOLID, COUNTER_SOLID, ...CRATES, ...WH_SOLIDS, ...LOW_SOLIDS];

export const PLAYER_START = { x: 220, y: 180 };
export const PLAYER_SPEED = 78;
export const CUSTOMER_SPEED = 52;
export const INTERACT_RANGE = 30;
