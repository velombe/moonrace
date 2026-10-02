import * as THREE from "three";
import type { View } from "../views";
import { EXTERIOR_LAYER, createRocket } from "../world/rocket";
import { createStars } from "../world/sky";
import { canvas, colorTex } from "../world/textures";
import { makeFlag, makePanel, setMatte, type Planting } from "./plantings";
import { Terrain } from "./terrain";

// Site layout in metres: x east, z south, lander at the origin. Earth hangs
// low in the west (this is the Moon's eastern edge); the sun is low in the
// south-east, so shadows are long and point north-west.
const SUN_DIR = new THREE.Vector3(0.35, 0.25, 0.9).normalize();
const EARTH_DIR = new THREE.Vector3(-1, Math.tan(THREE.MathUtils.degToRad(9.5)), -0.12).normalize();
const SKY_DIST = 2900;
const FLAG_FIELD = { x: -17, z: 5 };
const CRATER = { x: 6, z: -32, r: 14 };
const LANDER_SCALE = 7.5;
const LEG_SPAN = 7;
const EYE = 1.62;
const MOON_G = 1.62;
const WALK_FOV = 62;
/** A press that moves less than this (px) and lasts less than TAP_MS counts as a tap, not a look-drag. */
const TAP_PX = 8;
const TAP_MS = 450;
const WALK_SPEED = 3;
/** Seconds from the start of the descent to touchdown, and to the cut to first person. */
const TOUCHDOWN = 5.6;
const DESCENT_END = 7.4;

export type SpotId = "lander" | "flags" | "crater" | "lookback";

/** Places you can walk to, and what you face when you get there. */
export const SPOTS: { id: SpotId; name: string; x: number; z: number; look: [number, number, number] }[] = [
  { id: "lander", name: "Lander", x: 12, z: 10, look: [-60, 4, -6] },
  { id: "flags", name: "Flag field", x: -10.5, z: 6.5, look: [-60, 4.5, 3] },
  { id: "crater", name: "Crater rim", x: 6, z: CRATER.z + CRATER.r + 2.2, look: [6, -2.5, CRATER.z] },
  { id: "lookback", name: "Look back", x: -38, z: 27, look: [0, 9, 0] },
];

export interface SiteFrame {
  touchdown: boolean;
  /** The descent is over and the player is standing on the surface. */
  landed: boolean;
  /** A planting just hit the ground. */
  planted: Planting | null;
  fade: number;
}

interface Dust {
  pos: Float32Array;
  vel: Float32Array;
  floor: Float32Array;
  next: number;
  points: THREE.Points;
}

/**
 * The landing zone up close: regolith, rocks, craters, the lander, Earth on
 * the horizon, and everyone's flags and panels. First the lander comes down,
 * then you walk between a few spots and look around.
 */
export class LandingSite {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 6000);
  readonly view: View;
  private terrain: Terrain;
  private lander = new THREE.Group();
  private rocket;
  private landerFloor: number;
  private sun = new THREE.DirectionalLight(0xfff6e8, 2.1 * Math.PI);
  private stars = createStars(1400, 1.1);
  private dust: Dust;
  private prints: THREE.InstancedMesh;
  private printCount = 0;
  private printDist = 0;
  private printSide = 1;
  private items: { p: Planting; g: THREE.Group; label: number; drop: number }[] = [];
  private pending: Planting | null = null;
  private mode: "descent" | "walk" = "descent";
  private t = 0;
  private walker = new THREE.Vector2();
  private path: THREE.Vector2[] = [];
  private arriveLook: [number, number, number] | null = null;
  private hop = 0;
  private yaw = 0;
  private pitch = 0;
  private tYaw = 0;
  private tPitch = 0;
  private dragging = new Map<number, { x: number; y: number }>();
  private userLook = false;
  private camShake = 0;
  /** The planting being looked at up close, if any. */
  private focused: string | null = null;
  /** Close-up framing to apply on arrival: item size (m), kneel depth, and what to look at. */
  private focusArrive: { w: number; h: number; crouch: number; target: [number, number, number] } | null = null;
  private fovNow = WALK_FOV;
  private fovTarget = WALK_FOV;
  private crouch = 0;
  private crouchTarget = 0;
  private press = new Map<number, { x: number; y: number; t: number; moved: number }>();
  private ray = new THREE.Raycaster();
  private tmp = new THREE.Vector3();

  constructor(glowTex: THREE.Texture, earth: THREE.Object3D, lowEnd: boolean) {
    const s = this.scene;
    s.background = new THREE.Color(0x000000);
    this.camera.rotation.order = "YXZ";
    this.camera.layers.enable(EXTERIOR_LAYER);
    this.view = { scene: s, camera: this.camera };

    this.terrain = new Terrain(
      [{ x: 0, z: 0, r: 13 }, { x: FLAG_FIELD.x, z: FLAG_FIELD.z, r: 11 }, { x: -8, z: 6, r: 6 }],
      [CRATER, { x: 48, z: 30, r: 26 }, { x: -70, z: -40, r: 40 }, { x: 140, z: -120, r: 70 }],
    );
    s.add(this.terrain.mesh(lowEnd), ...this.terrain.rocks(lowEnd));

    // Hard, low sun; a whisper of earthshine so shadows aren't pure black.
    this.sun.position.copy(SUN_DIR).multiplyScalar(150);
    this.sun.target.position.set(-6, 0, 0);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(lowEnd ? 2048 : 4096, lowEnd ? 2048 : 4096);
    Object.assign(sh.camera, { left: -65, right: 65, top: 65, bottom: -65, near: 1, far: 420 });
    sh.camera.layers.enable(EXTERIOR_LAYER);
    sh.bias = -0.0004;
    sh.normalBias = 0.04;
    s.add(this.sun, this.sun.target, new THREE.HemisphereLight(0x9db4ff, 0x2a2826, 0.05 * Math.PI));

    const earthCopy = earth.clone(true);
    earthCopy.position.copy(EARTH_DIR).multiplyScalar(SKY_DIST);
    earthCopy.scale.setScalar((SKY_DIST * Math.tan(THREE.MathUtils.degToRad(0.95))) / 520);
    earthCopy.rotation.set(0.2, 2.2, 0.35);
    const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sunDisc.position.copy(SUN_DIR).multiplyScalar(SKY_DIST);
    sunDisc.scale.setScalar(320);
    (this.stars.material as THREE.PointsMaterial).opacity = 0.3;
    s.add(earthCopy, sunDisc, this.stars);

    this.rocket = createRocket(glowTex);
    this.rocket.ship.rotation.x = Math.PI / 2;
    this.rocket.ship.scale.setScalar(LANDER_SCALE);
    this.rocket.ship.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh && m && m.blending !== THREE.AdditiveBlending) o.castShadow = o.receiveShadow = true;
    });
    this.lander.add(this.rocket.ship);
    this.landerFloor = this.terrain.height(0, 0);
    this.buildLegs();
    s.add(this.lander);

    this.dust = this.makeDust(lowEnd ? 1500 : 4000);
    this.prints = this.makePrints();
    this.walker.set(SPOTS[0].x, SPOTS[0].z);
  }

  /** Lander back up in the sky, ready to come down. */
  beginLanding() {
    this.mode = "descent";
    this.t = 0;
    this.camShake = 0;
    this.pending = null;
    this.path = [];
    this.unfocus();
    this.crouch = 0;
    this.fovNow = WALK_FOV;
    this.walker.set(SPOTS[0].x, SPOTS[0].z);
    this.placeLander(140);
  }

  /** Skips the descent. */
  skip() {
    if (this.mode === "descent") this.t = Math.max(this.t, DESCENT_END - 0.4);
  }

  /** Engine level for the audio during the descent. */
  get thrust() {
    return this.mode === "descent" && this.t < TOUCHDOWN + 0.15 ? 1 : 0;
  }

  get walking() {
    return this.mode === "walk";
  }

  /** Shows these plantings (oldest first, so each keeps its spot in the field). */
  setPlantings(list: Planting[]) {
    const keep = new Set(list.map((p) => p.id));
    this.items = this.items.filter((it) => {
      if (keep.has(it.p.id)) return true;
      this.scene.remove(it.g);
      return false;
    });
    list.forEach((p, i) => {
      // One being carried to the field appears when it's planted, not before.
      if (p.id === this.pending?.id) return;
      let it = this.items.find((x) => x.p.id === p.id);
      if (!it) {
        it = { p, g: p.kind === "flag" ? makeFlag(p) : makePanel(p), label: i, drop: 0 };
        this.items.push(it);
        this.scene.add(it.g);
      }
      it.label = i;
      if (it.drop <= 0) this.place(it.g, i);
    });
  }

  /** Walks up to the next free slot in the flag field and plants it in front of you. */
  plant(p: Planting) {
    if (this.mode !== "walk") return;
    this.unfocus();
    this.pending = p;
    const slot = this.slot(this.items.length), view = SPOTS[1];
    const away = new THREE.Vector2(view.x - slot.x, view.z - slot.y).normalize();
    const stand = slot.clone().addScaledVector(away, p.kind === "panel" ? 2.2 : 2.8);
    this.walkToPoint(stand, [slot.x, this.terrain.height(slot.x, slot.y) + (p.kind === "panel" ? 0.6 : 1.4), slot.y]);
  }

  walkTo(id: SpotId) {
    const spot = SPOTS.find((s) => s.id === id);
    if (!spot || this.mode !== "walk") return;
    this.unfocus();
    this.walkToPoint(new THREE.Vector2(spot.x, spot.z), spot.look);
  }

  get focusedId() {
    return this.focused;
  }

  /**
   * Walks up to a flag or panel and frames it: kneel and zoom for a panel so
   * it can be read, zoom on the cloth for a flag. Returns false if not found.
   */
  focus(id: string) {
    const it = this.items.find((x) => x.p.id === id);
    if (!it || this.mode !== "walk" || this.pending) return false;
    const g = it.g, r = g.rotation.y, panel = it.p.kind === "panel";
    // Plantings face local +Z; stand in front of that.
    const front = new THREE.Vector2(Math.sin(r), Math.cos(r));
    const stand = new THREE.Vector2(g.position.x, g.position.z).addScaledVector(front, panel ? 1.45 : 1.9);
    const target: [number, number, number] = panel
      ? [g.position.x, g.position.y + 0.72, g.position.z]
      : [g.position.x + Math.cos(r) * 0.47, g.position.y + 1.98, g.position.z - Math.sin(r) * 0.47];
    this.unfocus();
    this.focused = id;
    setMatte(g, true);
    this.walkToPoint(stand, target);
    this.focusArrive = { w: panel ? 1.1 : 0.92, h: panel ? 0.62 : 0.62, crouch: panel ? 0.38 : 0, target };
    return true;
  }

  /** Back to the normal standing view. */
  unfocus() {
    const it = this.items.find((x) => x.p.id === this.focused);
    if (it) setMatte(it.g, false);
    this.focused = null;
    this.focusArrive = null;
    this.fovTarget = WALK_FOV;
    this.crouchTarget = 0;
  }

  private walkToPoint(to: THREE.Vector2, look: [number, number, number]) {
    const from = this.walker.clone();
    this.path = [to];
    // Walk around the lander's legs rather than through them.
    const d = to.clone().sub(from), len = d.length();
    if (len > 0.1) {
      const t = THREE.MathUtils.clamp(-from.dot(d) / (len * len), 0, 1);
      const closest = from.clone().addScaledVector(d, t);
      if (closest.length() < LEG_SPAN + 2.5 && t > 0 && t < 1) {
        const side = new THREE.Vector2(-d.y, d.x).normalize();
        if (side.dot(closest) < 0) side.negate();
        this.path.unshift(side.multiplyScalar(LEG_SPAN + 3.5));
      }
    }
    this.arriveLook = look;
    this.userLook = false;
  }

  // ---------- input ----------

  pointerDown(e: PointerEvent) {
    this.dragging.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.press.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
  }

  pointerMove(e: PointerEvent, height: number) {
    const p = this.dragging.get(e.pointerId);
    if (!p || this.mode !== "walk") return;
    const k = 2.4 / Math.max(300, height);
    const pr = this.press.get(e.pointerId);
    if (pr) pr.moved = Math.max(pr.moved, Math.hypot(e.clientX - pr.x, e.clientY - pr.y));
    if (pr && pr.moved < TAP_PX) return;
    this.tYaw += (e.clientX - p.x) * k;
    this.tPitch = THREE.MathUtils.clamp(this.tPitch + (e.clientY - p.y) * k, -1.1, 1.1);
    p.x = e.clientX;
    p.y = e.clientY;
    this.userLook = true;
  }

  /**
   * Ends a press. A tap returns what it hit: a planting's id, "" for empty
   * ground, or null if it wasn't a tap (a drag, or not walking).
   */
  pointerUp(e: PointerEvent, rect: DOMRect): string | null {
    this.dragging.delete(e.pointerId);
    const pr = this.press.get(e.pointerId);
    this.press.delete(e.pointerId);
    if (!pr || this.mode !== "walk" || pr.moved >= TAP_PX || performance.now() - pr.t > TAP_MS) return null;
    return this.pick(e.clientX, e.clientY, rect);
  }

  private pick(x: number, y: number, rect: DOMRect) {
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    this.ray.far = 40;
    let best: { id: string; d: number } | null = null;
    for (const it of this.items) {
      const hit = this.ray.intersectObject(it.g, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id: it.p.id, d: hit.distance };
    }
    return best ? best.id : "";
  }

  keys(dt: number, k: Record<string, boolean>) {
    if (this.mode !== "walk") return;
    const s = dt * 1.4;
    if (k.ArrowLeft || k.a) this.tYaw += s;
    if (k.ArrowRight || k.d) this.tYaw -= s;
    if (k.ArrowUp || k.w) this.tPitch = Math.min(1.1, this.tPitch + s);
    if (k.ArrowDown || k.s) this.tPitch = Math.max(-1.1, this.tPitch - s);
    if (k.ArrowLeft || k.ArrowRight || k.ArrowUp || k.ArrowDown || k.a || k.d || k.w || k.s) this.userLook = true;
  }

  // ---------- per frame ----------

  update(dt: number): SiteFrame {
    const f: SiteFrame = { touchdown: false, landed: false, planted: null, fade: 0 };
    this.updateDust(dt);
    for (const it of this.items) {
      if (it.drop <= 0) continue;
      it.drop = Math.max(0, it.drop - dt * 2.8);
      this.place(it.g, it.label, it.drop * it.drop * 1.6);
    }
    if (this.mode === "descent") this.descend(dt, f);
    else this.walk(dt, f);
    this.stars.position.copy(this.camera.position);
    return f;
  }

  /** Positions the name labels over nearby plantings (DOM elements in plantings order). */
  labels(els: HTMLElement[], width: number, height: number) {
    const cam = this.camera.position;
    for (const it of this.items) {
      const el = els[it.label];
      if (!el) continue;
      const p = this.tmp.copy(it.g.position);
      p.y += it.p.kind === "flag" ? 2.65 : 1.25;
      const dist = p.distanceTo(cam);
      p.project(this.camera);
      const vis = this.mode === "walk" && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 ? 1 - THREE.MathUtils.smoothstep(dist, 14, 24) : 0;
      const shown = it.p.id === this.focused ? 0 : vis;
      el.style.opacity = shown.toFixed(2);
      el.style.pointerEvents = shown > 0.3 ? "auto" : "none";
      if (shown > 0) el.style.transform = `translate(${((p.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * height).toFixed(1)}px)`;
    }
  }

  private descend(dt: number, f: SiteFrame) {
    this.t += dt;
    const s = Math.min(1, this.t / TOUCHDOWN);
    const alt = 140 * Math.pow(1 - s, 2.4);
    this.placeLander(alt);
    const firing = this.t < TOUCHDOWN + 0.15;
    this.rocket.setThrust(firing ? 0.55 + 0.6 * (1 - s) : 0, firing);
    if (this.t >= TOUCHDOWN && this.t - dt < TOUCHDOWN) {
      f.touchdown = true;
      this.camShake = 1;
    }
    // Plume scours the surface: dust flies out in flat sheets, then falls straight back.
    if (firing && alt < 38) {
      const n = Math.round(dt * 1400 * (1 - alt / 38));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4, v = 14 + Math.random() * 26;
        this.emit(Math.cos(a) * r, this.landerFloor + 0.05, Math.sin(a) * r, Math.cos(a) * v, 0.3 + Math.random() * 2.2, Math.sin(a) * v, this.landerFloor - 0.3);
      }
    }
    // Low wide shot from out on the plain, tilting down with the lander.
    this.camShake = Math.max(0, this.camShake - dt * 1.5);
    const cam = this.camera, ground = this.terrain.height(-46, 30);
    cam.position.set(-46, ground + 2.1, 30);
    cam.lookAt(0, this.landerFloor + 9 + alt * 0.85, 0);
    if (this.camShake > 0) cam.rotation.x += (Math.random() - 0.5) * 0.01 * this.camShake;
    this.fov(42);
    f.fade = THREE.MathUtils.smoothstep(this.t, DESCENT_END - 0.5, DESCENT_END);
    if (this.t >= DESCENT_END) {
      this.mode = "walk";
      f.landed = true;
      const look = SPOTS[0].look;
      this.yaw = this.tYaw = Math.atan2(-(look[0] - SPOTS[0].x), -(look[2] - SPOTS[0].z));
      this.pitch = this.tPitch = -0.05;
    }
  }

  private walk(dt: number, f: SiteFrame) {
    const target = this.path[0];
    let moving = false;
    if (target) {
      const d = target.clone().sub(this.walker), len = d.length(), step = WALK_SPEED * dt;
      if (len <= step) {
        this.walker.copy(target);
        this.path.shift();
      } else {
        this.walker.addScaledVector(d, step / len);
        moving = true;
        if (!this.userLook) {
          this.tYaw = this.nearAngle(Math.atan2(-d.x, -d.y), this.tYaw);
          this.tPitch = -0.12;
        }
      }
      this.leavePrints(Math.min(step, len), d);
      if (!this.path.length) {
        if (this.focusArrive) {
          const fa = this.focusArrive;
          this.focusArrive = null;
          this.crouchTarget = fa.crouch;
          this.userLook = false;
          // Zoom so the whole item fits this screen's shape, with a little margin.
          const [tx, ty, tz] = fa.target, x = this.walker.x, z = this.walker.y;
          const d = Math.hypot(tx - x, ty - (this.terrain.height(x, z) + EYE - fa.crouch), tz - z);
          const aspect = this.camera.aspect || 1;
          const v = 2 * Math.atan((fa.h * 1.4) / 2 / d);
          // Wide screens leave extra width for the card beside the item.
          const hz = 2 * Math.atan(Math.tan(Math.atan((fa.w * (aspect >= 1 ? 1.75 : 1.25)) / 2 / d)) / aspect);
          const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.max(v, hz)), 22, 85);
          this.fovTarget = fov;
          // The info card covers the bottom on tall screens and the top-right on wide
          // ones, so sit the item higher, or left of centre, to keep it all visible.
          const halfV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
          const drop = aspect < 1 ? d * halfV * 0.32 : 0;
          const fx = tx - x, fz = tz - z, fl = Math.hypot(fx, fz) || 1;
          const side = aspect >= 1 ? d * halfV * aspect * 0.24 : 0;
          this.arriveLook = [tx + (-fz / fl) * side, ty - drop, tz + (fx / fl) * side];
        }
        if (this.arriveLook && !this.userLook) this.lookAt(this.arriveLook);
        this.arriveLook = null;
        if (this.pending) {
          // Plant it a step in front of the field's newest slot.
          const p = this.pending;
          this.pending = null;
          f.planted = p;
          let it = this.items.find((x) => x.p.id === p.id);
          if (!it) {
            it = { p, g: p.kind === "flag" ? makeFlag(p) : makePanel(p), label: this.items.length, drop: 1 };
            this.items.push(it);
            this.scene.add(it.g);
          }
          it.drop = 1;
          this.place(it.g, it.label, 1.6);

          const gp = it.g.position;
          for (let i = 0; i < 160; i++) {
            const a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 3;
            this.emit(gp.x, this.terrain.height(gp.x, gp.z) + 0.05, gp.z, Math.cos(a) * v, 0.6 + Math.random() * 1.6, Math.sin(a) * v, this.terrain.height(gp.x, gp.z) - 0.1);
          }
        }
      }
    }
    // Loping low-gravity gait: long, floaty hops.
    if (moving) this.hop += dt * (WALK_SPEED / 1.3) * Math.PI;
    else this.hop = Math.abs(Math.sin(this.hop)) < 0.05 ? 0 : this.hop + dt * 3;
    const bob = Math.abs(Math.sin(this.hop)) * 0.2;
    const k = 1 - Math.exp(-6 * dt);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.pitch += (this.tPitch - this.pitch) * k;
    this.crouch += (this.crouchTarget - this.crouch) * (1 - Math.exp(-4 * dt));
    this.fovNow += (this.fovTarget - this.fovNow) * (1 - Math.exp(-3.5 * dt));
    const cam = this.camera, x = this.walker.x, z = this.walker.y;
    cam.position.set(x, this.terrain.height(x, z) + EYE - this.crouch + bob, z);
    cam.rotation.set(this.pitch, this.yaw, Math.sin(this.hop) * 0.012);
    this.fov(Math.round(this.fovNow * 10) / 10);
    f.fade = 0;
  }

  private lookAt([x, y, z]: [number, number, number]) {
    const p = this.walker, h = this.terrain.height(p.x, p.y) + EYE - this.crouchTarget;
    this.tYaw = this.nearAngle(Math.atan2(-(x - p.x), -(z - p.y)), this.tYaw);
    this.tPitch = Math.atan2(y - h, Math.hypot(x - p.x, z - p.y));
  }

  private nearAngle(a: number, ref: number) {
    while (a - ref > Math.PI) a -= Math.PI * 2;
    while (a - ref < -Math.PI) a += Math.PI * 2;
    return a;
  }

  private fov(v: number) {
    if (this.camera.fov !== v) {
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---------- building ----------

  private placeLander(alt: number) {
    this.lander.position.set(0, this.landerFloor + alt, 0);
    // Footpads sit on the ground; the hull's base is a little above them.
    this.rocket.ship.position.y = 1.63 * LANDER_SCALE + 1.4;
  }

  private buildLegs() {
    const foil = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.35, metalness: 0.8 });
    const strut = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7 });
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const foot = new THREE.Vector3(c * LEG_SPAN, 0.12, s * LEG_SPAN);
      for (const [top, r] of [[new THREE.Vector3(c * 2.6, 9, s * 2.6), 0.22], [new THREE.Vector3(c * 2.9, 4.5, s * 2.9), 0.14]] as const) {
        const d = top.clone().sub(foot);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), strut);
        m.position.copy(foot).addScaledVector(d, 0.5);
        m.quaternion.setFromUnitVectors(up, d.normalize());
        m.castShadow = true;
        this.lander.add(m);
      }
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.22, 20), foil);
      pad.position.copy(foot);
      pad.castShadow = pad.receiveShadow = true;
      this.lander.add(pad);
    }
  }

  /** Slot k of the flag field: a golden-angle spiral (x, z). */
  private slot(k: number) {
    const a = k * 2.39996 + 0.6, r = 1.4 + 1.3 * Math.sqrt(k);
    return new THREE.Vector2(FLAG_FIELD.x + Math.cos(a) * r, FLAG_FIELD.z + Math.sin(a) * r);
  }

  /** Puts a planting in slot k, facing the field's viewing spot. */
  private place(g: THREE.Group, k: number, lift = 0) {
    const { x, y: z } = this.slot(k);
    g.position.set(x, this.terrain.height(x, z) - 0.15 + lift, z);
    const view = SPOTS[1];
    g.rotation.y = Math.atan2(view.x - x, view.z - z);
  }

  private makeDust(n: number): Dust {
    const pos = new Float32Array(n * 3).fill(-1000), vel = new Float32Array(n * 3), floor = new Float32Array(n).fill(-2000);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xa39d93, size: 0.3, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false }));
    points.frustumCulled = false;
    this.scene.add(points);
    return { pos, vel, floor, next: 0, points };
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, floor: number) {
    const d = this.dust, i = d.next;
    d.next = (i + 1) % d.floor.length;
    d.pos.set([x, y, z], i * 3);
    d.vel.set([vx, vy, vz], i * 3);
    d.floor[i] = floor;
  }

  private updateDust(dt: number) {
    const { pos, vel, floor } = this.dust;
    let any = false;
    for (let i = 0; i < floor.length; i++) {
      const o = i * 3;
      if (pos[o + 1] < floor[i]) continue;
      any = true;
      vel[o + 1] -= MOON_G * dt;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
      if (pos[o + 1] < floor[i]) pos[o + 1] = -1000;
    }
    if (any) (this.dust.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private makePrints() {
    const { c, ctx } = canvas(64, 160);
    ctx.clearRect(0, 0, 64, 160);
    ctx.fillStyle = "rgba(20,18,16,.55)";
    // Boot sole with cross treads.
    ctx.beginPath();
    ctx.ellipse(32, 46, 24, 40, 0, 0, Math.PI * 2);
    ctx.ellipse(32, 122, 20, 32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let y = 14; y < 156; y += 9) ctx.fillRect(10, y, 44, 3);
    const tex = colorTex(c);
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const geo = new THREE.PlaneGeometry(0.15, 0.34);
    geo.rotateX(-Math.PI / 2);
    const inst = new THREE.InstancedMesh(geo, mat, 400);
    inst.count = 0;
    inst.receiveShadow = true;
    inst.frustumCulled = false;
    this.scene.add(inst);
    return inst;
  }

  private leavePrints(step: number, dir: THREE.Vector2) {
    this.printDist += step;
    if (this.printDist < 0.75) return;
    this.printDist = 0;
    this.printSide = -this.printSide;
    const n = dir.clone().normalize(), side = new THREE.Vector2(-n.y, n.x).multiplyScalar(0.13 * this.printSide);
    const x = this.walker.x + side.x, z = this.walker.y + side.y;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, this.terrain.height(x, z) + 0.012, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-n.x, -n.y)),
      new THREE.Vector3(1, 1, 1),
    );
    const i = this.printCount % 400;
    this.prints.setMatrixAt(i, m);
    this.printCount++;
    this.prints.count = Math.min(400, this.printCount);
    this.prints.instanceMatrix.needsUpdate = true;
  }
}
