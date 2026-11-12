import { stored, store } from "./events";

export type Quality = "low" | "high";
const KEY = "vt_game_quality";

/** A quick guess from the GPU's name: software renderers and older integrated parts start on low. */
export function guessQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): Quality {
  try {
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    if (/swiftshader|llvmpipe|software|softpipe|microsoft basic|mesa offscreen/.test(name)) return "low";
    if (/intel.*(hd|uhd) graphics [0-9]{3}\b|mali-[gt][0-9]{2}\b|adreno.*[1-5][0-9]{2}\b|powervr/.test(name)) return "low";
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (maxTex < 8192) return "low";
    return "high";
  } catch {
    return "high";
  }
}

export function storedQuality(): Quality | null {
  const v = stored(KEY);
  return v === "low" || v === "high" ? v : null;
}

export function saveQuality(q: Quality) {
  store(KEY, q);
}
