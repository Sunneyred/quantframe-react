import { Container, Graphics } from "pixi.js";
import { PAL } from "../engine/constants";

export type Dir = "down" | "up" | "left" | "right";

export interface CharacterPalette {
  suit: number;
  suitDark: number;
  trim: number;
  head: number;
  visor: number;
}

export const PLAYER_PALETTE: CharacterPalette = {
  suit: 0xe9e4f5,
  suitDark: 0x9d95bd,
  trim: PAL.gold,
  head: 0xf4f0ff,
  visor: PAL.cyan,
};

const CUSTOMER_SUITS: Array<[number, number, number]> = [
  [0x3f6fd1, 0x27407f, 0xb9fbff],
  [0xc0483f, 0x7a2a26, 0xffd27a],
  [0x4fae6a, 0x2c6a3f, 0xe6ffb0],
  [0x8a55c9, 0x53317f, 0xffc8f2],
  [0xd08a2e, 0x7f5119, 0xfff1b8],
  [0x3aa7a0, 0x1f625e, 0xffffff],
];

export function customerPalette(hash: number): CharacterPalette {
  // the low bits of FNV cluster for short similar names, so fold the high bits in first
  const [suit, suitDark, visor] = CUSTOMER_SUITS[(((hash >>> 16) ^ hash) >>> 0) % CUSTOMER_SUITS.length];
  return { suit, suitDark, trim: PAL.metalLight, head: 0x2b2a4d, visor };
}

/**
 * A 10x16 code-drawn character. Origin is at the feet (bottom centre) so that
 * y-sorting and collision use the same point.
 */
export class Character {
  readonly view = new Container();
  private g = new Graphics();
  private shadow = new Graphics();
  private drawnKey = "";
  dir: Dir = "down";
  walking = false;
  private walkTime = 0;

  constructor(private palette: CharacterPalette) {
    this.shadow.ellipse(0, 0, 5, 2).fill({ color: PAL.shadow, alpha: 0.4 });
    this.view.addChild(this.shadow, this.g);
    this.redraw(0);
  }

  setPosition(x: number, y: number) {
    this.view.position.set(Math.round(x), Math.round(y));
    this.view.zIndex = y;
  }

  update(dt: number) {
    this.walkTime = this.walking ? this.walkTime + dt : 0;
    const frame = this.walking ? Math.floor(this.walkTime * 7) % 2 : 0;
    this.redraw(frame);
  }

  private redraw(frame: number) {
    const key = `${this.dir}:${frame}:${this.walking ? 1 : 0}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    const p = this.palette;
    const g = this.g;
    g.clear();
    const bob = this.walking && frame === 1 ? -1 : 0;
    // legs: alternate which foot is lifted
    const liftL = this.walking && frame === 0 ? 1 : 0;
    const liftR = this.walking && frame === 1 ? 1 : 0;
    g.rect(-4, -4, 3, 4 - liftL).fill(p.suitDark);
    g.rect(1, -4, 3, 4 - liftR).fill(p.suitDark);
    // torso
    g.rect(-4, -10 + bob, 8, 6).fill(p.suit);
    g.rect(-4, -5 + bob, 8, 1).fill(p.trim);
    // arms
    if (this.dir === "left" || this.dir === "right") {
      const ax = this.dir === "left" ? -1 : 0;
      g.rect(ax, -9 + bob + (frame === 1 ? 1 : 0), 2, 4).fill(p.suitDark);
    } else {
      g.rect(-5, -9 + bob + liftL, 1, 4).fill(p.suitDark);
      g.rect(4, -9 + bob + liftR, 1, 4).fill(p.suitDark);
    }
    // head
    g.rect(-4, -16 + bob, 8, 6).fill(p.head);
    g.rect(-3, -17 + bob, 6, 1).fill(p.head);
    g.rect(-1, -18 + bob, 2, 1).fill(p.trim);
    switch (this.dir) {
      case "down":
        g.rect(-3, -14 + bob, 6, 2).fill(p.visor);
        g.rect(-1, -10 + bob, 2, 2).fill(p.trim);
        break;
      case "up":
        g.rect(-3, -12 + bob, 6, 1).fill(p.suitDark);
        g.rect(-1, -10 + bob, 2, 5).fill(p.suitDark);
        break;
      case "left":
        g.rect(-4, -14 + bob, 4, 2).fill(p.visor);
        break;
      case "right":
        g.rect(0, -14 + bob, 4, 2).fill(p.visor);
        break;
    }
  }

  destroy() {
    this.view.destroy({ children: true });
  }
}

export function dirFromVector(dx: number, dy: number, fallback: Dir): Dir {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}
