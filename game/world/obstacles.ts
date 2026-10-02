import * as THREE from "three";
import { fbm } from "../noise";
import type { Rng } from "../rng";
import { bumpNoiseTexture, cloudPuffTexture, solarPanelTexture } from "./textures";

export type ObstacleType = "balloon" | "satellite" | "junk" | "asteroid" | "fuel";

export interface WorldObject {
  mesh: THREE.Object3D;
  radius: number;
  type: ObstacleType;
  spin: THREE.Vector3;
  passed: boolean;
}

export const LANE_X = 13;
export const LANE_Y = 7.5;

export class ObjectFactory {
  private geo;
  private mat;
  private rocks: THREE.BufferGeometry[] = [];
  private cloudMap = cloudPuffTexture();

  constructor() {
    const bump = bumpNoiseTexture();
    this.geo = {
      balloon: new THREE.SphereGeometry(1.6, 24, 18),
      tether: new THREE.CylinderGeometry(0.02, 0.02, 2.2, 4),
      payload: new THREE.BoxGeometry(0.5, 0.5, 0.5),
      satBody: new THREE.BoxGeometry(1.3, 1.3, 1.8),
      panel: new THREE.BoxGeometry(3.4, 0.05, 1.3),
      boom: new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
      dish: new THREE.SphereGeometry(0.6, 20, 10, 0, Math.PI * 2, 0, 1.1),
      junk: new THREE.TetrahedronGeometry(1, 0),
      fuel: new THREE.CylinderGeometry(0.5, 0.5, 1.4, 20),
      cap: new THREE.CylinderGeometry(0.28, 0.28, 0.3, 16),
      ring: new THREE.TorusGeometry(1.5, 0.05, 8, 48),
    };
    this.mat = {
      balloon: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35 }),
      tether: new THREE.MeshBasicMaterial({ color: 0x555555 }),
      payload: new THREE.MeshStandardMaterial({ color: 0xff7a2a, roughness: 0.6 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd6a743, metalness: 0.45, roughness: 0.3, bumpMap: bump, bumpScale: 0.04 }),
      panel: new THREE.MeshStandardMaterial({ map: solarPanelTexture(), metalness: 0.3, roughness: 0.35, emissive: 0x061433 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8eaef, roughness: 0.4, side: THREE.DoubleSide }),
      junk: new THREE.MeshStandardMaterial({ color: 0x9097a3, metalness: 0.4, roughness: 0.45, flatShading: true }),
      rock: new THREE.MeshStandardMaterial({ color: 0x6e665e, roughness: 0.95, bumpMap: bump, bumpScale: 0.25 }),
      fuel: new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a10, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.3 }),
      cap: new THREE.MeshStandardMaterial({ color: 0xe8eaef, roughness: 0.3 }),
      ring: new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }),
    };
    for (let k = 0; k < 4; k++) {
      const g = new THREE.IcosahedronGeometry(1, 2), p = g.attributes.position, s = k * 17 + 3;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        v.multiplyScalar(0.7 + 0.6 * fbm(v.x * 1.3 + s, v.y * 1.3 + s, v.z * 1.3 + s, s, 3));
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      this.rocks.push(g);
    }
  }

  private place(obj: THREE.Object3D, z: number, rng: Rng, ship: THREE.Vector3) {
    const aim = rng.next() < 0.42;
    const clamp = THREE.MathUtils.clamp;
    obj.position.set(
      aim ? clamp(ship.x + rng.range(-3, 3), -LANE_X, LANE_X) : rng.range(-LANE_X * 1.25, LANE_X * 1.25),
      aim ? clamp(ship.y + rng.range(-2, 2), -LANE_Y, LANE_Y) : rng.range(-LANE_Y * 1.25, LANE_Y * 1.25),
      z,
    );
  }

  obstacle(km: number, z: number, rng: Rng, ship: THREE.Vector3): WorldObject {
    const { geo, mat } = this;
    const g = new THREE.Group();
    const spin = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1));
    let type: ObstacleType, radius: number;
    if (km < 100) {
      type = "balloon";
      const b = new THREE.Mesh(geo.balloon, mat.balloon); b.scale.set(1, 1.15, 1); b.position.y = 0.6;
      const t = new THREE.Mesh(geo.tether, mat.tether); t.position.y = -2;
      const p = new THREE.Mesh(geo.payload, mat.payload); p.position.y = -3.1;
      g.add(b, t, p);
      radius = 1.75;
      spin.set(0, 0.3, 0);
    } else if (km < 60000) {
      if (rng.next() < 0.55) {
        type = "satellite";
        g.add(new THREE.Mesh(geo.satBody, mat.gold));
        for (const s of [-1, 1]) {
          const boom = new THREE.Mesh(geo.boom, mat.white); boom.rotation.z = Math.PI / 2; boom.position.x = s * 1.2;
          const panel = new THREE.Mesh(geo.panel, mat.panel); panel.position.x = s * 3.4;
          g.add(boom, panel);
        }
        const dish = new THREE.Mesh(geo.dish, mat.white); dish.rotation.x = Math.PI / 2; dish.position.z = 1.2;
        g.add(dish);
        radius = 2.2;
        spin.multiplyScalar(0.5);
      } else {
        type = "junk";
        const s = rng.range(0.7, 1.4);
        const j = new THREE.Mesh(geo.junk, mat.junk); j.scale.set(s, s * rng.range(0.3, 1), s * rng.range(0.6, 1.3));
        g.add(j);
        radius = s * 0.95;
        spin.multiplyScalar(2.2);
      }
    } else {
      type = "asteroid";
      const s = rng.range(1.4, 3.8);
      const a = new THREE.Mesh(this.rocks[rng.int(4)], mat.rock); a.scale.set(s, s * rng.range(0.75, 1), s * rng.range(0.8, 1.1));
      g.add(a);
      radius = s * 0.85;
      spin.multiplyScalar(0.7);
    }
    this.place(g, z, rng, ship);
    if (type !== "balloon") g.rotation.set(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6));
    return { mesh: g, radius, type, spin, passed: false };
  }

  fuel(z: number, rng: Rng): WorldObject {
    const { geo, mat } = this;
    const g = new THREE.Group();
    const can = new THREE.Group();
    can.add(new THREE.Mesh(geo.fuel, mat.fuel));
    const cap = new THREE.Mesh(geo.cap, mat.cap); cap.position.y = 0.85; can.add(cap);
    can.rotation.z = 0.4;
    g.add(can, new THREE.Mesh(geo.ring, mat.ring));
    g.scale.setScalar(1.3);
    g.position.set(rng.range(-LANE_X * 0.75, LANE_X * 0.75), rng.range(-LANE_Y * 0.75, LANE_Y * 0.75), z);
    return { mesh: g, radius: 1.8, type: "fuel", spin: new THREE.Vector3(0, 0, 1.4), passed: false };
  }

  /** Decorative cloud bank (visual only, uses Math.random). */
  cloud(z: number, allowCenter: boolean): THREE.Group {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudMap, transparent: true, depthWrite: false, opacity: 0.55 + Math.random() * 0.35 }));
      s.scale.set(14 + Math.random() * 12, 8 + Math.random() * 6, 1);
      s.position.set(i * 7 - n * 3.5 + (Math.random() * 4 - 2), Math.random() * 4 - 2, Math.random() * 8 - 4);
      g.add(s);
    }
    let x = Math.random() * 160 - 80;
    const y = Math.random() * 60 - 26;
    if (!allowCenter && Math.abs(x) < 24 && Math.abs(y) < 14) x += x < 0 ? -30 : 30;
    g.position.set(x, y, z);
    return g;
  }
}

/** Dispose sprite materials created per cloud. Shared geometries/materials are kept. */
export function disposeCloud(g: THREE.Group) {
  g.children.forEach((c) => {
    if (c instanceof THREE.Sprite) c.material.dispose();
  });
}
