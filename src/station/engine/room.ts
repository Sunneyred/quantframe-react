import { Container, Graphics } from "pixi.js";
import { COUNTER, COUNTER_BELL, CRATES, DOOR, FLOOR, PAL, QUEUE_SLOTS, VIEW_H, VIEW_W, queueSlot } from "./constants";

/** Wall-mounted readout next to the tank. DOM labels are laid over this plate. */
export const READOUT = { x: 158, y: 18, w: 112, h: 42 };
/** Sign plate above the counter. */
export const SIGN = { x: 326, y: 14, w: 60, h: 11 };

const STRIPS = [
  { x: 280, y: 8, w: 36 },
  { x: 396, y: 8, w: 64 },
  { x: 164, y: 8, w: 100 },
];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

/** The Vault room: static architecture drawn once, plus a little ambient animation. */
export class Room {
  /** Everything below the characters. */
  readonly back = new Container();
  /** The counter, y-sorted with the characters. */
  readonly counter = new Container();
  /** Overlays drawn above everything (motes, door glow). */
  readonly front = new Container();

  private strips = new Graphics();
  private doorGlow = new Graphics();
  private terminal = new Graphics();
  private motesG = new Graphics();
  private pings = new Graphics();
  private motes: Mote[] = [];
  private pingTimes: number[] = [];
  private time = 0;

  constructor() {
    this.back.addChild(this.drawShell(), this.strips, this.doorGlow);
    this.counter.addChild(this.drawCounter(), this.terminal);
    this.counter.zIndex = COUNTER.y + COUNTER.h;
    this.front.addChild(this.motesG, this.pings);
    this.setMoteCount(16);
    this.update(0);
  }

  setMoteCount(n: number) {
    while (this.motes.length > n) this.motes.pop();
    while (this.motes.length < n) {
      this.motes.push({
        x: FLOOR.x + Math.random() * FLOOR.w,
        y: 20 + Math.random() * (VIEW_H - 40),
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 3,
        phase: Math.random() * 6.28,
      });
    }
  }

  /** Chime-style visual ping at the counter bell. */
  ping() {
    this.pingTimes.push(0);
  }

  private drawShell(): Graphics {
    const g = new Graphics();
    g.rect(0, 0, VIEW_W, VIEW_H).fill(PAL.void);

    // --- floor tiles
    const T = 16;
    for (let ty = 0; ty * T < FLOOR.h; ty++) {
      for (let tx = 0; tx * T < FLOOR.w; tx++) {
        const x = FLOOR.x + tx * T;
        const y = FLOOR.y + ty * T;
        const w = Math.min(T, FLOOR.x + FLOOR.w - x);
        const h = Math.min(T, FLOOR.y + FLOOR.h - y);
        g.rect(x, y, w, h).fill((tx + ty) % 2 === 0 ? PAL.floorA : PAL.floorB);
        g.rect(x, y, w, 1).fill(PAL.floorLine);
        g.rect(x, y, 1, h).fill(PAL.floorLine);
        if ((tx * 7 + ty * 13) % 11 === 0) g.rect(x + 7, y + 7, 2, 2).fill({ color: PAL.cyan, alpha: 0.35 });
        if ((tx * 5 + ty * 3) % 17 === 0) g.rect(x + 2, y + 2, 1, 1).fill({ color: PAL.gold, alpha: 0.5 });
      }
    }
    // Orokin-ish inlay in the middle of the floor
    const cx = 236;
    const cy = 198;
    g.poly([cx, cy - 26, cx + 44, cy, cx, cy + 26, cx - 44, cy]).stroke({ width: 1, color: PAL.gold, alpha: 0.4 });
    g.poly([cx, cy - 16, cx + 28, cy, cx, cy + 16, cx - 28, cy]).stroke({ width: 1, color: PAL.gold, alpha: 0.25 });
    g.rect(cx - 2, cy - 2, 4, 4).fill({ color: PAL.gold, alpha: 0.5 });
    // queue line in front of the counter
    for (let i = 0; i < QUEUE_SLOTS; i++) {
      const s = queueSlot(i);
      g.rect(s.x - 5, s.y + 2, 10, 1).fill({ color: PAL.cyan, alpha: i === 0 ? 0.7 : 0.3 });
    }
    // shadow under the back wall
    g.rect(FLOOR.x, FLOOR.y, FLOOR.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
    g.rect(FLOOR.x, FLOOR.y + 3, FLOOR.w, 2).fill({ color: PAL.shadow, alpha: 0.15 });

    // --- back wall
    g.rect(0, 0, VIEW_W, 6).fill(PAL.wallTop);
    g.rect(0, 6, VIEW_W, 56).fill(PAL.wall);
    for (let x = 8; x < VIEW_W; x += 32) {
      g.rect(x, 6, 1, 56).fill(PAL.wallDark);
      g.rect(x + 1, 6, 1, 56).fill({ color: PAL.wallPanel, alpha: 0.8 });
      g.rect(x + 4, 28, 24, 1).fill({ color: PAL.wallPanel, alpha: 0.7 });
      g.rect(x + 4, 46, 24, 1).fill({ color: PAL.wallDark, alpha: 0.8 });
    }
    g.rect(0, 5, VIEW_W, 1).fill(PAL.goldDark);
    g.rect(0, 62, VIEW_W, 2).fill(PAL.gold);
    g.rect(0, 64, VIEW_W, 1).fill(PAL.goldDark);
    g.rect(0, 65, VIEW_W, 5).fill(PAL.wallDark);
    for (let x = 20; x < VIEW_W; x += 48) g.rect(x, 61, 6, 4).fill(PAL.goldLight);

    // readout plate
    const r = READOUT;
    g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4).fill(PAL.metalDark);
    g.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2).fill(PAL.cyanDark);
    g.rect(r.x, r.y, r.w, r.h).fill(0x07061a);
    for (let y = r.y + 1; y < r.y + r.h; y += 3) g.rect(r.x, y, r.w, 1).fill({ color: PAL.cyan, alpha: 0.05 });
    g.rect(r.x - 2, r.y - 2, 4, 1).fill(PAL.gold);
    g.rect(r.x - 2, r.y - 2, 1, 4).fill(PAL.gold);
    g.rect(r.x + r.w - 2, r.y + r.h + 1, 4, 1).fill(PAL.gold);
    g.rect(r.x + r.w + 1, r.y + r.h - 2, 1, 4).fill(PAL.gold);
    // conduit from the readout to the tank
    g.rect(148, 38, 10, 2).fill(PAL.cyanDark);

    // shelves of stock behind the counter
    const sx = 300;
    for (let row = 0; row < 2; row++) {
      const y = 30 + row * 16;
      g.rect(sx, y + 10, 112, 2).fill(PAL.metalLight);
      g.rect(sx, y + 12, 112, 1).fill(PAL.metalDark);
      for (let i = 0; i < 9; i++) {
        const bx = sx + 3 + i * 12;
        const tall = 5 + ((i * 3 + row * 5) % 4);
        const hue = [PAL.gold, PAL.cyanDark, PAL.metalLight, PAL.goldDark, PAL.cyan][(i + row * 2) % 5];
        g.rect(bx, y + 10 - tall, 8, tall).fill(hue);
        g.rect(bx, y + 10 - tall, 8, 1).fill({ color: 0xffffff, alpha: 0.25 });
        g.rect(bx + 3, y + 10 - tall + 2, 2, 1).fill({ color: PAL.void, alpha: 0.6 });
      }
    }
    // sign plate
    g.rect(SIGN.x - 1, SIGN.y - 1, SIGN.w + 2, SIGN.h + 2).fill(PAL.gold);
    g.rect(SIGN.x, SIGN.y, SIGN.w, SIGN.h).fill(0x0a0920);

    // --- side and bottom walls
    g.rect(0, 6, 8, VIEW_H).fill(PAL.wallTop);
    g.rect(7, 70, 1, VIEW_H - 78).fill(PAL.goldDark);
    g.rect(VIEW_W - 8, 6, 8, VIEW_H).fill(PAL.wallTop);
    g.rect(VIEW_W - 8, 70, 1, VIEW_H - 78).fill(PAL.goldDark);
    g.rect(0, VIEW_H - 8, VIEW_W, 8).fill(PAL.wallTop);
    g.rect(8, VIEW_H - 8, VIEW_W - 16, 1).fill(PAL.goldDark);
    for (let y = 90; y < VIEW_H - 20; y += 40) {
      g.rect(2, y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
      if (y < DOOR.y - 16 || y > DOOR.y + DOOR.h) g.rect(VIEW_W - 5, y, 3, 14).fill({ color: PAL.cyan, alpha: 0.5 });
    }

    // --- door on the right wall
    g.rect(DOOR.x - 1, DOOR.y - 3, DOOR.w + 1, DOOR.h + 6).fill(PAL.gold);
    g.rect(DOOR.x, DOOR.y, DOOR.w, DOOR.h).fill(0x02020a);
    g.rect(DOOR.x, DOOR.y, 1, DOOR.h).fill(PAL.cyan);

    // --- crates
    for (const c of CRATES) {
      g.ellipse(c.x + c.w / 2, c.y + c.h + 1, c.w / 2 + 2, 3).fill({ color: PAL.shadow, alpha: 0.35 });
      g.rect(c.x, c.y - 8, c.w, c.h + 8).fill(PAL.metal);
      g.rect(c.x, c.y - 8, c.w, 8).fill(PAL.metalLight);
      g.rect(c.x, c.y, c.w, 1).fill(PAL.metalDark);
      g.rect(c.x + 2, c.y + 4, c.w - 4, 2).fill(PAL.goldDark);
      g.rect(c.x, c.y - 8, 2, 2).fill(PAL.gold);
      g.rect(c.x + c.w - 2, c.y - 8, 2, 2).fill(PAL.gold);
    }
    return g;
  }

  private drawCounter(): Graphics {
    const g = new Graphics();
    const c = COUNTER;
    g.rect(c.x + 2, c.y + c.h, c.w, 3).fill({ color: PAL.shadow, alpha: 0.35 });
    // top surface
    g.rect(c.x, c.y, c.w, 18).fill(PAL.metalLight);
    g.rect(c.x, c.y, c.w, 1).fill(PAL.goldLight);
    g.rect(c.x + 2, c.y + 3, c.w - 4, 12).fill(PAL.metal);
    g.rect(c.x, c.y + 17, c.w, 1).fill(PAL.gold);
    // front face
    g.rect(c.x, c.y + 18, c.w, c.h - 18).fill(PAL.metalDark);
    g.rect(c.x + 6, c.y + 21, c.w - 12, 1).fill(PAL.cyan);
    g.rect(c.x, c.y + 18, 2, c.h - 18).fill(PAL.goldDark);
    g.rect(c.x + c.w - 2, c.y + 18, 2, c.h - 18).fill(PAL.goldDark);
    // trade mat
    g.rect(c.x + 44, c.y + 5, 30, 8).fill(0x221c52);
    g.rect(c.x + 44, c.y + 5, 30, 1).fill(PAL.goldDark);
    g.rect(c.x + 56, c.y + 8, 6, 2).fill(PAL.gold);
    // bell
    const b = COUNTER_BELL;
    g.rect(b.x - 3, b.y + 3, 7, 2).fill(PAL.goldDark);
    g.rect(b.x - 2, b.y, 5, 3).fill(PAL.gold);
    g.rect(b.x - 1, b.y - 1, 3, 1).fill(PAL.goldLight);
    g.rect(b.x, b.y - 2, 1, 1).fill(PAL.goldLight);
    // terminal base
    g.rect(c.x + 8, c.y + 4, 16, 9).fill(PAL.metalDark);
    return g;
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;

    // light strips breathe
    const s = this.strips;
    s.clear();
    STRIPS.forEach((st, i) => {
      const a = 0.65 + 0.3 * Math.sin(t * 1.4 + i * 1.9);
      s.rect(st.x, st.y, st.w, 2).fill({ color: PAL.cyan, alpha: a });
      s.rect(st.x, st.y, st.w, 1).fill({ color: PAL.cyanLight, alpha: a * 0.8 });
      s.rect(st.x - 2, st.y + 2, st.w + 4, 3).fill({ color: PAL.cyan, alpha: a * 0.12 });
    });
    // a pulse of light running along the gold trim
    const run = ((t * 60) % (VIEW_W + 80)) - 40;
    s.rect(run, 62, 26, 2).fill({ color: PAL.goldLight, alpha: 0.8 });

    // door spill
    const d = this.doorGlow;
    d.clear();
    const da = 0.16 + 0.05 * Math.sin(t * 2.3);
    d.rect(DOOR.x - 10, DOOR.y + 2, 10, DOOR.h - 4).fill({ color: PAL.cyan, alpha: da });
    d.rect(DOOR.x - 22, DOOR.y + 6, 12, DOOR.h - 12).fill({ color: PAL.cyan, alpha: da * 0.5 });

    // counter terminal flicker
    const c = COUNTER;
    const tg = this.terminal;
    tg.clear();
    tg.rect(c.x + 9, c.y + 5, 14, 7).fill({ color: PAL.cyanDark, alpha: 0.9 });
    const row = Math.floor(t * 4) % 3;
    for (let i = 0; i < 3; i++) {
      tg.rect(c.x + 10, c.y + 6 + i * 2, i === row ? 12 : 6 + ((i * 5 + Math.floor(t)) % 5), 1).fill({ color: PAL.cyanLight, alpha: i === row ? 1 : 0.55 });
    }

    // dust motes
    const m = this.motesG;
    m.clear();
    for (const p of this.motes) {
      p.x += (p.vx + Math.sin(t * 0.7 + p.phase) * 2) * dt;
      p.y += p.vy * dt;
      if (p.y < 8) {
        p.y = VIEW_H - 12;
        p.x = FLOOR.x + Math.random() * FLOOR.w;
      }
      if (p.x < FLOOR.x) p.x += FLOOR.w;
      if (p.x > FLOOR.x + FLOOR.w) p.x -= FLOOR.w;
      const a = 0.18 + 0.16 * Math.sin(t * 1.3 + p.phase);
      m.rect(Math.round(p.x), Math.round(p.y), 1, 1).fill({ color: p.phase > 3.14 ? PAL.cyanLight : PAL.goldLight, alpha: Math.max(0.04, a) });
    }

    // chime rings
    const pg = this.pings;
    pg.clear();
    for (let i = this.pingTimes.length - 1; i >= 0; i--) {
      const age = (this.pingTimes[i] += dt);
      if (age > 1.1) {
        this.pingTimes.splice(i, 1);
        continue;
      }
      for (let k = 0; k < 2; k++) {
        const a = age - k * 0.22;
        if (a <= 0) continue;
        const rad = 3 + a * 26;
        pg.circle(COUNTER_BELL.x, COUNTER_BELL.y, rad).stroke({ width: 1, color: k === 0 ? PAL.goldLight : PAL.cyanLight, alpha: Math.max(0, 1 - a / 0.9) });
      }
    }
  }

  destroy() {
    this.back.destroy({ children: true });
    this.counter.destroy({ children: true });
    this.front.destroy({ children: true });
  }
}
