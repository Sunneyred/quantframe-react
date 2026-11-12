import * as THREE from "three";
import type { MarketStar } from "@api/market";
import { additive, OUTPUT_CHUNKS } from "../../art/kit";
import { CanvasLabel, CYAN, FONT_DISPLAY, GOLD } from "../../art/textures";
import type { Interactable, InteractSystem } from "../../core/interact";
import {
  constellationOf,
  layoutConstellations,
  matchesFilter,
  NO_FILTER,
  OUTER,
  placeStar,
  plat,
  priceHeight,
  trendColor,
  trendText,
  Y_MAX,
  type Constellation,
  volumeRanks,
  type MarketFilter,
} from "../../market/layout";

/**
 * The Orrery: the whole market as a walk-in holographic star map.
 *
 * Every item is one point of a single THREE.Points draw call with a custom shader: the core and
 * its glow (size = volume, colour = trend), and, drawn in the same sprite, the rings of the user's
 * own items (gold orbit = live sell order, cyan ring = in stock, dashed violet = wish list,
 * soft halo = in the inventory). Filters dim stars through an attribute; hover and focus are
 * uniforms. Picking is a CPU pass over the stars against the view ray (cheap for ~1,500), feeding
 * one dynamic interactable, so E / click focus the star under the reticle like any other object.
 * Text is drawn on canvas sprites only for what needs it: the hovered star, a few nearby own or
 * busy stars, the constellation names and the price scale.
 */

export interface OrreryHooks {
  onFocus(star: MarketStar): void;
}

const FLAG_LIVE = 1;
const FLAG_STOCK = 2;
const FLAG_WISH = 4;
const FLAG_INV = 8;
const NEAR_LABELS = 7;
const NEAR_DIST = 3.6;
const PICK_REACH = 11;

const STAR_VERT = /* glsl */ `
uniform float uScale;
uniform float uTime;
uniform float uHover;
uniform float uFocus;
attribute float aSize;
attribute vec3 aColor;
attribute float aFlags;
attribute float aDim;
attribute float aIndex;
attribute float aPhase;
varying vec3 vColor;
varying float vFlags;
varying float vDim;
varying float vExtent;
varying float vCore;
varying float vR0;
varying float vPx;
varying float vState;
varying float vPhase;
varying float vNear;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float depth = max(0.05, -mv.z);
  // a star right in front of the eye fades instead of filling the view
  vNear = smoothstep(0.5, 2.2, depth);
  float state = abs(aIndex - uFocus) < 0.5 ? 2.0 : (abs(aIndex - uHover) < 0.5 ? 1.0 : 0.0);
  float core = aSize * (state > 1.5 ? 1.35 : state > 0.5 ? 1.25 : 1.0);
  float r0 = max(core * 2.3, 0.1);
  float extent = core * 2.6;
  if (aFlags > 0.5 || state > 0.5) extent = max(extent, r0 * 1.5);
  vPx = uScale / depth;
  // never smaller than ~2.5 px, so far stars still read as points
  float size = max(2.5, 2.0 * extent * vPx);
  gl_PointSize = min(size, 420.0);
  extent = gl_PointSize / (2.0 * vPx);
  vExtent = extent;
  vCore = max(core, 1.2 / vPx);
  vR0 = r0;
  vColor = aColor;
  vFlags = aFlags;
  vDim = aDim;
  vState = state;
  vPhase = aPhase;
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vColor;
varying float vFlags;
varying float vDim;
varying float vExtent;
varying float vCore;
varying float vR0;
varying float vPx;
varying float vState;
varying float vPhase;
varying float vNear;
float bit(float flags, float b) { return mod(floor(flags / b), 2.0); }
float ring(float d, float r, float w) { return 1.0 - smoothstep(0.0, w, abs(d - r)); }
void main() {
  vec2 q = (gl_PointCoord - 0.5) * 2.0 * vExtent;
  q.y = -q.y;
  float d = length(q);
  float px = 1.0 / vPx;
  float tw = 0.86 + 0.14 * sin(uTime * (0.8 + vPhase * 1.7) + vPhase * 40.0);
  // a tight core and a short glow that reaches zero at the sprite's edge (no visible quads)
  float edge = 1.0 - smoothstep(vExtent * 0.7, vExtent, d);
  float coreA = exp(-pow(d / vCore, 2.0) * 2.2);
  float glow = exp(-d / (vCore * 0.9)) * 0.22 * smoothstep(min(vExtent, vCore * 2.6), vCore * 0.5, d);
  vec3 col = vColor * (coreA * 1.8 + glow * 1.3) * tw;
  float w = max(px * 1.35, vR0 * 0.045);
  // the user's own items
  if (bit(vFlags, 8.0) > 0.5) col += vec3(0.55, 0.85, 1.0) * 0.16 * smoothstep(vR0 * 1.35, vR0 * 0.2, d);
  if (bit(vFlags, 2.0) > 0.5) col += vec3(0.16, 0.86, 0.95) * 1.7 * ring(d, vR0 * 0.82, w);
  if (bit(vFlags, 4.0) > 0.5) {
    float a = atan(q.y, q.x);
    float dash = smoothstep(-0.2, 0.2, sin(a * 7.0 - uTime * 0.6));
    col += vec3(0.68, 0.45, 1.0) * 1.8 * ring(d, vR0 * 1.07, w) * dash;
  }
  if (bit(vFlags, 1.0) > 0.5) {
    vec2 e = q / vec2(1.38, 0.5);
    float ed = length(e);
    col += vec3(1.0, 0.78, 0.32) * 1.9 * (1.0 - smoothstep(0.0, w * 1.5, abs(ed - vR0) * 0.62));
    float t = uTime * 1.3 + vPhase * 6.2831;
    vec2 bead = vec2(cos(t) * 1.38, sin(t) * 0.5) * vR0;
    col += vec3(1.0, 0.85, 0.5) * 2.6 * exp(-pow(length(q - bead) / max(vR0 * 0.1, px * 1.6), 2.0));
  }
  // hover and focus: a bright white ring
  if (vState > 0.5) col += vec3(1.0) * (vState > 1.5 ? 1.4 : 0.9) * ring(d, vR0 * 1.32, w * 1.2) * (0.75 + 0.25 * sin(uTime * 5.0));
  col *= edge * vNear * mix(1.0, 0.07, vDim);
  if (max(col.r, max(col.g, col.b)) < 0.004) discard;
  gl_FragColor = vec4(col, 0.0);
  ${OUTPUT_CHUNKS}
}`;

interface StarRec {
  item: MarketStar;
  index: number;
  pos: THREE.Vector3;
  size: number;
  dim: boolean;
}

export class Orrery {
  readonly group = new THREE.Group();
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial;
  private stars: StarRec[] = [];
  private byUrl = new Map<string, StarRec>();
  private sectors: Constellation[] = [];
  private decor = new THREE.Group();
  private labels: CanvasLabel[] = [];
  private hoverLabel = new CanvasLabel(1024, 240);
  private hoverSprite: THREE.Sprite;
  private hoverShown = -1;
  private near: Array<{ label: CanvasLabel; sprite: THREE.Sprite; star: number }> = [];
  private focusIdx = -1;
  private focusMarker: THREE.Sprite;
  private focusLabel = new CanvasLabel(256, 256);
  private focusFrom = new THREE.Vector3();
  private focusTo = new THREE.Vector3();
  private focusT = 1;
  private drop: THREE.Line;
  private foot: THREE.Mesh;
  private beam: THREE.Line;
  private beamTarget = new THREE.Vector3();
  private filter: MarketFilter = NO_FILTER;
  private interactable: Interactable;
  private unregister: () => void;
  hovered = -1;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camDir = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  constructor(
    interact: InteractSystem,
    private hooks: OrreryHooks,
    private viewport: () => { h: number; fov: number; pr: number },
    beamTarget: THREE.Vector3,
  ) {
    this.group.name = "orrery";
    this.beamTarget.copy(beamTarget);
    this.material = additive(
      new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uScale: { value: 600 }, uTime: { value: 0 }, uHover: { value: -1 }, uFocus: { value: -1 } },
        depthTest: true,
      }),
    );
    this.group.add(this.decor);
    // hover info
    this.hoverSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hoverLabel.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.hoverSprite.renderOrder = 40;
    this.hoverSprite.visible = false;
    this.group.add(this.hoverSprite);
    for (let i = 0; i < NEAR_LABELS; i++) {
      const label = new CanvasLabel(512, 112);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, depthWrite: false, toneMapped: false }));
      sprite.renderOrder = 30;
      sprite.visible = false;
      this.group.add(sprite);
      this.near.push({ label, sprite, star: -1 });
    }
    // focus: a turning gold reticle, a drop line to the floor and a beam to the spire
    this.focusLabel.draw((ctx, w, h) => {
      ctx.translate(w / 2, h / 2);
      ctx.strokeStyle = GOLD;
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 7;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, 96, k * (Math.PI / 2) + 0.25, (k + 1) * (Math.PI / 2) - 0.25);
        ctx.stroke();
        ctx.save();
        ctx.rotate(k * (Math.PI / 2) + Math.PI / 4);
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(108, 0);
        ctx.lineTo(124, -9);
        ctx.lineTo(124, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    this.focusMarker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.focusLabel.texture, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    this.focusMarker.visible = false;
    this.focusMarker.renderOrder = 35;
    this.group.add(this.focusMarker);
    const lineMat = additive(new THREE.LineDashedMaterial({ color: new THREE.Color(1.0, 0.8, 0.4).multiplyScalar(1.4), dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.8, toneMapped: false }), false);
    this.drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), lineMat);
    this.drop.visible = false;
    this.group.add(this.drop);
    this.foot = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.4).multiplyScalar(1.5), side: THREE.DoubleSide, toneMapped: false }), false));
    this.foot.rotation.x = -Math.PI / 2;
    this.foot.visible = false;
    this.group.add(this.foot);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(48 * 3), 3));
    this.beam = new THREE.Line(beamGeo, additive(new THREE.LineBasicMaterial({ color: new THREE.Color(1.0, 0.78, 0.35).multiplyScalar(1.2), transparent: true, opacity: 0.45, toneMapped: false }), false));
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.group.add(this.beam);

    this.interactable = {
      id: "orrery-star",
      label: "",
      verb: "Focus",
      position: new THREE.Vector3(0, -100, 0),
      radius: 0.01,
      reach: PICK_REACH,
      hint: new THREE.Vector3(),
      enabled: () => this.hovered >= 0,
      onUse: () => {
        const s = this.stars[this.hovered];
        if (s) this.hooks.onFocus(s.item);
      },
    };
    this.unregister = interact.add(this.interactable);
  }

  get count() {
    return this.stars.length;
  }

  get constellations() {
    return this.sectors;
  }

  /** Rebuild the sky for a new overview. Keeps the focus (by url) when the item is still there. */
  setItems(items: MarketStar[]) {
    const focusUrl = this.focusIdx >= 0 ? this.stars[this.focusIdx]?.item.wfm_url : null;
    this.sectors = layoutConstellations(items);
    const maxVol = items.reduce((m, i) => Math.max(m, i.volume), 0);
    const ranks = volumeRanks(items);
    this.stars = items.map((item, index) => {
      const p = placeStar(item, this.sectors, maxVol, ranks[index]);
      return { item, index, pos: new THREE.Vector3(p.x, p.y, p.z), size: p.size, dim: false };
    });
    this.byUrl = new Map(this.stars.map((s) => [this.key(s.item), s]));
    const n = this.stars.length;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const color = new Float32Array(n * 3);
    const flags = new Float32Array(n);
    const dim = new Float32Array(n);
    const index = new Float32Array(n);
    const phase = new Float32Array(n);
    this.stars.forEach((s, i) => {
      pos.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
      size[i] = s.size;
      // brightness follows volume as well as size: quiet items are faint, busy ones burn
      const v = maxVol > 0 ? Math.sqrt(Math.max(0, s.item.volume) / maxVol) : 0;
      const c = trendColor(s.item.trend_dir, s.item.trend);
      const gain = 0.32 + 0.68 * Math.min(1, v * 1.4);
      color.set([c[0] * gain, c[1] * gain, c[2] * gain], i * 3);
      const f = s.item.flags;
      flags[i] = (f.live_order ? FLAG_LIVE : 0) | (f.stock ? FLAG_STOCK : 0) | (f.wish ? FLAG_WISH : 0) | (f.inventory ? FLAG_INV : 0);
      index[i] = i;
      phase[i] = (i * 0.6180339) % 1;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geo.setAttribute("aFlags", new THREE.BufferAttribute(flags, 1));
    geo.setAttribute("aDim", new THREE.BufferAttribute(dim, 1));
    geo.setAttribute("aIndex", new THREE.BufferAttribute(index, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, Y_MAX / 2, 0), OUTER + 1);
    if (this.points) {
      this.points.geometry.dispose();
      this.points.geometry = geo;
    } else {
      this.points = new THREE.Points(geo, this.material);
      this.points.renderOrder = 8;
      this.group.add(this.points);
    }
    this.buildDecor();
    this.applyFilter();
    this.hovered = -1;
    this.hoverShown = -1;
    for (const l of this.near) l.star = -1;
    this.focusIdx = -1;
    this.material.uniforms.uFocus.value = -1;
    if (focusUrl) {
      const s = this.stars.find((x) => x.item.wfm_url === focusUrl);
      if (s) this.focusOn(s, true);
    }
    if (this.focusIdx < 0) this.clearFocusVisuals();
  }

  private key(i: MarketStar) {
    return `${i.flags.riven ? "riven:" : ""}${i.wfm_url}`;
  }

  find(url: string, riven = false): MarketStar | null {
    return this.byUrl.get(`${riven ? "riven:" : ""}${url}`)?.item ?? this.stars.find((s) => s.item.wfm_url === url)?.item ?? null;
  }

  /** World position of a star (for tests and camera framing). */
  starWorld(url: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const s = this.stars.find((x) => x.item.wfm_url === url);
    if (!s) return null;
    return this.group.localToWorld(out.copy(s.pos));
  }

  setFilter(f: MarketFilter) {
    this.filter = f;
    this.applyFilter();
  }

  private applyFilter() {
    if (!this.points) return;
    const attr = this.points.geometry.getAttribute("aDim") as THREE.BufferAttribute;
    for (const s of this.stars) {
      s.dim = !matchesFilter(s.item, this.filter);
      attr.setX(s.index, s.dim ? 1 : 0);
    }
    attr.needsUpdate = true;
  }

  /** Focus a star by url (null clears). The marker flies from the previous focus. */
  setFocus(url: string | null, riven = false) {
    if (!url) {
      this.focusIdx = -1;
      this.material.uniforms.uFocus.value = -1;
      this.clearFocusVisuals();
      return;
    }
    const s = this.byUrl.get(`${riven ? "riven:" : ""}${url}`) ?? this.stars.find((x) => x.item.wfm_url === url);
    if (s) this.focusOn(s, false);
  }

  private focusOn(s: StarRec, instant: boolean) {
    if (this.focusIdx === s.index) return;
    const hadFocus = this.focusIdx >= 0 && this.focusMarker.visible;
    this.focusFrom.copy(hadFocus ? this.focusMarker.position : s.pos.clone().add(new THREE.Vector3(0, 1.4, 0)));
    this.focusTo.copy(s.pos);
    this.focusT = instant ? 1 : 0;
    this.focusIdx = s.index;
    this.material.uniforms.uFocus.value = s.index;
    this.focusMarker.visible = true;
    this.drop.visible = true;
    this.foot.visible = true;
    this.beam.visible = true;
  }

  private clearFocusVisuals() {
    this.focusMarker.visible = false;
    this.drop.visible = false;
    this.foot.visible = false;
    this.beam.visible = false;
  }

  /** Constellation boundaries and names, constellation figures, the price scale. */
  private buildDecor() {
    for (const c of [...this.decor.children]) {
      c.removeFromParent();
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && !(mat instanceof THREE.SpriteMaterial)) mat.dispose();
      if (mat instanceof THREE.SpriteMaterial) mat.dispose();
    }
    for (const l of this.labels) l.dispose();
    this.labels = [];
    const R = OUTER + 0.4;
    const top = Y_MAX + 0.15;
    const boundary: number[] = [];
    const arcs: number[] = [];
    for (const sec of this.sectors) {
      // the wedge outline on the floor, and a post up to the constellation's name
      for (const a of [sec.start, sec.start + sec.span]) {
        const x = Math.sin(a);
        const z = -Math.cos(a);
        boundary.push(x * 0.75, 0.02, z * 0.75, x * R, 0.02, z * R);
      }
      const steps = Math.max(6, Math.round(sec.span * 20));
      for (let k = 0; k < steps; k++) {
        const a0 = sec.start + (sec.span * k) / steps;
        const a1 = sec.start + (sec.span * (k + 1)) / steps;
        for (const r of [R, 0.75]) arcs.push(Math.sin(a0) * r, 0.02, -Math.cos(a0) * r, Math.sin(a1) * r, 0.02, -Math.cos(a1) * r);
      }
      const am = sec.start + sec.span / 2;
      arcs.push(Math.sin(am) * (R + 0.1), 0.02, -Math.cos(am) * (R + 0.1), Math.sin(am) * (R + 0.1), top + 0.12, -Math.cos(am) * (R + 0.1));
    }
    const lineMat = (color: number, opacity: number) => additive(new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, toneMapped: false }), false);
    const seg = (data: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(data, 3));
      const l = new THREE.LineSegments(g, lineMat(color, opacity));
      this.decor.add(l);
      return l;
    };
    seg(boundary, 0x2ad4e6, 0.42);
    seg(arcs, 0x2ad4e6, 0.3);

    // constellation figures: a minimum spanning tree over each sector's busiest stars
    const figure: number[] = [];
    for (const sec of this.sectors) {
      const top8 = this.stars
        .filter((s) => constellationOf(s.item.category) === sec.key)
        .sort((a, b) => b.item.volume - a.item.volume)
        .slice(0, 7);
      if (top8.length < 2) continue;
      const inTree = [top8[0]];
      const rest = top8.slice(1);
      while (rest.length) {
        let bi = 0;
        let bj = 0;
        let bd = Infinity;
        rest.forEach((r, i) =>
          inTree.forEach((t, j) => {
            const d = r.pos.distanceToSquared(t.pos);
            if (d < bd) {
              bd = d;
              bi = i;
              bj = j;
            }
          }),
        );
        const a = rest.splice(bi, 1)[0];
        const b = inTree[bj];
        figure.push(a.pos.x, a.pos.y, a.pos.z, b.pos.x, b.pos.y, b.pos.z);
        inTree.push(a);
      }
    }
    seg(figure, 0xfff1d0, 0.2);

    // price scale: the axis pole, rings at 1p / 10p / 100p / 1000p, labels on the pole
    const ticks = [1, 10, 100, 1000];
    const rings: number[] = [];
    for (const p of ticks) {
      const y = priceHeight(p);
      const n = 96;
      for (let k = 0; k < n; k++) {
        if (k % 2) continue; // dotted
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        rings.push(Math.sin(a0) * R, y, -Math.cos(a0) * R, Math.sin(a1) * R, y, -Math.cos(a1) * R);
      }
      rings.push(-0.18, y, 0, 0.18, y, 0, 0, y, -0.18, 0, y, 0.18);
    }
    seg(rings, 0xffd27a, 0.28);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, top, 6), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2ad4e6).multiplyScalar(1.6), toneMapped: false }), false));
    pole.position.y = top / 2;
    this.decor.add(pole);
    for (const p of ticks) {
      const label = new CanvasLabel(256, 96);
      this.labels.push(label);
      label.draw((ctx, w, h) => {
        ctx.font = `700 64px ${FONT_DISPLAY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffe7a8";
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 10;
        ctx.fillText(p >= 1000 ? "1000p" : `${p}p`, w / 2, h / 2 + 4);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, depthWrite: false, toneMapped: false }));
      s.scale.set(0.42, 0.158, 1);
      s.position.set(0, priceHeight(p) + 0.12, 0);
      s.renderOrder = 20;
      this.decor.add(s);
    }
    // constellation names, floating over each sector's outer edge
    for (const sec of this.sectors) {
      const label = new CanvasLabel(512, 160);
      this.labels.push(label);
      label.draw((ctx, w, h) => {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `600 66px ${FONT_DISPLAY}`;
        ctx.fillStyle = "#bff6ff";
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = 14;
        ctx.fillText(sec.label.toUpperCase(), w / 2, h * 0.38);
        ctx.font = `600 38px Rajdhani, sans-serif`;
        ctx.fillStyle = "rgba(200, 240, 255, 0.8)";
        ctx.shadowBlur = 0;
        ctx.fillText(`${sec.count.toLocaleString()} ITEMS`, w / 2, h * 0.78);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, depthWrite: false, toneMapped: false }));
      const a = sec.start + sec.span / 2;
      s.position.set(Math.sin(a) * (R + 0.1), top + 0.38, -Math.cos(a) * (R + 0.1));
      s.scale.set(1.5, 0.47, 1);
      s.renderOrder = 20;
      this.decor.add(s);
    }
  }

  private drawHover(s: StarRec) {
    const it = s.item;
    this.hoverLabel.draw((ctx, w, h) => {
      ctx.fillStyle = "rgba(6, 12, 24, 0.78)";
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, 18);
      ctx.fill();
      ctx.strokeStyle = "rgba(42, 212, 230, 0.7)";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = `700 64px Rajdhani, sans-serif`;
      ctx.fillStyle = "#fff6dc";
      let name = it.name;
      while (ctx.measureText(name).width > w - 60 && name.length > 4) name = name.slice(0, -2);
      if (name !== it.name) name += "...";
      ctx.fillText(name, 28, 62);
      ctx.font = `600 46px Rajdhani, sans-serif`;
      const price = plat(it.median || it.avg_price);
      ctx.fillStyle = "#ffd36b";
      ctx.fillText(price, 28, 128);
      let x = 28 + ctx.measureText(price).width + 22;
      ctx.fillStyle = "#cfefff";
      const vol = `${it.volume >= 10 ? Math.round(it.volume) : it.volume}/day`;
      ctx.fillText(vol, x, 128);
      x += ctx.measureText(vol).width + 22;
      const [r, g, b] = trendColor(it.trend_dir, it.trend);
      ctx.fillStyle = `rgb(${Math.min(255, r * 255)}, ${Math.min(255, g * 255)}, ${Math.min(255, b * 255)})`;
      ctx.fillText(trendText(it), x, 128);
      const tags: Array<[string, string]> = [];
      if (it.flags.live_order) tags.push(["LIVE ORDER", "#ffc861"]);
      if (it.flags.stock) tags.push(["IN STOCK", "#4fe3f0"]);
      if (it.flags.wish) tags.push(["WISH LIST", "#b78cff"]);
      if (it.flags.inventory) tags.push([`OWNED${it.owned ? ` x${it.owned}` : ""}`, "#d6ecff"]);
      ctx.font = `700 34px ${FONT_DISPLAY}`;
      x = 28;
      for (const [t, c] of tags) {
        ctx.fillStyle = c;
        ctx.fillText(t, x, 190);
        x += ctx.measureText(t).width + 26;
      }
      if (!tags.length) {
        ctx.fillStyle = "rgba(200, 230, 255, 0.55)";
        ctx.font = `600 32px Rajdhani, sans-serif`;
        ctx.fillText(it.category.toUpperCase(), 28, 190);
      }
    });
  }

  private drawNear(label: CanvasLabel, s: StarRec) {
    const it = s.item;
    label.draw((ctx, w, h) => {
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(6, 12, 24, 0.6)";
      ctx.beginPath();
      ctx.roundRect(2, 8, w - 4, h - 16, 12);
      ctx.fill();
      ctx.font = `700 40px Rajdhani, sans-serif`;
      const own = it.flags.live_order ? "#ffc861" : it.flags.stock ? "#4fe3f0" : it.flags.wish ? "#b78cff" : "#e8f4ff";
      ctx.fillStyle = own;
      let name = it.name;
      while (ctx.measureText(name).width > w - 150 && name.length > 4) name = name.slice(0, -2);
      if (name !== it.name) name += "...";
      ctx.fillText(name, 16, h / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffd36b";
      ctx.fillText(plat(it.median || it.avg_price), w - 14, h / 2);
    });
  }

  /** Per frame: picking, labels, focus marker. Uses the camera's pose from the last render. */
  update(dt: number, t: number, camera: THREE.PerspectiveCamera, active: boolean) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    const vp = this.viewport();
    u.uScale.value = (vp.h * vp.pr) / (2 * Math.tan(THREE.MathUtils.degToRad(vp.fov) / 2));
    if (!this.points) return;
    this.group.updateWorldMatrix(true, false);
    this.inv.copy(this.group.matrixWorld).invert();
    camera.getWorldPosition(this.camPos).applyMatrix4(this.inv);
    camera.getWorldDirection(this.camDir).transformDirection(this.inv);

    // --- picking: the star closest to the view ray, within reach
    let best = -1;
    let bestScore = Infinity;
    let bestPerp = 0;
    if (active) {
      for (const s of this.stars) {
        if (s.dim) continue;
        const v = this.tmp.copy(s.pos).sub(this.camPos);
        const along = v.dot(this.camDir);
        if (along < 0.25 || along > PICK_REACH) continue;
        const perp = Math.sqrt(Math.max(0, v.lengthSq() - along * along));
        const tol = Math.max(s.size * 2.4, along * 0.022);
        if (perp > tol) continue;
        const score = perp / tol + along * 0.02;
        if (score < bestScore) {
          bestScore = score;
          best = s.index;
          bestPerp = perp;
        }
      }
    }
    this.hovered = best;
    u.uHover.value = best;
    const it = this.interactable;
    if (best >= 0) {
      const s = this.stars[best];
      const wpos = this.group.localToWorld(this.tmp2.copy(s.pos));
      it.position.copy(wpos);
      it.radius = bestPerp * 1.2 + 0.02;
      it.label = s.item.name.length > 26 ? s.item.name.slice(0, 25) + "..." : s.item.name;
      const dist = wpos.distanceTo(camera.position);
      it.hint!.copy(wpos).add(new THREE.Vector3(0, -(0.14 + dist * 0.035), 0));
      if (this.hoverShown !== best) {
        this.hoverShown = best;
        this.drawHover(s);
      }
      // about 300 px wide on screen at any distance
      const k = THREE.MathUtils.clamp(dist * 0.21, 0.12, 2.6);
      this.hoverSprite.scale.set(k * 2.0, k * 0.47, 1);
      this.hoverSprite.position.copy(s.pos).add(new THREE.Vector3(0, s.size * 2.5 + k * 0.3, 0));
      this.hoverSprite.visible = true;
    } else {
      this.hoverSprite.visible = false;
      it.position.set(0, -100, 0);
    }

    // --- labels on the nearest own or busy stars
    const near: StarRec[] = [];
    for (const s of this.stars) {
      if (s.dim || s.index === best) continue;
      const d2 = s.pos.distanceToSquared(this.camPos);
      if (d2 > NEAR_DIST * NEAR_DIST) continue;
      const f = s.item.flags;
      if (!(f.live_order || f.stock || f.wish || s.item.volume > 45)) continue;
      // only what is in front of the camera
      if (this.tmp.copy(s.pos).sub(this.camPos).dot(this.camDir) < 0.3) continue;
      near.push(s);
    }
    near.sort((a, b) => a.pos.distanceToSquared(this.camPos) - b.pos.distanceToSquared(this.camPos));
    const want = near.slice(0, NEAR_LABELS);
    const keep = new Set(want.map((s) => s.index));
    const free = this.near.filter((l) => l.star < 0 || !keep.has(l.star));
    for (const s of want) {
      if (this.near.some((l) => l.star === s.index)) continue;
      const slot = free.shift();
      if (!slot) break;
      slot.star = s.index;
      this.drawNear(slot.label, s);
    }
    for (const l of this.near) {
      if (l.star < 0 || !keep.has(l.star)) {
        l.star = -1;
        l.sprite.visible = false;
        continue;
      }
      const s = this.stars[l.star];
      const d = s.pos.distanceTo(this.camPos);
      const k = THREE.MathUtils.clamp(d * 0.058, 0.035, 0.22);
      l.sprite.scale.set(k * 4.57, k, 1);
      l.sprite.position.copy(s.pos).add(new THREE.Vector3(0, s.size * 2 + k * 0.75, 0));
      (l.sprite.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp((NEAR_DIST - d) / 0.8, 0, 1);
      l.sprite.visible = true;
    }

    // --- focus marker
    if (this.focusIdx >= 0) {
      const s = this.stars[this.focusIdx];
      this.focusTo.copy(s.pos);
      this.focusT = Math.min(1, this.focusT + dt / 0.75);
      const e = this.focusT * this.focusT * (3 - 2 * this.focusT);
      const m = this.focusMarker;
      m.position.lerpVectors(this.focusFrom, this.focusTo, e);
      m.position.y += Math.sin(e * Math.PI) * 0.9;
      const d = m.position.distanceTo(this.camPos);
      const sc = Math.max(0.32, d * 0.05) * (1 + 0.06 * Math.sin(t * 3));
      m.scale.set(sc, sc, 1);
      m.material.rotation = t * 0.6;
      const pos = this.drop.geometry.getAttribute("position") as THREE.BufferAttribute;
      pos.setXYZ(0, m.position.x, m.position.y, m.position.z);
      pos.setXYZ(1, m.position.x, 0.03, m.position.z);
      pos.needsUpdate = true;
      this.drop.computeLineDistances();
      this.foot.position.set(m.position.x, 0.025, m.position.z);
      // a beam arcing from the focused star to the spire's crown
      const b = this.beam.geometry.getAttribute("position") as THREE.BufferAttribute;
      const mid = this.tmp.copy(m.position).add(this.beamTarget).multiplyScalar(0.5);
      mid.y = Math.max(m.position.y, this.beamTarget.y) + 1.6;
      for (let i = 0; i < 48; i++) {
        const q = i / 47;
        const a = (1 - q) * (1 - q);
        const c = 2 * (1 - q) * q;
        const dd = q * q;
        b.setXYZ(i, a * m.position.x + c * mid.x + dd * this.beamTarget.x, a * m.position.y + c * mid.y + dd * this.beamTarget.y, a * m.position.z + c * mid.z + dd * this.beamTarget.z);
      }
      b.needsUpdate = true;
      (this.beam.material as THREE.LineBasicMaterial).opacity = 0.25 + 0.2 * Math.sin(t * 2.4);
    }
  }

  dispose() {
    this.unregister();
    this.hoverLabel.dispose();
    this.focusLabel.dispose();
    for (const l of this.labels) l.dispose();
    for (const n of this.near) n.label.dispose();
  }
}
