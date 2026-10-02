import * as THREE from "three";
import { LANDMARKS, moonPoint } from "./moonAtlas";
import type { View } from "./views";
import { MOON_RADIUS, createMoon, type MoonSurface } from "./world/moon";
import { createStars } from "./world/sky";

/** Real Moon radius, for the altitude readout. */
const MOON_KM_RADIUS = 1737;
/** Closest approach: you can look, not land. */
const MIN_DIST = MOON_RADIUS * 1.32;
const MAX_DIST = MOON_RADIUS * 8;
const START_DIST = MOON_RADIUS * 3.6;
const FOCUS_DIST = MOON_RADIUS * 1.9;
const MAX_PITCH = 1.45;

export interface ObservatoryHud {
  marks: HTMLElement[];
  altitude: HTMLElement;
}

/**
 * The lunar observatory: the Moon on its own, orbit it, zoom in (not too far),
 * and read up on what's there. Markers are DOM elements positioned each frame.
 */
export class Observatory {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 6000);
  readonly view: View;
  private moon;
  private pts = LANDMARKS.map((l) => moonPoint(l.lat, l.lon));
  private world = LANDMARKS.map(() => new THREE.Vector3());
  private yaw = 0;
  private pitch = 0.12;
  private dist = START_DIST;
  private tYaw = 0;
  private tPitch = 0.12;
  private tDist = START_DIST;
  private spin = new THREE.Vector2();
  private idle = 0;
  private lowSun = true;
  private sunMix = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private lastAlt = "";
  private shown: boolean[] = LANDMARKS.map(() => true);
  private tmp = { v: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), l: new THREE.Vector3() };

  constructor(surface: MoonSurface) {
    this.moon = createMoon(surface, 160);
    this.moon.material.uniforms.uBumpScale.value = 3;
    this.moon.material.uniforms.uAmbient.value = 0.02;
    this.moon.material.transparent = false;
    this.scene.add(this.moon.mesh);
    const stars = createStars(3200, 1.3), bright = createStars(300, 2.4);
    (stars.material as THREE.PointsMaterial).opacity = 0.85;
    (bright.material as THREE.PointsMaterial).opacity = 1;
    this.scene.add(stars, bright);
    this.view = { scene: this.scene, camera: this.camera };
    this.moon.mesh.updateMatrixWorld(true);
    this.pts.forEach((p, i) => this.world[i].copy(p).applyQuaternion(this.moon.mesh.quaternion));
  }

  /** Starts each visit facing the near side, the way it looks from Earth, with the whole disc in frame. */
  reset(aspect: number) {
    this.fitLens(aspect);
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, aspect));
    const fit = (MOON_RADIUS / Math.sin(half)) * 1.15;
    this.yaw = this.tYaw = 0;
    this.pitch = this.tPitch = 0.12;
    this.dist = this.tDist = THREE.MathUtils.clamp(Math.max(START_DIST, fit), MIN_DIST, MAX_DIST);
    this.spin.set(0, 0);
    this.idle = 0;
    this.pointers.clear();
  }

  setLowSun(low: boolean) {
    this.lowSun = low;
  }

  /** Swings the view round to a landmark and moves in a little. */
  focus(id: string) {
    const i = LANDMARKS.findIndex((l) => l.id === id);
    if (i < 0) return;
    const w = this.world[i];
    let yaw = Math.atan2(w.x, w.z);
    while (yaw - this.tYaw > Math.PI) yaw -= Math.PI * 2;
    while (yaw - this.tYaw < -Math.PI) yaw += Math.PI * 2;
    this.tYaw = yaw;
    this.tPitch = THREE.MathUtils.clamp(Math.asin(w.y), -MAX_PITCH, MAX_PITCH);
    this.tDist = Math.min(this.tDist, FOCUS_DIST);
    this.spin.set(0, 0);
    this.idle = 0;
  }

  // ---------- input ----------

  pointerDown(e: PointerEvent) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pinch = this.pinchDistance();
    this.spin.set(0, 0);
    this.idle = 0;
  }

  pointerMove(e: PointerEvent, height: number) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.idle = 0;
    if (this.pointers.size >= 2) {
      const d = this.pinchDistance();
      if (this.pinch > 0 && d > 0) this.zoom(this.pinch / d);
      this.pinch = d;
      return;
    }
    // Slower when close, so the surface doesn't whip past.
    const k = (2.2 / Math.max(300, height)) * THREE.MathUtils.clamp((this.dist - MOON_RADIUS) / (MOON_RADIUS * 2), 0.12, 1.2);
    this.tYaw -= dx * k;
    this.tPitch = THREE.MathUtils.clamp(this.tPitch + dy * k, -MAX_PITCH, MAX_PITCH);
    this.spin.set(-dx * k, dy * k).multiplyScalar(30);
  }

  pointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.pinch = this.pinchDistance();
  }

  wheel(deltaY: number) {
    this.zoom(Math.exp(deltaY * 0.0012));
    this.idle = 0;
  }

  zoom(factor: number) {
    const alt = (this.tDist - MOON_RADIUS) * factor;
    this.tDist = THREE.MathUtils.clamp(MOON_RADIUS + alt, MIN_DIST, MAX_DIST);
  }

  /** Arrow keys orbit, +/- zoom. */
  keys(dt: number, k: Record<string, boolean>) {
    const s = dt * 1.1 * THREE.MathUtils.clamp((this.dist - MOON_RADIUS) / (MOON_RADIUS * 2), 0.15, 1.2);
    if (k.ArrowLeft || k.a) this.tYaw -= s;
    if (k.ArrowRight || k.d) this.tYaw += s;
    if (k.ArrowUp || k.w) this.tPitch = Math.min(MAX_PITCH, this.tPitch + s);
    if (k.ArrowDown || k.s) this.tPitch = Math.max(-MAX_PITCH, this.tPitch - s);
    if (k["+"] || k["="]) this.zoom(Math.exp(-dt * 1.5));
    if (k["-"] || k._) this.zoom(Math.exp(dt * 1.5));
    if (Object.values(k).some(Boolean)) this.idle = 0;
  }

  /** A wider lens on portrait screens so the Moon isn't cropped at the sides. */
  private fitLens(aspect: number) {
    const fov = aspect < 1 ? 50 : 35;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private pinchDistance() {
    if (this.pointers.size < 2) return 0;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ---------- per frame ----------

  update(dt: number, hud: ObservatoryHud, width: number, height: number) {
    this.idle += dt;
    this.fitLens(width / Math.max(1, height));
    if (this.pointers.size === 0) {
      // Coast after a flick, then drift slowly once left alone.
      this.tYaw += this.spin.x * dt;
      this.tPitch = THREE.MathUtils.clamp(this.tPitch + this.spin.y * dt, -MAX_PITCH, MAX_PITCH);
      this.spin.multiplyScalar(Math.exp(-3.5 * dt));
      if (this.idle > 5) this.tYaw += dt * 0.035;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.dist += (this.tDist - this.dist) * k;

    const cam = this.camera, cp = Math.cos(this.pitch);
    cam.position.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).multiplyScalar(this.dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    // The sun follows the viewer from the upper left: low for crater shadows, high for a full Moon.
    this.sunMix += ((this.lowSun ? 1 : 0) - this.sunMix) * (1 - Math.exp(-3 * dt));
    const t = this.tmp, toCam = t.v.copy(cam.position).normalize();
    t.r.setFromMatrixColumn(cam.matrixWorld, 0);
    t.u.setFromMatrixColumn(cam.matrixWorld, 1);
    const m = this.sunMix;
    t.l.copy(toCam).multiplyScalar(0.9 - 0.4 * m).addScaledVector(t.r, -(0.3 + 0.48 * m)).addScaledVector(t.u, 0.2 + 0.1 * m).normalize();
    this.moon.material.uniforms.uL.value.copy(t.l);
    // Relief flattens out under a high sun, as on the real full Moon.
    this.moon.material.uniforms.uBumpScale.value = 3 * (0.35 + 0.65 * m);

    const alt = `${Math.round(((this.dist - MOON_RADIUS) / MOON_RADIUS) * MOON_KM_RADIUS).toLocaleString("en-US")} km`;
    if (alt !== this.lastAlt) {
      this.lastAlt = alt;
      hud.altitude.textContent = alt;
    }

    // Markers: only on the side facing us, fading out toward the limb.
    for (let i = 0; i < this.world.length; i++) {
      const el = hud.marks[i];
      if (!el) continue;
      const w = this.world[i];
      const p = t.v.copy(w).multiplyScalar(MOON_RADIUS);
      const facing = w.dot(t.r.copy(cam.position).sub(p).normalize());
      const vis = THREE.MathUtils.smoothstep(facing, 0.12, 0.35);
      const on = vis > 0.02;
      if (on !== this.shown[i]) {
        this.shown[i] = on;
        el.classList.toggle("off", !on);
      }
      if (!on) continue;
      p.project(cam);
      el.style.transform = `translate(${((p.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
      el.style.opacity = vis.toFixed(2);
    }
  }
}
