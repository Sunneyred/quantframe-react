import * as THREE from "three";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";

/**
 * Post passes of the HIGH tier that are ours (bloom and output are three's):
 *
 *  - DOF: depth of field while docked to a screen. Sixteen taps on a golden-angle disc, radius from
 *    the circle of confusion of each pixel's own depth. The DOM screen shows through pixels whose
 *    alpha is 0 (the "hole" quads): those are never blurred, never sampled, and every pixel keeps
 *    its own alpha, so the docked screen and its edge stay pin sharp while the room melts away.
 *  - FINISH: restores the scene's alpha after bloom and tone mapping (bloom alone never hides a
 *    screen) and adds a faint vignette on the world only.
 */

export const DOF = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.05 },
    uFar: { value: 1200 },
    /** View distance that is sharp, the half depth of the sharp slab, and the distance over which blur grows. */
    uFocus: { value: 2 },
    uDead: { value: 0.35 },
    uRange: { value: 5 },
    /** Largest blur radius in pixels, already multiplied by the dock blend. */
    uRadius: { value: 0 },
  },
  vertexShader: CopyShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uTexel;
    uniform float uNear;
    uniform float uFar;
    uniform float uFocus;
    uniform float uDead;
    uniform float uRange;
    uniform float uRadius;
    varying vec2 vUv;
    float dist(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }
    float coc(float z) { return clamp((abs(z - uFocus) - uDead) / uRange, 0.0, 1.0); }
    void main() {
      vec4 c0 = texture2D(tDiffuse, vUv);
      float own = coc(dist(vUv)) * step(0.5, c0.a);
      if (own * uRadius < 0.6) { gl_FragColor = c0; return; }
      vec3 acc = c0.rgb;
      float w = 1.0;
      float rad = own * uRadius;
      for (int i = 1; i <= 16; i++) {
        float fi = float(i);
        float r = sqrt(fi / 16.0) * rad;
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
        vec4 s = texture2D(tDiffuse, uv);
        // sharp neighbours (the screen's bezel) and the screen itself do not smear outwards
        float sw = step(0.5, s.a) * smoothstep(0.0, 0.25, coc(dist(uv)));
        acc += s.rgb * sw;
        w += sw;
      }
      gl_FragColor = vec4(acc / w, c0.a);
    }`,
};

export const FINISH = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, tBase: { value: null as THREE.Texture | null }, uVignette: { value: 0.32 } },
  vertexShader: CopyShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tBase;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float a = clamp(texture2D(tBase, vUv).a, 0.0, 1.0);
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * smoothstep(0.25, 0.95, dot(d, d) * 2.4);
      // where a screen shows through (a = 0) let only a little bloom spill over it, premultiplied
      gl_FragColor = vec4(c.rgb * mix(0.3, vig, a), a);
    }`,
};
