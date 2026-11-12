import * as THREE from "three";
import type { BookOrder, MarketStar, OrderBook, SellerStatus } from "@api/market";
import type { Palette } from "../../art/materials";
import { additive, OUTPUT_CHUNKS } from "../../art/kit";
import { CanvasLabel, FONT_DISPLAY, GOLD } from "../../art/textures";
import { plat } from "../../market/layout";

/**
 * The Order Spire: one item's live order book as a holographic column over a pedestal.
 *
 *   sell orders: slabs stacked above the glowing midline, cheapest nearest to it
 *   buy orders:  slabs below it, highest nearest to it
 *   one slab per price level: thickness = quantity, width = number of orders, distance from the
 *   midline = rank of the level plus a log of its distance from the best price, brightness = the
 *   best seller status at that level (in game bright, online half, offline faint)
 *   your own order: gold; when someone in game sells under you, your slab dims and flickers and
 *   the undercutting levels are red
 *   the spread: a column of light between the best sell and the best buy
 *
 * Slabs are one InstancedMesh; each level tweens to its target, new levels slide in from the side,
 * gone levels fade out. Labels (canvas sprites) name the nearest levels on each side.
 */

export const SPIRE_MID = 2.38;
const STEP = 0.108;
const MAX_SELL = 12;
const MAX_BUY = 10;
const MAX_SLABS = 40;
const TOP = 4.0;
const BOTTOM = 1.28;
const LABELS = 10;

const SELL = new THREE.Color(0.06, 0.58, 0.8);
const BUY = new THREE.Color(0.42, 0.26, 0.95);
const OWN = new THREE.Color(1.0, 0.68, 0.18);
const RED = new THREE.Color(1.0, 0.16, 0.22);
const STATUS_GAIN: Record<SellerStatus, number> = { ingame: 1.0, online: 0.45, offline: 0.14 };

export interface Level {
  key: string;
  side: "sell" | "buy";
  price: number;
  quantity: number;
  count: number;
  status: SellerStatus;
  own: boolean;
  /** An in-game seller under your own sell order. */
  under: boolean;
  /** Distance from the midline (target). */
  y: number;
}

const rankStatus = (s: SellerStatus) => (s === "ingame" ? 0 : s === "online" ? 1 : 2);

/** Group a book into price levels with their target heights (pure, exported for reasoning and tests). */
export function bookLevels(book: OrderBook): { levels: Level[]; gap: [number, number] } {
  const group = (orders: BookOrder[], side: "sell" | "buy", max: number) => {
    const map = new Map<number, Level>();
    for (const o of orders) {
      let l = map.get(o.platinum);
      if (!l) {
        l = { key: `${side}:${o.platinum}`, side, price: o.platinum, quantity: 0, count: 0, status: o.status, own: false, under: false, y: 0 };
        map.set(o.platinum, l);
      }
      l.quantity += o.quantity;
      l.count += 1;
      if (o.own) l.own = true;
      if (rankStatus(o.status) < rankStatus(l.status)) l.status = o.status;
    }
    return [...map.values()].sort((a, b) => (side === "sell" ? a.price - b.price : b.price - a.price)).slice(0, max);
  };
  const sells = group(book.sells, "sell", MAX_SELL);
  const buys = group(book.buys, "buy", MAX_BUY);
  const own = book.summary.own_sell;
  if (own !== null && own !== undefined)
    for (const l of sells) l.under = !l.own && l.price < own && book.sells.some((o) => o.platinum === l.price && !o.own && o.status === "ingame");
  const bestSell = sells[0]?.price ?? null;
  const bestBuy = buys[0]?.price ?? null;
  const ref = bestSell ?? bestBuy ?? 10;
  const k = Math.max(1, ref * 0.08);
  const spread = bestSell !== null && bestBuy !== null ? Math.max(0, bestSell - bestBuy) : 0;
  const gap = 0.26 + Math.min(0.4, (spread / Math.max(1, ref)) * 1.4);
  const top = SPIRE_MID + gap / 2;
  const bottom = SPIRE_MID - gap / 2;
  sells.forEach((l, i) => (l.y = Math.min(TOP, top + 0.05 + i * STEP + Math.log1p((l.price - (bestSell ?? l.price)) / k) * 0.16)));
  buys.forEach((l, i) => (l.y = Math.max(BOTTOM, bottom - 0.05 - i * STEP - Math.log1p(((bestBuy ?? l.price) - l.price) / k) * 0.16)));
  return { levels: [...sells, ...buys], gap: [bottom, top] };
}

const SLAB_VERT = /* glsl */ `
varying vec3 vColor;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vColor = instanceColor;
  vN = normalize(mat3(modelViewMatrix * instanceMatrix) * normal);
  vView = normalize(-mv.xyz);
  vLocal = position;
  gl_Position = projectionMatrix * mv;
}`;
const SLAB_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vView))), 1.6);
  float cap = step(0.45, abs(vLocal.y));
  float edge = smoothstep(0.82, 1.0, length(vLocal.xz)) * cap;
  float scan = 0.85 + 0.15 * sin(vLocal.y * 60.0 + uTime * 3.0);
  vec3 c = vColor * (0.2 + 0.7 * rim + 0.55 * edge + 0.12 * cap) * scan;
  gl_FragColor = vec4(c, 0.0);
  ${OUTPUT_CHUNKS}
}`;

interface LabelSlot {
  label: CanvasLabel;
  sprite: THREE.Sprite;
  key: string;
  text: string;
}

interface Slab {
  level: Level;
  y: number;
  x: number;
  r: number;
  h: number;
  alpha: number;
  color: THREE.Color;
  target: { y: number; r: number; h: number; alpha: number; color: THREE.Color };
  gone: boolean;
}

export class Spire {
  readonly group = new THREE.Group();
  private slabs = new Map<string, Slab>();
  private mesh: THREE.InstancedMesh;
  private slabMat: THREE.ShaderMaterial;
  private column: THREE.Mesh;
  private midRing: THREE.Mesh;
  private gapLight: THREE.Mesh;
  private rise = 0;
  private riseTarget = 0;
  private book: OrderBook | null = null;
  private item: MarketStar | null = null;
  private loading = false;
  private undercutAt = -10;
  private undercutLatch = false;
  private titleLabel = new CanvasLabel(1280, 300);
  private title: THREE.Sprite;
  private slots: LabelSlot[] = [];
  private leaders: THREE.LineSegments;
  private pulse: THREE.Mesh;
  private gap: [number, number] = [SPIRE_MID - 0.15, SPIRE_MID + 0.15];
  private gapCur: [number, number] = [SPIRE_MID - 0.15, SPIRE_MID + 0.15];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private time = 0;

  constructor(p: Palette) {
    this.group.name = "order-spire";
    // --- pedestal
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.32, 48), p.pearlPlain);
    dais.position.y = 0.16;
    this.group.add(dais);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.035, 8, 64), p.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.32;
    this.group.add(rim);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 48), p.steel);
    lens.position.y = 0.34;
    this.group.add(lens);
    const emitter = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.018, 6, 64), p.cyanGlow);
    emitter.rotation.x = Math.PI / 2;
    emitter.position.y = 0.37;
    this.group.add(emitter);
    for (let k = 0; k < 8; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.26), p.gold);
      const a = (k / 8) * Math.PI * 2;
      fin.position.set(Math.sin(a) * 1.2, 0.36, Math.cos(a) * 1.2);
      fin.rotation.y = a;
      this.group.add(fin);
    }
    this.group.add(p.shadowDecal(3.2));
    // --- column core and the midline
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9ff3ff).multiplyScalar(1.6), toneMapped: false }), false));
    this.group.add(this.column);
    this.midRing = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.012, 6, 96), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(2), toneMapped: false }), false));
    this.midRing.rotation.x = Math.PI / 2;
    this.group.add(this.midRing);
    this.gapLight = new THREE.Mesh(
      new THREE.CylinderGeometry(0.56, 0.56, 1, 48, 1, true),
      additive(
        new THREE.ShaderMaterial({
          vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uOn;
            varying vec2 vUv;
            void main() {
              float band = 1.0 - abs(vUv.y - 0.5) * 2.0;
              float a = (0.025 + 0.07 * pow(band, 0.6)) * uOn * (0.85 + 0.15 * sin(uTime * 2.0 + vUv.x * 30.0));
              gl_FragColor = vec4(vec3(1.0, 0.96, 0.86) * a, 0.0);
              ${OUTPUT_CHUNKS}
            }`,
          uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
          side: THREE.DoubleSide,
        }),
      ),
    );
    this.group.add(this.gapLight);
    // --- slabs
    this.slabMat = additive(new THREE.ShaderMaterial({ vertexShader: SLAB_VERT, fragmentShader: SLAB_FRAG, uniforms: { uTime: { value: 0 } } }));
    this.mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1), this.slabMat, MAX_SLABS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SLABS * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    this.group.add(this.mesh);
    // --- the undercut pulse: a red ring that runs down the column
    this.pulse = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.025, 6, 96), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.3).multiplyScalar(2.2), transparent: true, opacity: 0, toneMapped: false }), false));
    this.pulse.rotation.x = Math.PI / 2;
    this.pulse.visible = false;
    this.group.add(this.pulse);
    // --- title and level labels
    this.title = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.titleLabel.texture, transparent: true, depthWrite: false, toneMapped: false }));
    this.title.scale.set(2.3, 0.54, 1);
    this.title.position.set(0, TOP + 0.5, 0);
    this.title.renderOrder = 25;
    this.group.add(this.title);
    for (let i = 0; i < LABELS; i++) {
      const label = new CanvasLabel(640, 112);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, depthWrite: false, toneMapped: false }));
      sprite.scale.set(1.0, 0.175, 1);
      sprite.renderOrder = 26;
      sprite.visible = false;
      sprite.center.set(0, 0.5);
      this.group.add(sprite);
      this.slots.push({ label, sprite, key: "", text: "" });
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(LABELS * 6), 3));
    this.leaders = new THREE.LineSegments(lg, additive(new THREE.LineBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.45, toneMapped: false }), false));
    this.leaders.frustumCulled = false;
    this.group.add(this.leaders);
    this.drawTitle();
  }

  /** The focused item (null lowers the column). */
  setItem(item: MarketStar | null) {
    if (item?.wfm_url !== this.item?.wfm_url) {
      this.book = null;
      this.undercutLatch = false;
      for (const s of this.slabs.values()) {
        s.gone = true;
        s.target.alpha = 0;
      }
    }
    this.item = item;
    this.riseTarget = item ? 1 : 0;
    this.drawTitle();
  }

  setLoading(on: boolean) {
    this.loading = on;
    this.drawTitle();
  }

  setBook(book: OrderBook | null) {
    if (book && this.item && book.wfm_url !== this.item.wfm_url) return;
    this.book = book;
    const seen = new Set<string>();
    if (book) {
      const { levels, gap } = bookLevels(book);
      this.gap = gap;
      for (const l of levels) {
        seen.add(l.key);
        const undercut = book.summary.undercut_by !== null && book.summary.undercut_by !== undefined;
        const color = (l.own ? OWN.clone().multiplyScalar(undercut ? 0.35 : 1.05) : l.under ? RED.clone().multiplyScalar(1.15) : (l.side === "sell" ? SELL : BUY).clone().multiplyScalar(STATUS_GAIN[l.status])).clone();
        const target = {
          y: l.y,
          r: 0.34 + Math.min(5, l.count) * 0.055 + (l.own ? 0.06 : 0),
          h: 0.018 + 0.05 * Math.min(1, Math.log1p(l.quantity) / Math.log(30)),
          alpha: 1,
          color,
        };
        const s = this.slabs.get(l.key);
        if (s) {
          s.level = l;
          s.target = target;
          s.gone = false;
        } else {
          // new level: slides in from the side (an undercutter from further out)
          this.slabs.set(l.key, { level: l, y: target.y, x: l.under ? 1.6 : 0.9, r: target.r * 0.6, h: target.h, alpha: 0, color: color.clone(), target, gone: false });
        }
      }
      const cut = book.summary.undercut_by !== null && book.summary.undercut_by !== undefined;
      if (cut && !this.undercutLatch) this.undercutAt = this.time;
      this.undercutLatch = cut;
    }
    for (const [k, s] of this.slabs) {
      if (!seen.has(k)) {
        s.gone = true;
        s.target.alpha = 0;
      }
    }
    this.drawTitle();
    this.assignLabels();
  }

  /** True for a short while after an undercut appeared (for tests and the PA). */
  get undercutActive() {
    return this.time - this.undercutAt < 3;
  }

  private drawTitle() {
    const it = this.item;
    const b = this.book;
    this.titleLabel.draw((ctx, w, h) => {
      if (!it) return;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(6, 12, 24, 0.7)";
      ctx.beginPath();
      ctx.roundRect(8, 8, w - 16, h - 16, 26);
      ctx.fill();
      ctx.strokeStyle = "rgba(232, 193, 90, 0.8)";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.font = `700 88px Rajdhani, sans-serif`;
      ctx.fillStyle = "#fff6dc";
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 12;
      let name = it.name;
      while (ctx.measureText(name).width > w - 80 && name.length > 4) name = name.slice(0, -2);
      if (name !== it.name) name += "...";
      ctx.fillText(name, w / 2, 92);
      ctx.shadowBlur = 0;
      ctx.font = `600 58px Rajdhani, sans-serif`;
      if (!b) {
        ctx.fillStyle = "#9fefff";
        ctx.fillText(this.loading ? "READING THE ORDER BOOK..." : "NO ORDER BOOK", w / 2, 200);
        return;
      }
      const s = b.summary;
      const parts: Array<[string, string]> = [
        [`SELL ${plat(s.best_sell_ingame ?? s.best_sell_online)}`, "#7fe8f5"],
        [`BUY ${plat(s.best_buy_ingame ?? s.best_buy_any)}`, "#c3a8ff"],
        [`SPREAD ${s.spread === null ? "-" : plat(s.spread)}`, "#fff1cf"],
      ];
      const widths = parts.map(([t]) => ctx.measureText(t).width);
      const total = widths.reduce((a, c) => a + c, 0) + 70 * (parts.length - 1);
      let x = w / 2 - total / 2;
      ctx.textAlign = "left";
      parts.forEach(([t, c], i) => {
        ctx.fillStyle = c;
        ctx.fillText(t, x, 200);
        x += widths[i] + 70;
      });
    });
  }

  private assignLabels() {
    const b = this.book;
    const wanted: Array<{ key: string; text: string; color: string; status?: SellerStatus }> = [];
    if (b) {
      const levels = [...this.slabs.values()].filter((s) => !s.gone).map((s) => s.level);
      const sells = levels.filter((l) => l.side === "sell").sort((a, c) => a.price - c.price);
      const buys = levels.filter((l) => l.side === "buy").sort((a, c) => c.price - a.price);
      const label = (l: Level) => {
        if (l.own) {
          const cut = b.summary.undercut_by;
          return { key: l.key, text: `YOU ${plat(l.price)}${cut ? `  UNDERCUT ${plat(cut)}` : l.side === "sell" && b.summary.own_is_best ? "  BEST" : ""}`, color: cut ? "#ffb0a0" : "#ffd36b" };
        }
        return { key: l.key, text: `${plat(l.price)}  x${l.quantity}`, color: l.under ? "#ff8a96" : l.side === "sell" ? "#a8f3ff" : "#d2c2ff", status: l.status };
      };
      const take = (list: Level[], n: number) => list.slice(0, n).map(label);
      wanted.push(...take(sells, 4), ...take(buys, 4));
      for (const l of levels) if (l.own && !wanted.some((w) => w.key === l.key)) wanted.push(label(l));
    }
    const keep = new Set(wanted.map((w) => w.key));
    for (const slot of this.slots) if (!keep.has(slot.key)) slot.key = "";
    for (const w of wanted.slice(0, LABELS)) {
      let slot = this.slots.find((s) => s.key === w.key);
      if (!slot) slot = this.slots.find((s) => !s.key);
      if (!slot) break;
      slot.key = w.key;
      const sig = `${w.text}|${w.color}|${w.status ?? ""}`;
      if (slot.text === sig) continue;
      slot.text = sig;
      slot.label.draw((ctx, cw, ch) => {
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(6, 12, 24, 0.62)";
        ctx.beginPath();
        ctx.roundRect(2, 10, cw - 4, ch - 20, 14);
        ctx.fill();
        ctx.font = `700 62px Rajdhani, sans-serif`;
        ctx.fillStyle = w.color;
        ctx.fillText(w.text, 22, ch / 2 + 2);
        if (w.status) {
          const tw = ctx.measureText(w.text).width;
          const c = w.status === "ingame" ? "#5df2b8" : w.status === "online" ? "#ffd36b" : "#7d8799";
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(22 + tw + 30, ch / 2, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = `600 40px ${FONT_DISPLAY}`;
          ctx.fillText(w.status === "ingame" ? "IN GAME" : w.status === "online" ? "ONLINE" : "OFFLINE", 22 + tw + 52, ch / 2 + 2);
        }
      });
    }
  }

  update(dt: number, t: number) {
    this.time = t;
    const k = 1 - Math.exp(-dt * 6);
    this.rise += (this.riseTarget - this.rise) * (1 - Math.exp(-dt * 3));
    const rise = this.rise;
    const colTop = BOTTOM + (TOP + 0.3 - BOTTOM) * rise;
    this.column.scale.y = Math.max(0.001, colTop - 0.35);
    this.column.position.y = 0.35 + this.column.scale.y / 2;
    this.column.visible = rise > 0.01;
    this.slabMat.uniforms.uTime.value = t;
    // midline and the gap of light
    this.gapCur[0] += (this.gap[0] - this.gapCur[0]) * k;
    this.gapCur[1] += (this.gap[1] - this.gapCur[1]) * k;
    const lift = (y: number) => 0.35 + (y - 0.35) * rise;
    this.midRing.position.y = lift(SPIRE_MID);
    this.midRing.visible = rise > 0.05;
    (this.midRing.material as THREE.MeshBasicMaterial).color.setScalar(1.6 + 0.5 * Math.sin(t * 2));
    const g0 = lift(this.gapCur[0]);
    const g1 = lift(this.gapCur[1]);
    this.gapLight.position.y = (g0 + g1) / 2;
    this.gapLight.scale.y = Math.max(0.01, g1 - g0);
    const gm = this.gapLight.material as THREE.ShaderMaterial;
    gm.uniforms.uTime.value = t;
    gm.uniforms.uOn.value = this.book && this.book.sells.length && this.book.buys.length ? rise : 0;
    // slabs
    let n = 0;
    const undercut = !!this.book?.summary.undercut_by;
    for (const [key, s] of this.slabs) {
      s.y += (s.target.y - s.y) * k;
      s.x += (0 - s.x) * (1 - Math.exp(-dt * (s.level.under ? 2.5 : 4)));
      s.r += (s.target.r - s.r) * k;
      s.h += (s.target.h - s.h) * k;
      s.alpha += (s.target.alpha - s.alpha) * (1 - Math.exp(-dt * (s.gone ? 5 : 3.5)));
      s.color.lerp(s.target.color, k);
      if (s.gone && s.alpha < 0.02) {
        this.slabs.delete(key);
        continue;
      }
      if (n >= MAX_SLABS) continue;
      let a = s.alpha * rise;
      if (s.level.own && undercut) a *= 0.7 + 0.3 * (Math.sin(t * 17) > 0.2 ? 1 : 0.4);
      this.v.set(s.x, lift(s.y), 0);
      this.s.set(s.r, s.h, s.r);
      this.m4.compose(this.v, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m4);
      this.mesh.setColorAt(n, this.tmpColor.copy(s.color).multiplyScalar(a));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    // the undercut pulse runs from the top of the column down to your slab
    const since = t - this.undercutAt;
    const own = [...this.slabs.values()].find((s) => s.level.own && !s.gone);
    if (since < 2.2 && own) {
      const q = Math.min(1, since / 1.4);
      this.pulse.visible = true;
      this.pulse.position.y = lift(TOP + 0.2 + (own.y - TOP - 0.2) * q);
      const sc = 1 + (1 - q) * 0.6;
      this.pulse.scale.set(sc, sc, sc);
      (this.pulse.material as THREE.MeshBasicMaterial).opacity = since < 1.4 ? 1 : Math.max(0, 1 - (since - 1.4) / 0.8);
    } else this.pulse.visible = false;
    // labels and their leader lines: in order up the column, at least 0.19 m apart
    const pos = this.leaders.geometry.getAttribute("position") as THREE.BufferAttribute;
    let li = 0;
    const shown = this.slots
      .map((slot) => ({ slot, s: slot.key ? this.slabs.get(slot.key) : undefined }))
      .filter((e): e is { slot: LabelSlot; s: Slab } => !!e.s && rise >= 0.5);
    for (const slot of this.slots) if (!shown.some((e) => e.slot === slot)) slot.sprite.visible = false;
    const place = (list: typeof shown, dir: 1 | -1) => {
      list.sort((a, b) => (a.s.y - b.s.y) * dir);
      let last = dir > 0 ? -Infinity : Infinity;
      for (const { slot, s } of list) {
        let y = lift(s.y);
        y = dir > 0 ? Math.max(y, last + 0.19) : Math.min(y, last - 0.19);
        last = y;
        const x = 1.05;
        slot.sprite.position.set(x, y, 0);
        (slot.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, s.alpha) * Math.min(1, (rise - 0.5) * 2);
        slot.sprite.visible = true;
        pos.setXYZ(li * 2, s.r + s.x, lift(s.y), 0);
        pos.setXYZ(li * 2 + 1, x - 0.03, y, 0);
        li++;
      }
    };
    place(shown.filter((e) => e.s.level.side === "sell"), 1);
    place(shown.filter((e) => e.s.level.side === "buy"), -1);
    for (let i = li; i < LABELS; i++) {
      pos.setXYZ(i * 2, 0, -10, 0);
      pos.setXYZ(i * 2 + 1, 0, -10, 0);
    }
    pos.needsUpdate = true;
    this.title.visible = rise > 0.3;
    (this.title.material as THREE.SpriteMaterial).opacity = Math.min(1, (rise - 0.3) * 2);
    this.title.position.y = lift(TOP + 0.5);
  }

  private tmpColor = new THREE.Color();

  dispose() {
    this.titleLabel.dispose();
    for (const s of this.slots) s.label.dispose();
  }
}

export const SPIRE_TOP = TOP;
