import * as THREE from "three";
import type { MarketStar, PriceHistory } from "@api/market";
import { CanvasLabel, FONT_DISPLAY } from "../../art/textures";
import { plat } from "../../market/layout";

/**
 * The Price Ribbon: a curved band wrapped around the Order Spire, facing the room, with the price
 * history drawn on a canvas: the min-max band, the average line (and the moving average when the
 * data has one), volume bars under it, and a few date and price ticks. Old on the left, today on
 * the right. When there is no history it says so and shows the cached snapshot as one bar.
 */

export const RIBBON_RADIUS = 1.8;
const ARC = THREE.MathUtils.degToRad(140);
const HEIGHT = 0.84;
export const RIBBON_Y = 0.74;

const SOURCE_TEXT: Record<string, string> = {
  wfm_statistics_90d: "warframe.market closed trades",
  local_daily_snapshots: "Void Trader daily snapshots",
  riven_scans: "riven market scans",
  cache_snapshot: "cached price only",
};

export class Ribbon {
  readonly group = new THREE.Group();
  private label = new CanvasLabel(2400, 640);
  private mesh: THREE.Mesh;
  private rise = 0;
  private riseTarget = 0;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    this.group.name = "price-ribbon";
    this.label.texture.anisotropy = 8;
    const geo = new THREE.CylinderGeometry(RIBBON_RADIUS, RIBBON_RADIUS, HEIGHT, 96, 1, true, -ARC / 2, ARC);
    this.material = new THREE.MeshBasicMaterial({ map: this.label.texture, transparent: true, side: THREE.FrontSide, depthWrite: false, toneMapped: false, opacity: 0 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = RIBBON_Y;
    this.mesh.renderOrder = 12;
    this.group.add(this.mesh);
    // thin gold rails along the top and bottom edges
    for (const dy of [-HEIGHT / 2 - 0.02, HEIGHT / 2 + 0.02]) {
      const rail = new THREE.Mesh(
        new THREE.TorusGeometry(RIBBON_RADIUS, 0.008, 4, 96, ARC),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.4).multiplyScalar(1.4), toneMapped: false, transparent: true }),
      );
      rail.rotation.x = Math.PI / 2;
      // the torus arc starts at +x and runs counter-clockwise seen from above; turn it onto the band
      rail.rotation.z = Math.PI / 2 - ARC / 2;
      rail.position.y = RIBBON_Y + dy;
      this.group.add(rail);
    }
  }

  setItem(item: MarketStar | null) {
    this.riseTarget = item ? 1 : 0;
    if (!item) this.draw(null, null);
  }

  setHistory(item: MarketStar | null, h: PriceHistory | null, loading = false) {
    this.draw(item, h, loading);
  }

  private draw(item: MarketStar | null, h: PriceHistory | null, loading = false) {
    this.label.draw((ctx, w, hh) => {
      if (!item) return;
      // backdrop: dark glass so the lines read over the Void and the slabs behind
      const g = ctx.createLinearGradient(0, 0, 0, hh);
      g.addColorStop(0, "rgba(6, 14, 28, 0.62)");
      g.addColorStop(1, "rgba(4, 8, 18, 0.74)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, hh);
      const padL = 150;
      const padR = 150;
      const top = 96;
      const chartB = hh - 170;
      const volT = hh - 150;
      const volB = hh - 66;
      ctx.textBaseline = "middle";
      ctx.font = `600 44px ${FONT_DISPLAY}`;
      ctx.fillStyle = "#ffd36b";
      ctx.textAlign = "left";
      const pts = h?.points ?? [];
      const head = h ? (pts.length >= 2 ? `PRICE HISTORY · ${pts.length} ${h.source === "riven_scans" ? "SCANS" : "DAYS"}` : "PRICE · NO HISTORY YET") : loading ? "READING PRICE HISTORY..." : "PRICE HISTORY";
      ctx.fillText(head, padL + 0.08 * (w - padL - padR), 50);
      ctx.textAlign = "right";
      ctx.font = `600 34px Rajdhani, sans-serif`;
      ctx.fillStyle = "rgba(200, 235, 255, 0.75)";
      if (h) ctx.fillText(SOURCE_TEXT[h.source] ?? h.source, w - padR - 0.08 * (w - padL - padR), 50);
      if (!h) return;
      if (pts.length < 2) {
        // snapshot: one bar from min to max with the average and the moving average marked
        const s = h.snapshot;
        ctx.textAlign = "center";
        ctx.font = `600 40px Rajdhani, sans-serif`;
        ctx.fillStyle = "rgba(220, 240, 255, 0.85)";
        ctx.fillText(h.note, w / 2, chartB + 40);
        if (!s) return;
        const lo = Math.max(1, s.min * 0.8);
        const hi = Math.max(lo + 1, s.max * 1.1);
        const y = (v: number) => chartB - ((v - lo) / (hi - lo)) * (chartB - top - 20);
        const x = w / 2;
        ctx.fillStyle = "rgba(232, 193, 90, 0.25)";
        ctx.fillRect(x - 160, y(s.max), 320, y(s.min) - y(s.max));
        ctx.strokeStyle = "#ffd36b";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x - 220, y(s.avg));
        ctx.lineTo(x + 220, y(s.avg));
        ctx.stroke();
        ctx.font = `700 46px Rajdhani, sans-serif`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffe39a";
        ctx.fillText(`avg ${plat(s.avg)}`, x + 240, y(s.avg));
        ctx.fillStyle = "rgba(220, 240, 255, 0.85)";
        ctx.fillText(`max ${plat(s.max)}`, x + 180, y(s.max));
        ctx.fillText(`min ${plat(s.min)}`, x + 180, y(s.min));
        if (s.moving_avg) {
          ctx.setLineDash([18, 12]);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x - 220, y(s.moving_avg));
          ctx.lineTo(x + 220, y(s.moving_avg));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.textAlign = "right";
          ctx.fillText(`moving avg ${plat(s.moving_avg)}`, x - 240, y(s.moving_avg));
        }
        return;
      }
      const lo = Math.max(0, Math.min(...pts.map((p) => p.min || p.avg)) * 0.92);
      const hi = Math.max(lo + 1, Math.max(...pts.map((p) => p.max || p.avg)) * 1.04);
      const vmax = Math.max(1, ...pts.map((p) => p.volume));
      const X = (i: number) => padL + (i / (pts.length - 1)) * (w - padL - padR);
      const Y = (v: number) => chartB - ((v - lo) / (hi - lo)) * (chartB - top);
      // grid and price ticks (left and right edges)
      const ticks = niceTicks(lo, hi, 4);
      ctx.font = `600 38px Rajdhani, sans-serif`;
      for (const v of ticks) {
        const y = Y(v);
        ctx.strokeStyle = "rgba(150, 200, 255, 0.14)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        // labels inside the plot (the ribbon's ends curve away from the viewer)
        for (const fx of [0.08, 0.62]) {
          const x = padL + fx * (w - padL - padR);
          const t = plat(v);
          const tw = ctx.measureText(t).width;
          ctx.fillStyle = "rgba(4, 10, 22, 0.8)";
          ctx.fillRect(x - 8, y - 22, tw + 16, 44);
          ctx.fillStyle = "rgba(220, 240, 255, 0.92)";
          ctx.textAlign = "left";
          ctx.fillText(t, x, y + 2);
        }
      }
      // volume bars
      const bw = Math.max(2, ((w - padL - padR) / pts.length) * 0.62);
      pts.forEach((p, i) => {
        const hgt = (p.volume / vmax) * (volB - volT);
        ctx.fillStyle = "rgba(42, 212, 230, 0.55)";
        ctx.fillRect(X(i) - bw / 2, volB - hgt, bw, hgt);
      });
      ctx.fillStyle = "rgba(170, 230, 245, 0.7)";
      ctx.font = `600 30px Rajdhani, sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(vmax)}/day`, padL - 18, volT + 6);
      // min-max band
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.max || p.avg)) : ctx.moveTo(X(i), Y(p.max || p.avg))));
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(pts[i].min || pts[i].avg));
      ctx.closePath();
      ctx.fillStyle = "rgba(232, 193, 90, 0.16)";
      ctx.fill();
      // moving average
      if (pts.some((p) => p.moving_avg)) {
        ctx.setLineDash([16, 12]);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        let started = false;
        pts.forEach((p, i) => {
          if (!p.moving_avg) return;
          if (started) ctx.lineTo(X(i), Y(p.moving_avg));
          else ctx.moveTo(X(i), Y(p.moving_avg));
          started = true;
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // the average line, with a glow
      ctx.shadowColor = "rgba(255, 200, 90, 0.9)";
      ctx.shadowBlur = 16;
      ctx.strokeStyle = "#ffd36b";
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(i), Y(p.avg)) : ctx.moveTo(X(i), Y(p.avg))));
      ctx.stroke();
      ctx.shadowBlur = 0;
      // today's value
      const last = pts[pts.length - 1];
      ctx.fillStyle = "#fff1cf";
      ctx.beginPath();
      ctx.arc(X(pts.length - 1), Y(last.avg), 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 46px Rajdhani, sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(plat(last.avg), X(pts.length - 1) - 22, Y(last.avg) - 34);
      // date ticks
      ctx.font = `600 34px Rajdhani, sans-serif`;
      ctx.fillStyle = "rgba(220, 240, 255, 0.85)";
      ctx.textAlign = "center";
      const nTicks = 5;
      for (let k = 0; k < nTicks; k++) {
        const i = Math.round((k / (nTicks - 1)) * (pts.length - 1));
        const d = new Date(pts[i].date);
        const txt = Number.isNaN(d.getTime()) ? pts[i].date.slice(0, 10) : d.toLocaleDateString("en", { month: "short", day: "numeric" });
        ctx.fillText(k === nTicks - 1 ? "today" : txt, X(i), hh - 30);
        ctx.fillRect(X(i) - 1, volB + 4, 2, 10);
      }
    });
  }

  update(dt: number) {
    this.rise += (this.riseTarget - this.rise) * (1 - Math.exp(-dt * 3));
    const r = this.rise;
    this.material.opacity = Math.min(1, Math.max(0, (r - 0.35) * 1.6));
    this.group.visible = r > 0.02;
    this.group.scale.set(0.6 + 0.4 * r, 1, 0.6 + 0.4 * r);
    for (const c of this.group.children) {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (m !== this.material) m.opacity = this.material.opacity;
    }
  }

  dispose() {
    this.label.dispose();
  }
}

/** About `n` round tick values between lo and hi. */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = Math.max(1e-6, hi - lo);
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
