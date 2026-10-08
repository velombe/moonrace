import * as THREE from "three";
import { engineBellTexture, rocketBumpTexture, rocketPaintTexture } from "./textures";

function additive(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

/**
 * Layer for the rocket's own hull and plume. Outside cameras enable it; the
 * cabin camera sits inside the hull and leaves it off.
 */
export const EXTERIOR_LAYER = 1;

/**
 * Hull radius at height y (model units, -1.8 at the engines to 3.4 at the capsule tip):
 * first stage, taper to the upper stages, then the Apollo stack: spacecraft adapter
 * (a cone), service module (a short cylinder), command module (a blunt cone).
 */
function hullRadius(y: number) {
  if (y < 1.2) return 0.55;
  if (y < 1.6) return 0.55 - (0.1 * (y - 1.2)) / 0.4;
  if (y < 2.4) return 0.45;
  if (y < 2.8) return 0.45 - (0.14 * (y - 2.4)) / 0.4; // adapter
  if (y < 3.02) return 0.31; // service module
  if (y < 3.36) {
    const t = (y - 3.02) / 0.34; // command module: a straight, steep cone like Apollo's
    return 0.31 * (1 - t) + 0.05 * t + 0.006 * Math.sin(Math.PI * t);
  }
  return Math.max(0.004, 0.05 * (1 - (y - 3.36) / 0.04));
}

/** Launch escape system: red lattice tower on the capsule, white escape motor, pointed tip. */
function escapeTower() {
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xc9372c, roughness: 0.55, metalness: 0.2 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f1f3, roughness: 0.45, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.5, metalness: 0.3 });
  const base = 3.33, top = 3.64, rb = 0.052, rt = 0.036;
  // Four legs leaning in, with two bracing rings and diagonals: reads as a lattice from afar.
  const leg = new THREE.CylinderGeometry(0.009, 0.009, 1, 5);
  const corners = [0, 1, 2, 3].map((i) => (i * Math.PI) / 2 + Math.PI / 4);
  const at = (a: number, r: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  const strut = (p: THREE.Vector3, q: THREE.Vector3) => {
    const m = new THREE.Mesh(leg, red);
    m.position.copy(p).add(q).multiplyScalar(0.5);
    m.scale.y = p.distanceTo(q);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize());
    g.add(m);
  };
  corners.forEach((a, i) => {
    strut(at(a, rb, base), at(a, rt, top));
    const b = corners[(i + 1) % 4];
    strut(at(a, rb, base), at(b, (rb + rt) / 2, (base + top) / 2)); // diagonal brace
  });
  for (const [y, r] of [[base + 0.12, rb - 0.006], [top - 0.01, rt + 0.002]] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.007, 4, 16), red);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  // Escape motor with its angled nozzles at the bottom, then the canard section and tip.
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.3, 16), white);
  motor.position.y = top + 0.15;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.036, 0.04, 16), dark);
  skirt.position.y = top + 0.0;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 16), red);
  band.position.y = top + 0.27;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.046, 0.16, 16), red);
  nose.position.y = top + 0.38;
  g.add(motor, skirt, band, nose);
  return g;
}

/** Saturn-style rocket pointing down -Z, with a layered exhaust plume. */
export function createRocket(glowTexture: THREE.Texture) {
  const ship = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = -Math.PI / 2;
  model.scale.setScalar(0.72);
  ship.add(model);

  // Hull profile, bottom to top. Evenly spaced in y so the paint texture's v = (y + 1.8) / 5.2
  // (see rocketPaintTexture, which paints the seams and modules at matching heights).
  const profile = [new THREE.Vector2(0, -1.8)];
  const STEPS = 130;
  for (let i = 0; i <= STEPS; i++) {
    const y = -1.8 + (i / STEPS) * 5.2;
    profile.push(new THREE.Vector2(hullRadius(y), y));
  }
  const hull = new THREE.LatheGeometry(profile, 56);
  // Paint by height, exactly (the lathe would spread v over profile points, including the bottom cap).
  const pos = hull.attributes.position, uv = hull.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) + 1.8) / 5.2);
  const bump = rocketBumpTexture();
  model.add(new THREE.Mesh(hull, new THREE.MeshStandardMaterial({ map: rocketPaintTexture(), bumpMap: bump, bumpScale: 0.6, roughness: 0.42, metalness: 0.15 })));
  model.add(escapeTower());

  // Five F-1 style engines: bell-shaped nozzles with cooling-tube texture, on a heat shield.
  const bellProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    bellProfile.push(new THREE.Vector2(0.1 + 0.14 * Math.pow(t, 1.6), -0.52 * t));
  }
  const bellMat = new THREE.MeshStandardMaterial({ map: engineBellTexture(), color: 0xffffff, metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide });
  const bellGeo = new THREE.LatheGeometry(bellProfile, 24);
  const throat = new THREE.CylinderGeometry(0.075, 0.1, 0.12, 12);
  const pumpMat = new THREE.MeshStandardMaterial({ color: 0x5b5f68, metalness: 0.5, roughness: 0.45 });
  for (const [x, z] of [[0, 0], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
    const b = new THREE.Mesh(bellGeo, bellMat);
    b.position.set(x, -1.86, z);
    const t = new THREE.Mesh(throat, pumpMat);
    t.position.set(x, -1.82, z);
    model.add(b, t);
  }
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.53, 0.08, 40), new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.7, metalness: 0.2 }));
  shield.position.y = -1.82;
  model.add(shield);
  // Engine fairings: conical housings over the outer engines, carrying the fins.
  const fairingGeo = new THREE.ConeGeometry(0.17, 0.75, 16, 1, false);
  const fairingMat = new THREE.MeshStandardMaterial({ color: 0xeceef1, roughness: 0.45, metalness: 0.12 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const f = new THREE.Mesh(fairingGeo, fairingMat);
    f.position.set(Math.cos(a) * 0.5, -1.47, Math.sin(a) * 0.5);
    model.add(f);
  }

  // Fins: swept trapezoids with bevelled edges, rooted on the fairings.
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.5, -0.42); fin.lineTo(0.56, -0.98); fin.lineTo(0, -0.72); fin.lineTo(0, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  finGeo.translate(0, 0, -0.015);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.5, metalness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
    const f = new THREE.Mesh(finGeo, finMat);
    f.position.set(0.6, -1.02, 0);
    g.add(f);
    model.add(g);
  }

  const flames = new THREE.Group();
  flames.position.y = -2.34; // just inside the bells
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
