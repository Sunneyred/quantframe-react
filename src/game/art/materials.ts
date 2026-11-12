import * as THREE from "three";
import { additive } from "./kit";
import { filigreeBand, glowDot, pearlPanel, softShadow, vaultFloor } from "./textures";

/** The shared material set of one engine instance. Everything here is disposed with the scene. */
export class Palette {
  readonly pearl: THREE.MeshPhysicalMaterial;
  readonly pearlPlain: THREE.MeshPhysicalMaterial;
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

  constructor(floorRadius: number) {
    const panel = pearlPanel();
    const fil = filigreeBand();
    const fl = vaultFloor(floorRadius);
    this.pearl = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: panel.map,
      roughnessMap: panel.mr,
      metalnessMap: panel.mr,
      roughness: 1,
      metalness: 1,
      iridescence: 0.45,
      iridescenceIOR: 1.35,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    });
    this.pearlPlain = new THREE.MeshPhysicalMaterial({
      color: 0xebe5d8,
      roughness: 0.32,
      metalness: 0.05,
      iridescence: 0.5,
      iridescenceIOR: 1.35,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
    });
    this.ivory = new THREE.MeshStandardMaterial({ color: 0xe4dac4, roughness: 0.48, metalness: 0.02 });
    this.gold = new THREE.MeshStandardMaterial({ color: 0xe8c15a, roughness: 0.26, metalness: 1, emissive: 0x2a1c04, emissiveIntensity: 1 });
    this.goldDark = new THREE.MeshStandardMaterial({ color: 0x9a7a34, roughness: 0.4, metalness: 1 });
    this.filigree = new THREE.MeshStandardMaterial({ map: fil.map, roughnessMap: fil.mr, metalnessMap: fil.mr, roughness: 1, metalness: 1, emissive: 0x1a1204 });
    this.floor = new THREE.MeshStandardMaterial({ map: fl.map, roughnessMap: fl.mr, metalnessMap: fl.mr, roughness: 1, metalness: 1, envMapIntensity: 1.0 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x1b1e2c, roughness: 0.35, metalness: 0.85 });
    this.undersuit = new THREE.MeshStandardMaterial({ color: 0x23273a, roughness: 0.62, metalness: 0.35 });
    this.cyanGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2ad4e6).multiplyScalar(2.2), toneMapped: false });
    this.goldGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd27a).multiplyScalar(2.4), toneMapped: false });
    this.holo = additive(new THREE.MeshBasicMaterial({ color: 0x2ad4e6, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false }), false);
    this.shadow = new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.9 });
    this.shadow.alphaMap = this.shadow.map;
    this.dot = glowDot();
  }

  /** A contact shadow decal on the floor. */
  shadowDecal(w: number, d = w): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.shadow);
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.012;
    m.renderOrder = -1;
    return m;
  }
}
