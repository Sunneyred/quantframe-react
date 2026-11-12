import * as THREE from "three";
import { cheapGlass, glassPattern, heroGlass, type GlassOptions, type GlassPatternName, type GlassShared } from "./glass";
import { additive } from "./kit";
import { brassBand, brassWorn, CANDY, enamelPanel, instrumentFace, leatherTufted, loungeEnvironment, loungeFloor, tapeReel, wallShade, walnut } from "./surfaces";
import { glowDot, softShadow } from "./textures";

export type EnamelName = "teal" | "tangerine" | "mustard" | "raspberry" | "cream" | "plum" | "navy";
export type GlassName = "amber" | "teal" | "rose" | "cobalt" | "clear" | "murrine" | "opal";

const GLASS: Record<GlassName, Omit<GlassOptions, "pattern"> & { pattern: GlassPatternName }> = {
  amber: { pattern: "swirl", tint: 0xffb24a, glow: 1.5, opacity: 0.18, irid: 0.15 },
  teal: { pattern: "swirl", tint: 0x35d6c8, glow: 1.25, opacity: 0.18, irid: 0.2 },
  rose: { pattern: "swirl", tint: 0xff6f96, glow: 1.3, opacity: 0.18, irid: 0.2 },
  cobalt: { pattern: "swirl", tint: 0x5a86ff, glow: 1.15, opacity: 0.2, irid: 0.45 },
  clear: { pattern: "dichroic", tint: 0xe6f1ff, glow: 0.3, opacity: 0.06, irid: 0.6 },
  murrine: { pattern: "millefiori", tint: 0xfff2dc, glow: 1.25, opacity: 0.3, irid: 0.1, repeat: [2, 1] },
  opal: { pattern: "swirl", tint: 0xfff0d6, glow: 1.7, opacity: 0.5, irid: 0.35 },
};

/**
 * The shared material set of one engine instance. Everything here is disposed with the scene.
 *
 * The look: worn brass, chrome, tufted oxblood leather, walnut, bakelite, candy enamel panels and
 * art glass. The first block keeps the names the first rooms were written against, pointing at
 * the new materials: `gold` is the worn brass, `pearl` a cream enamel panel, `ivory` walnut,
 * `steel` bakelite, `filigree` the riveted brass band.
 */
export class Palette {
  // --- legacy names (aliases into the kit below)
  readonly pearl: THREE.MeshStandardMaterial;
  readonly pearlPlain: THREE.MeshStandardMaterial;
  readonly ivory: THREE.MeshStandardMaterial;
  readonly gold: THREE.MeshStandardMaterial;
  readonly goldDark: THREE.MeshStandardMaterial;
  readonly filigree: THREE.MeshStandardMaterial;
  readonly floor: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly undersuit: THREE.MeshStandardMaterial;
  readonly cyanGlow: THREE.MeshBasicMaterial;
  readonly goldGlow: THREE.MeshBasicMaterial;
  readonly holo: THREE.MeshBasicMaterial;
  readonly shadow: THREE.MeshBasicMaterial;
  readonly dot: THREE.Texture;
  /** Wall tiles: 1 texture repeat per 2 m. */
  readonly tile = 0.5;

  // --- the kit
  /** Worn brass with patina (the ancient-gold thread). */
  readonly brass: THREE.MeshStandardMaterial;
  readonly brassDark: THREE.MeshStandardMaterial;
  readonly chrome: THREE.MeshStandardMaterial;
  /** Tufted leather; 1 texture repeat = 0.5 m when UVs are in metres times `leatherTile`. */
  readonly leather: THREE.MeshStandardMaterial;
  readonly leatherTan: THREE.MeshStandardMaterial;
  /** The padded ceiling: the same tufting in dark plum velvet. */
  readonly quilt: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly bakelite: THREE.MeshStandardMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  /** Chipped enamel wall panels (world UVs, 2 m tiles) in the candy colours. */
  readonly enamel: Record<EnamelName, THREE.MeshStandardMaterial>;
  /** Smooth enamel without the panel texture, for furniture and figures. */
  readonly paint: Record<EnamelName, THREE.MeshStandardMaterial>;
  /** The cheap art glass, one material per colour. */
  readonly glass: Record<GlassName, THREE.ShaderMaterial>;
  /** Instrument cluster face (see props.ts) and the tape reel. */
  readonly instrument: THREE.MeshStandardMaterial;
  readonly reel: THREE.MeshStandardMaterial;
  readonly needle: THREE.MeshBasicMaterial;
  readonly warmGlow: THREE.MeshBasicMaterial;
  /** A multiply-style shade strip for the foot and the head of the walls. */
  readonly wallShade: THREE.MeshBasicMaterial;
  /** The painted environment (equirect), sampled by the glass and baked into the scene's PMREM. */
  readonly env: THREE.CanvasTexture;
  readonly leatherTile = 2;

  private glassShared: GlassShared;
  private patterns: Record<GlassPatternName, THREE.CanvasTexture>;
  private textures: THREE.Texture[] = [];

  constructor(floorRadius: number) {
    const panel = enamelPanel();
    const brass = brassWorn();
    const band = brassBand();
    const hide = leatherTufted();
    const wood = walnut();
    const fl = loungeFloor(floorRadius);
    const inst = instrumentFace(1);
    const reel = tapeReel();
    this.env = loungeEnvironment();
    this.env.generateMipmaps = false;
    this.env.minFilter = THREE.LinearFilter;
    this.patterns = { swirl: glassPattern("swirl", 5), millefiori: glassPattern("millefiori", 9), dichroic: glassPattern("dichroic", 13) };
    this.glassShared = { uTime: { value: 0 }, uEnv: { value: this.env } };
    this.textures.push(this.env, ...Object.values(this.patterns));

    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
    this.brass = std({ map: brass.map, roughnessMap: brass.mr, metalnessMap: brass.mr, roughness: 1, metalness: 1, emissive: 0x2a1a04, emissiveIntensity: 0.6, envMapIntensity: 1.5 });
    this.brassDark = std({ map: brass.map, roughnessMap: brass.mr, metalnessMap: brass.mr, color: 0x9a7c50, roughness: 1, metalness: 1, envMapIntensity: 1.2 });
    this.chrome = std({ color: 0xe8edf2, roughness: 0.08, metalness: 1, envMapIntensity: 1.8 });
    const leather = (color: number, rough = 1) =>
      std({ map: hide.map, roughnessMap: hide.mr, metalnessMap: hide.mr, normalMap: hide.normal, normalScale: new THREE.Vector2(1.5, 1.5), color, roughness: rough, metalness: 1, envMapIntensity: 0.9 });
    this.leather = leather(CANDY.oxblood);
    this.leatherTan = leather(CANDY.cognac);
    this.quilt = leather(0x5a2a5c);
    this.quilt.side = THREE.BackSide;
    this.wood = std({ map: wood.map, roughnessMap: wood.mr, roughness: 1, metalness: 0, envMapIntensity: 0.8 });
    this.bakelite = std({ color: 0x24150f, roughness: 0.24, metalness: 0.1, envMapIntensity: 1.3 });
    this.rubber = std({ color: 0x1d262c, roughness: 0.7, metalness: 0 });
    const enamel = (color: number) => std({ map: panel.map, roughnessMap: panel.mr, metalnessMap: panel.mr, color, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
    const paint = (color: number) => std({ color, roughness: 0.3, metalness: 0.02, envMapIntensity: 1.0 });
    const hues: Record<EnamelName, number> = { teal: CANDY.teal, tangerine: CANDY.tangerine, mustard: CANDY.mustard, raspberry: CANDY.raspberry, cream: CANDY.cream, plum: 0x4a2450, navy: 0x1c3260 };
    this.enamel = Object.fromEntries(Object.entries(hues).map(([k, v]) => [k, enamel(v)])) as Record<EnamelName, THREE.MeshStandardMaterial>;
    this.paint = Object.fromEntries(Object.entries(hues).map(([k, v]) => [k, paint(v)])) as Record<EnamelName, THREE.MeshStandardMaterial>;
    this.glass = Object.fromEntries(Object.entries(GLASS).map(([k, o]) => [k, cheapGlass(this.glassShared, { ...o, pattern: this.patterns[o.pattern] })])) as Record<GlassName, THREE.ShaderMaterial>;
    this.instrument = std({ map: inst.map, emissiveMap: inst.glow, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.1 });
    this.reel = std({ map: reel, roughness: 0.3, metalness: 0.6, alphaTest: 0.5 });
    this.needle = new THREE.MeshBasicMaterial({ color: 0xd8321e });
    this.warmGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc980).multiplyScalar(2.2), toneMapped: false });
    this.wallShade = new THREE.MeshBasicMaterial({ map: wallShade(), color: 0x0a0408, transparent: true, depthWrite: false });
    this.wallShade.alphaMap = this.wallShade.map;

    // legacy names
    this.gold = this.brass;
    this.goldDark = this.brassDark;
    this.pearl = this.enamel.cream;
    this.pearlPlain = this.paint.cream;
    this.ivory = this.wood;
    this.steel = this.bakelite;
    this.filigree = std({ map: band.map, roughnessMap: band.mr, metalnessMap: band.mr, roughness: 1, metalness: 1, emissive: 0x1a1204, envMapIntensity: 1.4 });
    this.floor = std({ map: fl.map, roughnessMap: fl.mr, metalnessMap: fl.mr, roughness: 1, metalness: 1, envMapIntensity: 0.9 });
    this.undersuit = std({ color: 0x2a2530, roughness: 0.7, metalness: 0.1 });
    this.cyanGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35d6c8).multiplyScalar(2.0), toneMapped: false });
    this.goldGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc56a).multiplyScalar(2.4), toneMapped: false });
    this.holo = additive(new THREE.MeshBasicMaterial({ color: 0x35d6c8, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false }), false);
    this.shadow = new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.9 });
    this.shadow.alphaMap = this.shadow.map;
    this.dot = glowDot();
  }

  /** The show-piece version of a glass colour (transmission): made per call, HIGH only. */
  hero(name: GlassName, thickness = 0.3): THREE.MeshPhysicalMaterial {
    const o = GLASS[name];
    const map = this.patterns[o.pattern];
    return heroGlass({ ...o, pattern: map, thickness });
  }

  /** A cheap glass with its own settings (shares the patterns, the environment and the clock). */
  glassLike(name: GlassName, over: Partial<GlassOptions>): THREE.ShaderMaterial {
    const o = GLASS[name];
    return cheapGlass(this.glassShared, { ...o, pattern: this.patterns[o.pattern], ...over });
  }

  /** Per frame: the glass's clock. */
  update(t: number) {
    this.glassShared.uTime.value = t;
  }

  /** A contact shadow decal on the floor. */
  shadowDecal(w: number, d = w): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.shadow);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = -1;
    return m;
  }

  /** Every material of the palette (for disposal), and the textures only the palette holds. */
  all(): THREE.Material[] {
    const out = new Set<THREE.Material>();
    for (const v of Object.values(this)) {
      if (v instanceof THREE.Material) out.add(v);
      else if (v && typeof v === "object" && !(v instanceof THREE.Texture)) for (const w of Object.values(v as object)) if (w instanceof THREE.Material) out.add(w);
    }
    return [...out];
  }
  ownTextures(): THREE.Texture[] {
    return [...this.textures, this.dot];
  }
}
