import * as THREE from "three";

/**
 * The image-based light of the ship: a small generated scene (the painted lounge on a sphere, plus
 * HDR emitters where the lamps and the glass are) baked through PMREM. It gives the brass, chrome
 * and glass something rich to reflect, and it is the ambient light: soft, warm from the chandelier
 * above, candy-coloured from the walls, with the rug's bounce from below, so no surface is flat.
 */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, painting: THREE.Texture): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene();
  const owned: Array<{ dispose(): void }> = [];
  const add = (geo: THREE.BufferGeometry, color: THREE.Color, at: THREE.Vector3, scale: THREE.Vector3 | number = 1) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    if (typeof scale === "number") m.scale.setScalar(scale);
    else m.scale.copy(scale);
    scene.add(m);
    owned.push(mat);
    return m;
  };
  const domeGeo = new THREE.SphereGeometry(30, 48, 24);
  const domeMat = new THREE.MeshBasicMaterial({ map: painting, side: THREE.BackSide });
  scene.add(new THREE.Mesh(domeGeo, domeMat));
  const ball = new THREE.SphereGeometry(1, 16, 12);
  owned.push(domeGeo, domeMat, ball);
  const hdr = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);
  // the chandelier's corona: a ring of small, very bright shades in the glass colours
  const shades = [0xffc070, 0x5fe6d8, 0xffe6bc, 0xff7fa0];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    add(ball, hdr(shades[k % 4], 16), new THREE.Vector3(Math.cos(a) * 9, 13, Math.sin(a) * 9), 0.8);
  }
  add(ball, hdr(0xffe2b0, 5), new THREE.Vector3(0, 24, 0), new THREE.Vector3(5, 1, 5));
  // sconces round the walls, a little above eye level
  for (let k = 0; k < 12; k++) {
    const a = ((k + 0.5) / 12) * Math.PI * 2;
    add(ball, hdr(k % 3 === 0 ? 0xff9a5a : 0xffd08a, 9), new THREE.Vector3(Math.cos(a) * 22, 3.5, Math.sin(a) * 22), 0.9);
  }
  // two tall strips of coloured glass (windows' lunettes), so chrome picks up candy streaks
  add(ball, hdr(0x6a4cff, 4), new THREE.Vector3(-24, 6, 8), new THREE.Vector3(1.2, 5, 3));
  add(ball, hdr(0x18c8b8, 4), new THREE.Vector3(20, 5, -16), new THREE.Vector3(1.2, 4, 3));
  add(ball, hdr(0xff5a8a, 3), new THREE.Vector3(6, 7, 25), new THREE.Vector3(3, 4, 1.2));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  for (const o of owned) o.dispose();
  return rt;
}
