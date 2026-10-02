import * as THREE from "three";
import { DEFLECTOR_COOLDOWN, DEFLECTOR_SLOTS } from "./constants";
import type { WorldObject } from "./world/obstacles";

/** Why a press of the fire button did or didn't shoot. */
export type FireResult = "fired" | "unarmed" | "empty" | "hot";

export interface DeflectorHud {
  reticle: HTMLElement;
  reticleLabel: HTMLElement;
  /** One element per slot; its `--fill` (0–1) shows the charge. */
  pips: HTMLElement[];
}

interface Bolt {
  g: THREE.Group;
  target: WorldObject | null;
  dir: THREE.Vector3;
  life: number;
}

const NOSE = 4.2; // ship origin to nose, along -z
const BOLT_SPEED = 380; // on top of the ship's own speed: ~0.25 s to mid-distance
const LOCK_MIN = 16; // closer than this it's too late to shoot
const LOCK_MAX = 320;
const HIT_PAD = 0.8;

const LABEL: Partial<Record<WorldObject["type"], string>> = { asteroid: "Asteroid", junk: "Junk", satellite: "Satellite" };

/**
 * The planetary-defense deflector: charge earned from near misses, aim assist
 * that locks the nearest obstacle in a narrow cone ahead, and the energy bolts.
 * The game decides what a hit means; this only reports which object was hit.
 */
export class Deflector {
  armed = false;
  /** Stored charge in slots (0 … DEFLECTOR_SLOTS); each whole slot is one shot. */
  charge = 0;
  cooldown = 0;
  shots = 0;
  lock: WorldObject | null = null;
  private bolts: Bolt[] = [];
  private coreMat: THREE.SpriteMaterial;
  private trailMat = new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private trailGeo = new THREE.CylinderGeometry(0.05, 0.16, 7, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, 3.5);
  private shown = { pips: [-1, -1, -1], reticle: "", label: "", cls: "", hot: false };
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, glowTex: THREE.Texture) {
    this.coreMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xd8f0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  }

  reset() {
    this.armed = false;
    this.charge = this.cooldown = this.shots = 0;
    this.lock = null;
    this.bolts.forEach((b) => this.scene.remove(b.g));
    this.bolts = [];
  }

  /** Arms with one shot ready (or a full charge, for test flights). */
  arm(full: boolean) {
    this.armed = true;
    this.charge = full ? DEFLECTOR_SLOTS : Math.max(this.charge, 1);
  }

  /** Adds charge from a near miss. Returns true if that completed a new shot. */
  addCharge(slots: number) {
    if (!this.armed) return false;
    const before = Math.floor(this.charge);
    this.charge = Math.min(DEFLECTOR_SLOTS, this.charge + slots);
    return Math.floor(this.charge) > before;
  }

  get ready() {
    return this.armed && this.charge >= 1 && this.cooldown <= 0;
  }

  /** Fires at the locked target, or straight ahead if nothing is locked. */
  fire(ship: THREE.Vector3): FireResult {
    if (!this.armed) return "unarmed";
    if (this.charge < 1) return "empty";
    if (this.cooldown > 0) return "hot";
    this.charge -= 1;
    this.cooldown = DEFLECTOR_COOLDOWN;
    this.shots++;
    const g = new THREE.Group();
    const core = new THREE.Sprite(this.coreMat);
    core.scale.setScalar(2.4);
    g.add(core, new THREE.Mesh(this.trailGeo, this.trailMat));
    g.position.set(ship.x, ship.y, ship.z - NOSE);
    this.scene.add(g);
    this.bolts.push({ g, target: this.lock, dir: new THREE.Vector3(0, 0, -1), life: 1.1 });
    return "fired";
  }

  /**
   * Moves bolts and the lock. Returns the objects hit this frame (still in
   * `objects`; the caller removes them) and how many shots hit nothing.
   */
  update(dt: number, ship: THREE.Vector3, vz: number, objects: WorldObject[]) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const hits: WorldObject[] = [];
    let misses = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i], p = b.g.position;
      if (b.target && !objects.includes(b.target)) b.target = null;
      if (b.target) b.dir.copy(b.target.mesh.position).sub(p).normalize();
      const step = (vz + BOLT_SPEED) * dt;
      // Swept test so a fast bolt can't tunnel through something small.
      let hit: WorldObject | null = null;
      for (const o of objects) {
        if (o.type === "fuel") continue;
        const t = this.tmp.copy(o.mesh.position).sub(p);
        const along = THREE.MathUtils.clamp(t.dot(b.dir), 0, step);
        if (t.addScaledVector(b.dir, -along).length() < o.radius + HIT_PAD) {
          hit = o;
          break;
        }
      }
      p.addScaledVector(b.dir, step);
      b.g.lookAt(this.tmp.copy(p).sub(b.dir));
      b.life -= dt;
      if (hit) {
        if (!hits.includes(hit)) hits.push(hit);
      } else if (b.life > 0 && p.z > ship.z - 900) continue;
      else misses++;
      this.scene.remove(b.g);
      this.bolts.splice(i, 1);
    }
    this.updateLock(ship, objects);
    return { hits, misses };
  }

  /** Nearest target ahead in a narrow cone; keeps the current one while it stays valid. */
  private updateLock(ship: THREE.Vector3, objects: WorldObject[]) {
    const valid = (o: WorldObject) => {
      if (o.type === "fuel" || o.type === "balloon" || o.passed) return Infinity;
      const dz = ship.z - o.mesh.position.z;
      if (dz < LOCK_MIN || dz > LOCK_MAX) return Infinity;
      const lateral = Math.hypot(o.mesh.position.x - ship.x, o.mesh.position.y - ship.y) - o.radius;
      return lateral < 2 + dz * 0.035 ? dz + Math.max(0, lateral) * 8 : Infinity;
    };
    if (!this.armed) {
      this.lock = null;
      return;
    }
    if (this.lock && objects.includes(this.lock) && valid(this.lock) < Infinity) return;
    let best: WorldObject | null = null, score = Infinity;
    for (const o of objects) {
      const s = valid(o);
      if (s < score) {
        score = s;
        best = o;
      }
    }
    this.lock = best;
  }

  /** Charge pips and the reticle around the locked target. `show` false hides the reticle. */
  hud(refs: DeflectorHud, cam: THREE.Camera, w: number, h: number, show: boolean) {
    const sh = this.shown;
    const hot = this.cooldown > 0;
    if (sh.hot !== hot) {
      sh.hot = hot;
      refs.pips.forEach((el) => el.classList.toggle("hot", hot));
    }
    refs.pips.forEach((el, i) => {
      const f = Math.round(THREE.MathUtils.clamp(this.charge - i, 0, 1) * 20) / 20;
      if (sh.pips[i] !== f) {
        sh.pips[i] = f;
        el.style.setProperty("--fill", String(f));
        el.classList.toggle("full", f >= 1);
      }
    });
    const o = this.lock;
    let transform = "", cls = "";
    if (show && o && this.charge >= 1) {
      const p = this.tmp.copy(o.mesh.position).project(cam);
      if (p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) {
        const edge = this.tmp.copy(o.mesh.position).setX(o.mesh.position.x + o.radius).project(cam);
        const px = (p.x * 0.5 + 0.5) * w, py = (-p.y * 0.5 + 0.5) * h;
        const size = THREE.MathUtils.clamp(Math.abs(edge.x - p.x) * w * 1.25 + 26, 34, 180);
        transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
        refs.reticle.style.setProperty("--s", `${size.toFixed(0)}px`);
        cls = `on${this.cooldown > 0 ? " hot" : ""}${o.type === "satellite" ? " sat" : ""}`;
      }
    }
    if (transform && sh.reticle !== transform) refs.reticle.style.transform = transform;
    sh.reticle = transform;
    if (sh.cls !== cls) {
      sh.cls = cls;
      refs.reticle.className = `reticle${cls ? " " + cls : ""}`;
    }
    const label = cls && o ? LABEL[o.type] ?? "" : "";
    if (label && sh.label !== label) {
      sh.label = label;
      refs.reticleLabel.textContent = label;
    }
  }
}
