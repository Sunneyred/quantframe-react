import { CanvasSource, Container, Graphics, Sprite, Texture } from "pixi.js";
import { PAL, TANK_FILL_GOAL, TANK_FRAME, TANK_GLASS } from "../engine/constants";
import { createFluidRenderer, renderFluid, type FluidRenderer } from "./render";
import { agitation, createFluid, disturb, isPouring, setFill, slosh, startPour, stepFluid, type FluidState } from "./sim";

/** The vault tank: glass, frame, inlet pipe and the simulated liquid inside. */
export class TankView {
  readonly view = new Container();
  readonly fluid: FluidState;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private renderer: FluidRenderer | null = null;
  private source: CanvasSource;
  private texture: Texture;
  private pipeGlow = new Graphics();
  private floorGlow = new Graphics();
  private glowPhase = 0;

  constructor(initialFill: number) {
    const { w, h } = TANK_GLASS;
    this.fluid = createFluid(w, h, initialFill);
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d");
    if (this.ctx) this.renderer = createFluidRenderer(this.ctx.createImageData(w, h));
    this.source = new CanvasSource({ resource: this.canvas, scaleMode: "nearest" });
    this.texture = new Texture({ source: this.source });

    this.view.addChild(this.floorGlow);
    this.view.addChild(this.drawBack());
    const liquid = new Sprite(this.texture);
    liquid.position.set(TANK_GLASS.x, TANK_GLASS.y);
    this.view.addChild(liquid);
    this.view.addChild(this.drawFront());
    this.view.addChild(this.pipeGlow);
    this.paint(false);
  }

  /** Frame, plinth and pipework behind the glass. */
  private drawBack(): Graphics {
    const g = new Graphics();
    const f = TANK_FRAME;
    const gl = TANK_GLASS;
    // inlet pipe from the ceiling, plus a feeder running off along the wall
    const cx = gl.x + gl.w / 2;
    g.rect(cx - 5, 0, 10, gl.y - 2).fill(PAL.metal);
    g.rect(cx - 5, 0, 2, gl.y - 2).fill(PAL.metalLight);
    g.rect(cx + 3, 0, 2, gl.y - 2).fill(PAL.metalDark);
    g.rect(cx - 7, 6, 14, 3).fill(PAL.gold);
    g.rect(cx - 7, 8, 14, 1).fill(PAL.goldDark);
    // drop shadow on the wall
    g.rect(f.x + 4, f.y + 6, f.w, f.h - 8).fill({ color: PAL.shadow, alpha: 0.35 });
    // outer frame
    g.rect(f.x, f.y + 6, f.w, f.h - 6).fill(PAL.metalDark);
    g.rect(f.x + 2, f.y + 8, f.w - 4, f.h - 10).fill(PAL.metal);
    // top cap
    g.rect(f.x - 2, f.y + 4, f.w + 4, 8).fill(PAL.metal);
    g.rect(f.x - 2, f.y + 4, f.w + 4, 2).fill(PAL.gold);
    g.rect(f.x - 2, f.y + 10, f.w + 4, 2).fill(PAL.goldDark);
    // plinth
    g.rect(f.x - 4, gl.y + gl.h + 2, f.w + 8, 12).fill(PAL.metal);
    g.rect(f.x - 4, gl.y + gl.h + 2, f.w + 8, 2).fill(PAL.gold);
    g.rect(f.x - 4, gl.y + gl.h + 11, f.w + 8, 3).fill(PAL.metalDark);
    for (let x = f.x + 4; x < f.x + f.w; x += 16) g.rect(x, gl.y + gl.h + 6, 6, 2).fill(PAL.cyanDark);
    // glass recess
    g.rect(gl.x - 2, gl.y - 2, gl.w + 4, gl.h + 4).fill(PAL.goldDark);
    g.rect(gl.x - 1, gl.y - 1, gl.w + 2, gl.h + 2).fill(PAL.void);
    return g;
  }

  /** Glass reflections, goal line and gauge ticks in front of the liquid. */
  private drawFront(): Graphics {
    const g = new Graphics();
    const gl = TANK_GLASS;
    // reflections
    g.rect(gl.x + 4, gl.y + 3, 2, gl.h - 8).fill({ color: 0xffffff, alpha: 0.16 });
    g.rect(gl.x + 8, gl.y + 3, 1, gl.h - 30).fill({ color: 0xffffff, alpha: 0.1 });
    g.rect(gl.x + gl.w - 6, gl.y + 12, 1, gl.h - 20).fill({ color: PAL.cyanLight, alpha: 0.12 });
    // gauge ticks down the right edge
    for (let i = 0; i <= 10; i++) {
      const y = Math.round(gl.y + gl.h - (i / 10) * TANK_FILL_GOAL * gl.h);
      g.rect(gl.x + gl.w - (i % 5 === 0 ? 7 : 4), y, i % 5 === 0 ? 7 : 4, 1).fill({ color: PAL.goldLight, alpha: 0.55 });
    }
    // goal line: dashed gold with arrow notches on the frame
    const gy = goalLineY();
    for (let x = gl.x; x < gl.x + gl.w; x += 6) g.rect(x, gy, 4, 1).fill({ color: PAL.goldLight, alpha: 0.95 });
    g.rect(gl.x - 5, gy - 2, 4, 5).fill(PAL.gold);
    g.rect(gl.x - 2, gy - 1, 2, 3).fill(PAL.goldLight);
    g.rect(gl.x + gl.w + 1, gy - 2, 4, 5).fill(PAL.gold);
    g.rect(gl.x + gl.w, gy - 1, 2, 3).fill(PAL.goldLight);
    // corner rivets
    for (const [x, y] of [
      [gl.x - 4, gl.y - 6],
      [gl.x + gl.w + 2, gl.y - 6],
    ]) {
      g.rect(x, y, 2, 2).fill(PAL.goldLight);
    }
    return g;
  }

  /** The live fluid pixels (RGBA, TANK_GLASS sized). The first-person view uses them as a wall texture. */
  get image(): ImageData | null {
    return this.renderer?.image ?? null;
  }

  get pouring(): boolean {
    return isPouring(this.fluid);
  }

  setFill(fill: number) {
    setFill(this.fluid, fill);
  }

  slosh(strength: number) {
    slosh(this.fluid, strength);
  }

  /** Player walked past: xFrac is their position along the glass, vx their speed. */
  nudge(xFrac: number, vx: number) {
    disturb(this.fluid, Math.min(1, Math.max(0, xFrac)), vx, 10);
  }

  surge(particles: number, duration: number, kick: number) {
    startPour(this.fluid, particles, duration);
    slosh(this.fluid, (Math.random() < 0.5 ? -1 : 1) * kick);
  }

  setLowPower(low: boolean) {
    this.fluid.maxDroplets = low ? 180 : 420;
    this.fluid.maxBubbles = low ? 6 : 14;
  }

  update(dt: number, lowPower: boolean) {
    stepFluid(this.fluid, dt);
    this.paint(lowPower);

    // glow on the floor in front of the tank breathes with the surface motion
    this.glowPhase += dt;
    const stir = Math.min(1, agitation(this.fluid) / 30);
    const a = 0.1 + 0.03 * Math.sin(this.glowPhase * 1.7) + stir * 0.14;
    const f = TANK_FRAME;
    const baseY = TANK_GLASS.y + TANK_GLASS.h + 16;
    this.floorGlow.clear();
    this.floorGlow.rect(f.x - 6, baseY, f.w + 12, 5).fill({ color: PAL.gold, alpha: a });
    this.floorGlow.rect(f.x + 4, baseY + 5, f.w - 8, 4).fill({ color: PAL.gold, alpha: a * 0.6 });
    this.floorGlow.rect(f.x + 16, baseY + 9, f.w - 32, 3).fill({ color: PAL.gold, alpha: a * 0.35 });

    // inlet lights up while pouring
    const cx = TANK_GLASS.x + TANK_GLASS.w / 2;
    this.pipeGlow.clear();
    if (isPouring(this.fluid)) {
      const flick = 0.7 + 0.3 * Math.sin(this.glowPhase * 30);
      this.pipeGlow.rect(cx - 2, 10, 4, TANK_GLASS.y - 10).fill({ color: PAL.goldLight, alpha: flick });
      this.pipeGlow.rect(cx - 7, 6, 14, 3).fill({ color: PAL.cyanLight, alpha: 0.8 * flick });
    }
  }

  private paint(lowPower: boolean) {
    if (!this.ctx || !this.renderer) return;
    renderFluid(this.renderer, this.fluid, lowPower);
    this.ctx.putImageData(this.renderer.image, 0, 0);
    this.source.update();
  }

  destroy() {
    this.view.destroy({ children: true });
    this.texture.destroy(true);
  }
}

export function goalLineY(): number {
  return Math.round(TANK_GLASS.y + TANK_GLASS.h - TANK_FILL_GOAL * TANK_GLASS.h);
}
