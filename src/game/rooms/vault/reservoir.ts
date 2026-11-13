import * as THREE from "three";
import { blown, FORMS, tiered } from "../../art/glass";
import type { Palette } from "../../art/materials";
import { additive, Batch, OUTPUT_CHUNKS } from "../../art/kit";
import { Idlers, instrumentCluster, scaleUV } from "../../art/props";
import { CanvasLabel, FONT_DISPLAY, GOLD } from "../../art/textures";
import { clamp, easeLevel, planSurge, progressToFill, type GoalSnapshot } from "../../../station/engine/logic";

/**
 * The Plat Reservoir: a great blown-glass vessel of glowing gold liquid, swelling to a belly and
 * drawn in to a neck, held in a brass armature on a walnut and leather plinth. The glass is
 * latticino (white canes and gold threads): a show piece with real refraction on HIGH, the cheap
 * glass shader on LOW. The liquid follows the vessel's profile (`vesselR`, mirrored in GLSL). Fill level follows plat goal progress
 * (the station's own mapping, `progressToFill`), the goal ring marks a full goal, and a sale pours
 * liquid in from the crown (sized with the station's `planSurge`), sloshes the surface and floats "+Np".
 */

export const BASE_Y = 1.02;
export const TOP_Y = 7.45;
export const RADIUS = 1.12;
const FILL_MIN = 0.05;
const FILL_GOAL = 0.86;
const SPAN = TOP_Y - BASE_Y;
export const GOAL_Y = BASE_Y + FILL_GOAL * SPAN;

/** Outer radius of the glass at height y: a belly low down, a neck at the goal line, a flared lip. */
export function vesselR(y: number): number {
  const t = (y - BASE_Y) / SPAN;
  const lip = Math.min(1, Math.max(0, (t - 0.93) / 0.07));
  return RADIUS * (1 + 0.3 * Math.exp(-(((t - 0.3) / 0.26) ** 2)) - 0.16 * Math.exp(-(((t - 0.86) / 0.12) ** 2)) + 0.1 * lip * lip * (3 - 2 * lip));
}
const WALL = 0.06; // glass thickness: the liquid stays this far inside
const VESSEL_GLSL = /* glsl */ `
float vesselR(float y) {
  float t = (y - ${BASE_Y.toFixed(3)}) / ${SPAN.toFixed(3)};
  float a = (t - 0.3) / 0.26;
  float b = (t - 0.86) / 0.12;
  return ${RADIUS.toFixed(3)} * (1.0 + 0.3 * exp(-a * a) - 0.16 * exp(-b * b) + 0.1 * smoothstep(0.93, 1.0, t));
}
float liquidR(float y) { return vesselR(y) - ${WALL.toFixed(3)}; }`;

// The surface shape, shared by the side wall's top edge and the surface disc.
const SURFACE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uSlosh;
uniform float uDir;
float surfaceAt(vec2 p) {
  float tilt = uSlosh * dot(p, vec2(cos(uDir), sin(uDir))) * sin(uTime * 3.4);
  float swirl = uSlosh * 0.5 * dot(p, vec2(-sin(uDir), cos(uDir))) * cos(uTime * 2.9);
  float waves = 0.018 * sin(p.x * 5.0 + uTime * 1.7) + 0.014 * cos(p.y * 6.3 - uTime * 1.3) + 0.01 * sin((p.x + p.y) * 9.0 + uTime * 2.6);
  return uLevel + tilt + swirl + waves * (1.0 + uSlosh * 6.0);
}`;

const NOISE_GLSL = /* glsl */ `
float caustic(vec2 p, float t) {
  float c = 0.0;
  c += sin(p.x * 3.1 + t * 0.9 + sin(p.y * 2.3 + t * 0.7) * 1.6);
  c += sin(p.y * 3.7 - t * 1.1 + sin(p.x * 1.9 - t * 0.5) * 1.4);
  c += sin((p.x + p.y) * 2.2 + t * 0.6);
  c = abs(c) / 3.0;
  return pow(1.0 - c, 6.0);
}`;

const SIDE_VERT = /* glsl */ `
${SURFACE_GLSL}
${VESSEL_GLSL}
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  // a unit cylinder: xz is the direction, y the fraction of the fill height
  vec2 dir = normalize(position.xz);
  float top = surfaceAt(dir * liquidR(uLevel));
  float y = mix(${BASE_Y.toFixed(3)}, top, position.y);
  float r = liquidR(y);
  vec3 p = vec3(dir.x * r, y, dir.y * r);
  vPos = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float slope = (liquidR(y + 0.05) - liquidR(y - 0.05)) / 0.1;
  vNormalV = normalize(normalMatrix * normalize(vec3(dir.x, -slope, dir.y)));
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const SIDE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uGlow;
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewDir;
${NOISE_GLSL}
void main() {
  float h = clamp((vPos.y - ${BASE_Y.toFixed(3)}) / max(0.05, uLevel - ${BASE_Y.toFixed(3)}), 0.0, 1.0);
  vec3 deep = vec3(0.10, 0.028, 0.0);
  vec3 bright = vec3(0.72, 0.33, 0.035);
  vec3 col = mix(deep, bright, pow(h, 1.6));
  float ang = atan(vPos.z, vPos.x);
  vec2 cp = vec2(ang * 1.8, vPos.y * 1.6);
  float c = caustic(cp, uTime * 0.8) + caustic(cp * 1.7 + 3.0, uTime * 1.1) * 0.6;
  col += vec3(1.0, 0.66, 0.2) * c * (0.35 + 0.45 * h);
  float fres = pow(1.0 - abs(dot(vNormalV, vViewDir)), 2.0);
  col += vec3(0.9, 0.5, 0.12) * fres * 0.25;
  // a bright meniscus line just under the surface
  col += vec3(1.0, 0.8, 0.45) * smoothstep(0.95, 1.0, h) * 0.6;
  gl_FragColor = vec4(col * uGlow, 1.0);
  ${OUTPUT_CHUNKS}
}`;

const SURF_VERT = /* glsl */ `
${SURFACE_GLSL}
${VESSEL_GLSL}
varying float vEdge;
varying vec2 vXZ;
varying vec3 vViewDir;
varying vec3 vN;
void main() {
  vec3 p = position;
  vXZ = p.xz;
  p.y = surfaceAt(p.xz);
  vEdge = liquidR(uLevel);
  float e = 0.04;
  vec3 n = normalize(vec3(surfaceAt(p.xz - vec2(e, 0.0)) - surfaceAt(p.xz + vec2(e, 0.0)), 2.0 * e, surfaceAt(p.xz - vec2(0.0, e)) - surfaceAt(p.xz + vec2(0.0, e))));
  vN = n;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vViewDir = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SURF_FRAG = /* glsl */ `
uniform float uTime;
uniform float uGlow;
varying vec2 vXZ;
varying vec3 vViewDir;
varying vec3 vN;
varying float vEdge;
${NOISE_GLSL}
void main() {
  float r = length(vXZ);
  if (r > vEdge) discard;
  float c = caustic(vXZ * 3.0, uTime * 1.2);
  vec3 col = mix(vec3(0.85, 0.42, 0.05), vec3(1.0, 0.74, 0.3), c);
  float spec = pow(max(0.0, dot(reflect(-vViewDir, vN), normalize(vec3(0.2, 1.0, 0.1)))), 30.0);
  col += vec3(1.0, 0.95, 0.8) * spec * 1.5;
  col *= 1.0 + smoothstep(vEdge - 0.12, vEdge, r) * 0.6;
  gl_FragColor = vec4(col * uGlow * 1.05, 1.0);
  ${OUTPUT_CHUNKS}
}`;

const POUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const POUR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float s = 0.6 + 0.4 * sin(vUv.y * 40.0 + uTime * 30.0) * sin(vUv.x * 12.0 + uTime * 6.0);
  float edge = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 2.0);
  float a = clamp(uAlpha * (0.6 + 0.4 * s), 0.0, 1.0);
  vec3 col = vec3(1.0, 0.75, 0.28) * (1.4 + s * 0.8) * (0.5 + edge);
  gl_FragColor = vec4(col * a, a);
  ${OUTPUT_CHUNKS}
}`;

const MOTE_VERT = /* glsl */ `
${VESSEL_GLSL}
uniform float uTime;
uniform float uLevel;
attribute vec3 seed;
varying float vA;
void main() {
  float span = max(0.1, uLevel - ${BASE_Y.toFixed(3)});
  float y = ${BASE_Y.toFixed(3)} + mod(seed.x * span + uTime * (0.12 + seed.y * 0.25), span);
  float a = seed.z * 6.2831 + uTime * 0.2 * (seed.y - 0.5);
  float r = sqrt(seed.y) * (liquidR(y) - 0.06);
  vec3 p = vec3(cos(a) * r, y, sin(a) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (18.0 + seed.x * 26.0) / -mv.z;
  vA = smoothstep(uLevel, uLevel - 0.3, y) * (0.5 + 0.5 * sin(uTime * 2.0 + seed.z * 40.0));
}`;
const MOTE_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying float vA;
void main() {
  float a = texture2D(uMap, gl_PointCoord).r * vA;
  gl_FragColor = vec4(vec3(1.0, 0.92, 0.65) * a * 2.0, a);
  ${OUTPUT_CHUNKS}
}`;

interface Floater {
  sprite: THREE.Sprite;
  label: CanvasLabel;
  age: number;
}

export class Reservoir {
  readonly group = new THREE.Group();
  private level = BASE_Y + FILL_MIN * SPAN;
  private targetLevel = this.level;
  private slosh = 0;
  private dir = 0;
  private uniforms = {
    uTime: { value: 0 },
    uLevel: { value: this.level },
    uSlosh: { value: 0 },
    uDir: { value: 0 },
    uGlow: { value: 1.6 },
  };
  private pour: THREE.Mesh;
  private pourMat: THREE.ShaderMaterial;
  private pourLeft = 0;
  private pourTotal = 0;
  private pourWidth = 0.1;
  private splash: THREE.Mesh;
  private splashAge = 9;
  private floaters: Floater[] = [];
  private goalLabel = new CanvasLabel(512, 128);
  private light: THREE.PointLight;
  private ripples: Array<{ m: THREE.Mesh; age: number }> = [];
  private motesMat: THREE.ShaderMaterial;
  private idlers: Idlers;

  constructor(
    p: Palette,
    private lowPower: () => boolean,
  ) {
    const g = this.group;
    g.name = "reservoir";

    const b = new Batch();
    this.idlers = new Idlers(p);

    // --- plinth: brass foot, walnut step, a tufted leather drum with instruments, a brass cradle
    const lathe = (pts: number[][], segs = 64) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);
    b.put(lathe([[0, 0], [2.15, 0], [2.15, 0.1], [2.02, 0.14]]), p.brassDark);
    b.put(scaleUV(lathe([[2.02, 0.14], [1.98, 0.36], [1.9, 0.42], [1.74, 0.44]]), 12, 1), p.wood);
    b.put(scaleUV(lathe([[1.72, 0.44], [1.72, 0.84]]), 27, 1), p.leather);
    b.put(lathe([[1.76, 0.82], [1.76, 0.88], [1.5, 0.96], [1.44, 1.02], [vesselR(BASE_Y) + 0.1, 1.02], [vesselR(BASE_Y + 0.3) + 0.06, BASE_Y + 0.3], [vesselR(BASE_Y + 0.3) + 0.02, BASE_Y + 0.3]]), p.brass);
    for (const [r, y, w] of [
      [2.03, 0.14, 0.03],
      [1.75, 0.44, 0.028],
    ]) b.put(ringGeo(r, w), p.brass, [0, y, 0]);
    // instruments let into the leather, to the sides and behind (the lectern stands in front)
    for (const deg of [70, 180, 290]) {
      const a = THREE.MathUtils.degToRad(deg);
      const frame = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(0, 0.64, 1.72));
      instrumentCluster(b, this.idlers, p, frame, 0.6);
    }

    // --- the brass armature: six staves following the glass, a collar at the neck, a cap on the lip
    const staveR = 0.022;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 26; i++) {
        const y = BASE_Y + 0.28 + (i / 26) * (TOP_Y + 0.12 - BASE_Y - 0.28);
        const r = vesselR(y) + 0.035;
        pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
      }
      b.put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, staveR, 6, false), p.brass);
    }
    // the gauge: ticks every tenth of the way to the goal, on a brass rule standing in front
    for (let i = 1; i <= 10; i++) {
      const y = BASE_Y + (FILL_MIN + (FILL_GOAL - FILL_MIN) * (i / 10)) * SPAN;
      b.put(new THREE.BoxGeometry(i % 5 === 0 ? 0.2 : 0.1, 0.016, 0.016), p.brass, [0, y, vesselR(y) + 0.05]);
    }
    b.put(ringGeo(vesselR(GOAL_Y) + 0.05, 0.045), p.brass, [0, GOAL_Y - 0.08, 0]);
    b.put(ringGeo(vesselR(4.2) + 0.045, 0.03), p.brass, [0, 4.2, 0]);
    b.put(ringGeo(vesselR(2.2) + 0.045, 0.03), p.brass, [0, 2.2, 0]);
    const lipR = vesselR(TOP_Y);
    b.put(lathe([[lipR + 0.06, TOP_Y - 0.02], [lipR + 0.1, TOP_Y + 0.12], [lipR - 0.05, TOP_Y + 0.34], [0.72, TOP_Y + 0.62], [0.36, TOP_Y + 0.98], [0.2, TOP_Y + 1.3], [0.16, TOP_Y + 1.42], [0.26, TOP_Y + 1.46]], 48), p.brass);
    b.put(lathe([[0.1, TOP_Y - 0.1], [0.2, TOP_Y + 0.02], [lipR + 0.06, TOP_Y - 0.02]], 32), p.brassDark);
    b.put(ringGeo(0.74, 0.035), p.brass, [0, TOP_Y + 0.6, 0]);
    b.put(new THREE.SphereGeometry(0.1, 12, 10), p.warmGlow, [0, TOP_Y + 1.78, 0]);
    b.build(g, { cast: true });
    this.idlers.build();
    g.add(this.idlers.group);
    // a blown finial on the cap
    const finialGeo = blown(FORMS.gourd, { ribs: 10, ribDepth: 0.05, twist: 0.6, segments: 24 });
    const finial = new THREE.Mesh(finialGeo, p.glass.amber);
    finial.scale.setScalar(0.62);
    finial.position.y = TOP_Y + 1.44;
    g.add(finial);

    // --- the vessel
    const profile: Array<[number, number]> = [];
    for (let i = 0; i <= 44; i++) {
      const y = BASE_Y + 0.02 + (i / 44) * (TOP_Y - BASE_Y - 0.02);
      profile.push([vesselR(y), y]);
    }
    const vesselGeo = blown(profile, { rings: 56, segments: 64, ribs: 16, ribDepth: 0.008, twist: 1.5 });
    const cheap = p.glassLike("opal", { tint: 0xfff3e2, glow: 0.42, opacity: 0.02, density: 0.42, irid: 0.3, repeat: [1, 2], side: THREE.FrontSide });
    const glass = tiered(new THREE.Mesh(vesselGeo, cheap), cheap, () => {
      const m = p.hero("opal", 0.14);
      m.color.set(0xffffff);
      m.attenuationColor.set(0xfff2dc);
      m.attenuationDistance = 6;
      m.emissiveIntensity = 0.05;
      m.transmission = 0.96;
      // the liquid's motes and the pour are drawn after the glass, inside it
      m.depthWrite = false;
      return m;
    });
    glass.renderOrder = 4;
    glass.userData.lowOrder = 4;
    g.add(glass);

    // goal ring and its label, at the neck
    const goalRing = ring(vesselR(GOAL_Y) + 0.16, GOAL_Y, 0.028, p.goldGlow);
    g.add(goalRing);
    const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.goalLabel.texture, transparent: true, depthWrite: false, toneMapped: false }));
    gl.scale.set(1.3, 0.325, 1);
    gl.position.set(0, GOAL_Y + 0.3, vesselR(GOAL_Y) + 0.34);
    g.add(gl);

    // liquid
    const sideGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 36, true);
    sideGeo.translate(0, 0.5, 0);
    const side = new THREE.Mesh(sideGeo, new THREE.ShaderMaterial({ vertexShader: SIDE_VERT, fragmentShader: SIDE_FRAG, uniforms: this.uniforms }));
    side.frustumCulled = false;
    g.add(side);
    const surfGeo = new THREE.PlaneGeometry(RADIUS * 2.7, RADIUS * 2.7, 56, 56);
    surfGeo.rotateX(-Math.PI / 2);
    const surf = new THREE.Mesh(surfGeo, new THREE.ShaderMaterial({ vertexShader: SURF_VERT, fragmentShader: SURF_FRAG, uniforms: this.uniforms, side: THREE.DoubleSide }));
    surf.frustumCulled = false;
    g.add(surf);

    const count = 260;
    const seeds = new Float32Array(count * 3).map(() => Math.random());
    const mg = new THREE.BufferGeometry();
    mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    mg.setAttribute("seed", new THREE.BufferAttribute(seeds, 3));
    this.motesMat = additive(new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: { uTime: this.uniforms.uTime, uLevel: this.uniforms.uLevel, uMap: { value: p.dot } } }));
    const motes = new THREE.Points(mg, this.motesMat);
    motes.frustumCulled = false;
    motes.renderOrder = 3;
    g.add(motes);

    // pour stream and splash
    this.pourMat = additive(new THREE.ShaderMaterial({ vertexShader: POUR_VERT, fragmentShader: POUR_FRAG, uniforms: { uTime: this.uniforms.uTime, uAlpha: { value: 0 } } }));
    const pourGeo = new THREE.CylinderGeometry(1, 0.8, 1, 16, 1, true);
    pourGeo.translate(0, -0.5, 0);
    this.pour = new THREE.Mesh(pourGeo, this.pourMat);
    this.pour.position.y = 7.42;
    this.pour.visible = false;
    this.pour.renderOrder = 5;
    g.add(this.pour);
    this.splash = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 48), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.8, 0.4).multiplyScalar(2), toneMapped: false }), false));
    this.splash.rotation.x = Math.PI / 2;
    this.splash.visible = false;
    g.add(this.splash);

    this.light = new THREE.PointLight(0xffb84a, 10, 15, 1.6);
    this.light.position.set(0, 4, 0);
    g.add(this.light);

    this.drawGoal(150);
  }

  private drawGoal(goal: number) {
    this.goalLabel.draw((ctx, w, h) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 14;
      ctx.fillStyle = "#ffe7a8";
      ctx.font = `600 30px ${FONT_DISPLAY}`;
      ctx.fillText("GOAL", w / 2, h * 0.28);
      ctx.font = `700 52px ${FONT_DISPLAY}`;
      ctx.fillText(`${Math.round(goal).toLocaleString()}p`, w / 2, h * 0.68);
    });
  }

  setGoal(goal: GoalSnapshot) {
    this.targetLevel = BASE_Y + progressToFill(goal.progress, FILL_MIN, FILL_GOAL) * SPAN;
    this.drawGoal(goal.goal);
  }

  /** A sale: pour sized to the gain relative to the goal span, slosh, and a "+Np" floater. */
  surge(gain: number, goalSpan: number) {
    const plan = planSurge(gain, goalSpan, this.lowPower());
    this.pourTotal = this.pourLeft = plan.duration;
    this.pourWidth = clamp(0.05 + plan.particles / 3200, 0.06, 0.2);
    this.slosh = Math.min(0.16, this.slosh + plan.kick / 300);
    this.dir = Math.random() * Math.PI * 2;
    this.splashAge = 0;
    this.addFloater(`+${Math.round(gain).toLocaleString()}p`);
  }

  private addFloater(text: string) {
    const label = new CanvasLabel(512, 160);
    label.draw((ctx, w, h) => {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `700 96px ${FONT_DISPLAY}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = "rgba(20, 12, 2, 0.75)";
      ctx.strokeText(text, w / 2, h / 2);
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#fff1c4";
      ctx.fillText(text, w / 2, h / 2);
      ctx.strokeStyle = "rgba(42, 212, 230, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(w * 0.15, h * 0.88);
      ctx.lineTo(w * 0.85, h * 0.88);
      ctx.stroke();
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    sprite.scale.set(2.4, 0.75, 1);
    sprite.renderOrder = 40;
    sprite.position.set(0, 9.6, 0);
    this.group.add(sprite);
    this.floaters.push({ sprite, label, age: 0 });
  }

  get fillLevel() {
    return this.level;
  }

  update(dt: number, t: number) {
    this.uniforms.uTime.value = t;
    this.idlers.update(t);
    // the level rises faster while the pour runs
    this.level = easeLevel(this.level, this.targetLevel, dt, this.pourLeft > 0 ? 1.6 : 0.7);
    this.uniforms.uLevel.value = this.level;
    this.slosh *= Math.exp(-dt * 0.9);
    this.uniforms.uSlosh.value = this.slosh;
    this.uniforms.uDir.value = this.dir;
    const fill = (this.level - BASE_Y) / SPAN;
    this.uniforms.uGlow.value = 1.0 + fill * 0.3 + Math.sin(t * 1.3) * 0.03 + (this.pourLeft > 0 ? 0.15 : 0);
    this.light.position.y = Math.max(1.6, this.level - 0.6);
    this.light.intensity = 4 + fill * 5 + (this.pourLeft > 0 ? 4 : 0);

    if (this.pourLeft > 0) {
      this.pourLeft -= dt;
      const k = this.pourLeft / this.pourTotal;
      const fade = Math.min(1, (1 - k) * 6) * Math.min(1, k * 5);
      this.pour.visible = true;
      const len = Math.max(0.05, 7.42 - this.level);
      this.pour.scale.set(this.pourWidth * (0.7 + fade * 0.3), len, this.pourWidth * (0.7 + fade * 0.3));
      this.pourMat.uniforms.uAlpha.value = fade;
      // keep the surface stirred while it pours
      this.slosh = Math.max(this.slosh, 0.035 * fade);
      if (Math.random() < dt * 9) this.addRipple();
    } else this.pour.visible = false;

    if (this.splashAge < 1.2) {
      this.splashAge += dt;
      const s = 0.2 + this.splashAge * 0.9;
      this.splash.visible = true;
      this.splash.scale.setScalar(Math.min(s, vesselR(this.level) - WALL - 0.03));
      this.splash.position.y = this.level + 0.04;
      (this.splash.material as THREE.MeshBasicMaterial).opacity = 1 - this.splashAge / 1.2;
    } else this.splash.visible = false;

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      r.m.position.y = this.level + 0.03;
      r.m.scale.setScalar(Math.min(vesselR(this.level) - WALL - 0.03, 0.1 + r.age * 0.8));
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 - r.age * 0.6);
      if (r.age > 1.3) {
        r.m.removeFromParent();
        r.m.geometry.dispose();
        (r.m.material as THREE.Material).dispose();
        this.ripples.splice(i, 1);
      }
    }

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      f.sprite.position.y = 9.6 + f.age * 0.4;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, f.age * 3) * Math.max(0, 1 - (f.age - 2.2) / 1.2);
      if (f.age > 3.4) {
        f.sprite.removeFromParent();
        (f.sprite.material as THREE.Material).dispose();
        f.label.dispose();
        this.floaters.splice(i, 1);
      }
    }
  }

  private addRipple() {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 40), additive(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5).multiplyScalar(1.6), toneMapped: false }), false));
    m.rotation.x = Math.PI / 2;
    this.group.add(m);
    this.ripples.push({ m, age: 0 });
  }

  dispose() {
    this.goalLabel.dispose();
    for (const f of this.floaters) f.label.dispose();
  }
}

function ringGeo(r: number, w: number) {
  const g = new THREE.TorusGeometry(r, w, 8, 72);
  g.rotateX(Math.PI / 2);
  return g;
}

function ring(r: number, y: number, w: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 72), mat);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}
