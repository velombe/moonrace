import * as THREE from "three";
import { rocketPaintTexture } from "./textures";

function additive(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

/**
 * Layer for the rocket's own hull and plume. Outside cameras enable it; the
 * cabin camera sits inside the hull and leaves it off.
 */
export const EXTERIOR_LAYER = 1;

/** Saturn-style rocket pointing down -Z, with a layered exhaust plume. */
export function createRocket(glowTexture: THREE.Texture) {
  const ship = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = -Math.PI / 2;
  model.scale.setScalar(0.72);
  ship.add(model);

  const profile = [new THREE.Vector2(0, -1.8)];
  for (let i = 0; i <= 48; i++) {
    const y = -1.8 + (i / 48) * 5.2;
    let r: number;
    if (y < 1.2) r = 0.55;
    else if (y < 1.6) r = 0.55 - (0.1 * (y - 1.2)) / 0.4;
    else if (y < 2.3) r = 0.45;
    else {
      const t = (y - 2.3) / 1.1;
      r = 0.45 * Math.pow(Math.max(0, 1 - t * t), 0.62) + 0.004;
    }
    profile.push(new THREE.Vector2(r, y));
  }
  model.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), new THREE.MeshStandardMaterial({ map: rocketPaintTexture(), roughness: 0.42, metalness: 0.15 })));

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.05, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0xc9372c, roughness: 0.6 }));
  tower.position.y = 3.7;
  model.add(tower);

  const bellProfile = [new THREE.Vector2(0.09, 0), new THREE.Vector2(0.1, -0.08), new THREE.Vector2(0.14, -0.22), new THREE.Vector2(0.21, -0.46)];
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  const bellGeo = new THREE.LatheGeometry(bellProfile, 20);
  for (const [x, z] of [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
    const b = new THREE.Mesh(bellGeo, bellMat);
    b.position.set(x, -1.8, z);
    model.add(b);
  }

  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.55, -0.45); fin.lineTo(0.6, -1.0); fin.lineTo(0, -0.7); fin.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false });
  finGeo.translate(0, 0, -0.025);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    const f = new THREE.Mesh(finGeo, finMat);
    f.position.set(0.52, -1.0, 0);
    g.add(f);
    model.add(g);
  }

  const flames = new THREE.Group();
  flames.position.y = -2.25;
  model.add(flames);
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.62, 3.4, 20, 1, true), additive(0xff6a1a, 0.35));
  outer.rotation.x = Math.PI; outer.position.y = -1.7;
  const mid = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.4, 20, 1, true), additive(0xffb04a, 0.6));
  mid.rotation.x = Math.PI; mid.position.y = -1.2;
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.3, 16), additive(0xfff4dc, 0.95));
  core.rotation.x = Math.PI; core.position.y = -0.65;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffa050, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.setScalar(4.5);
  glow.position.y = -0.4;
  flames.add(outer, mid, core, glow);

  model.traverse((o) => o.layers.set(EXTERIOR_LAYER));

  const engineLight = new THREE.PointLight(0xff9a40, 2.2 * Math.PI, 14, 2);
  engineLight.position.set(0, 0, 2.2);
  ship.add(engineLight);

  return {
    ship,
    setThrust(thrust: number, visible: boolean) {
      const f = 0.85 + Math.random() * 0.3;
      flames.scale.set(f, f * thrust, f);
      flames.visible = visible;
      engineLight.intensity = visible ? (1.6 * thrust + Math.random() * 0.6) * Math.PI : 0;
    },
  };
}
