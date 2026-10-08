import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { EndReason } from "../constants";
import type { View } from "../views";
import { canvas, colorTex } from "../world/textures";
import { Screens, type Threat } from "./instruments";
import { Pilot, type GestureName } from "./pilot";

export type { Threat } from "./instruments";

export interface CockpitFrame {
  /** Seconds since the countdown started, or -1 once flying. */
  launch: number;
  /** Stick command, -1..1. */
  steerX: number;
  steerY: number;
  thrust: number;
  /** 0..1 acceleration pressing the pilot back. */
  g: number;
  /** 0..1 vibration. */
  rumble: number;
  space: number;
  fuel: number;
  km: number;
  pct: number;
  kmps: number;
  /** Mission time; negative during the countdown. */
  t: number;
  roll: number;
  pitch: number;
  /** Ship orientation, so gravity in the cabin points the right way. */
  shipQuat: THREE.Quaternion;
  /** Ship lateral acceleration (world units/s²). */
  accel: THREE.Vector2;
  threats: Threat[];
}

// Cabin frame is in metres: pilot seated at the origin facing -Z, camera high in
// the rear-right corner like an onboard camera bolted to the bulkhead.
const CABIN = { x0: -1.15, x1: 1.32, y0: -0.05, y1: 2.06, z0: -1.25, z1: 1.7 };
const WIN = { x0: -1.0, x1: 1.2, y0: 1.0, y1: 1.86, r: 0.13 };
const CAM_POS = new THREE.Vector3(0.8, 1.68, 0.88);
const CAM_YAW = 0.46;
const CAM_PITCH = -0.17;
const BASE_FOV = 64;
/** Cabin camera position in ship space (world units), inside the hull near the nose. */
const EYE = new THREE.Vector3(0, 0.1, -0.9);
const PLUSH_ANCHOR = new THREE.Vector3(0.32, 2.0, -0.62);
const PLUSH_STRING = 0.34;
const STRING_POINTS = 12;

function roundRect(p: THREE.Path, x0: number, y0: number, x1: number, y1: number, r: number) {
  p.moveTo(x0 + r, y0);
  p.lineTo(x1 - r, y0);
  p.quadraticCurveTo(x1, y0, x1, y0 + r);
  p.lineTo(x1, y1 - r);
  p.quadraticCurveTo(x1, y1, x1 - r, y1);
  p.lineTo(x0 + r, y1);
  p.quadraticCurveTo(x0, y1, x0, y1 - r);
  p.lineTo(x0, y0 + r);
  p.quadraticCurveTo(x0, y0, x0 + r, y0);
}

function panelTexture() {
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = "#8d9199";
  ctx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) {
    for (let x = 0; x < 512; x += 128) {
      const v = 172 + Math.random() * 22;
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      ctx.fillRect(x + 3, y + 3, 122, 122);
      ctx.fillStyle = "rgba(60,64,72,.55)";
      for (const [rx, ry] of [[10, 10], [118, 10], [10, 118], [118, 118]]) {
        ctx.beginPath(); ctx.arc(x + rx, y + ry, 2.5, 0, 7); ctx.fill();
      }
    }
  }
  ctx.fillStyle = "#3b3f47";
  for (let i = 0; i < 7; i++) ctx.fillRect(Math.random() * 470, Math.random() * 480, 26 + Math.random() * 20, 18);
  ctx.fillStyle = "#30343c";
  ctx.font = '700 20px "Saira Condensed", "Arial Narrow", sans-serif';
  const labels = ["Handhold", "O2 valve 2", "No step", "Cabin fan", "Snacks", "Do not lick"];
  labels.forEach((l, i) => ctx.fillText(l, 20 + (i % 3) * 160, 70 + Math.floor(i / 3) * 256));
  const t = colorTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function labelTexture(lines: string[], w: number, h: number, size: number, bg: string, fg: string) {
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = `700 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, 14, size * 1.25 * (i + 1)));
  return colorTex(c);
}

/**
 * The cabin: walls with a window, glass cockpit, controls, the pilot and a
 * plush Moon that hangs on a string until you reach space. Drawn on top of
 * the world (after a depth clear) so the window shows the real flight.
 */
export class Cockpit {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.02, 30);
  private pilot: Pilot;
  private screens = new Screens();
  private stick = new THREE.Group();
  private throttle = new THREE.Group();
  private key = new THREE.DirectionalLight(0xdfeaff, 0.8 * Math.PI);
  private glow = new THREE.PointLight(0xffc27a, 0.5 * Math.PI, 2.4, 1.5);
  private alarm = new THREE.PointLight(0xff2a3a, 0, 4, 1.5);
  private flash = new THREE.PointLight(0xffffff, 0, 5, 1.2);
  private leds: THREE.InstancedMesh;
  private ledTimer = 0;
  private plush = new THREE.Group();
  private plushPos = PLUSH_ANCHOR.clone().add(new THREE.Vector3(0, -PLUSH_STRING, 0));
  private plushPrev = this.plushPos.clone();
  private plushSpin = 0;
  private string: THREE.Line;
  private time = 0;
  private kick = 0;
  private lastLaunch = -1;
  private pending: { name: GestureName; at: number } | null = null;
  private tmp = {
    g: new THREE.Vector3(), a: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(),
    threat: new THREE.Vector3(), c: new THREE.Color(), up: new THREE.Vector3(0, 1, 0),
  };

  constructor(renderer: THREE.WebGLRenderer) {
    const s = this.scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.25;
    pmrem.dispose();

    this.camera.rotation.order = "YXZ";
    this.camera.position.copy(CAM_POS);
    this.camera.rotation.set(CAM_PITCH, CAM_YAW, 0);

    // Kept well under the bloom threshold: the suit is white and close to the lens.
    s.add(new THREE.HemisphereLight(0xb8c8ff, 0x2a2420, 0.3 * Math.PI));
    this.key.position.set(0.3, 2.6, -3);
    this.glow.position.set(0.1, 1.0, -0.35);
    this.alarm.position.set(0.2, 1.92, -0.2);
    s.add(this.key, this.glow, this.alarm, this.flash);

    this.buildShell();
    const dash = this.buildConsole();
    this.buildSeat();
    this.leds = this.buildLeds(dash);

    dash.updateMatrixWorld(true);
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const [flightScreen, , fuelScreen] = dash.children.filter((c) => c.userData.screen).map(at);
    this.pilot = new Pilot({
      stick: this.stick.children[0],
      throttle: this.throttle.children[0],
      fuelScreen,
      flightScreen,
      sidePanel: this.buildSidePanel(),
      window: new THREE.Vector3((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, CABIN.z0),
    });
    s.add(this.pilot.root);

    this.buildPlush();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(STRING_POINTS * 3), 3));
    this.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xdcdcdc }));
    this.string.frustumCulled = false;
    s.add(this.string);
  }

  /** Builds the view that looks out of this cabin into `world`. */
  view(world: THREE.Scene, worldCam: THREE.PerspectiveCamera): View {
    return {
      scene: world,
      camera: worldCam,
      overlay: { scene: this.scene, camera: this.camera },
      fit: (aspect: number) => this.fit(aspect, worldCam),
    };
  }

  /** Puts the outside camera where the cabin camera is, riding on `ship`. */
  placeWorldCamera(cam: THREE.PerspectiveCamera, ship: THREE.Object3D) {
    cam.position.copy(EYE).applyQuaternion(ship.quaternion).add(ship.position);
    cam.quaternion.copy(ship.quaternion).multiply(this.camera.quaternion);
  }

  reset(callsign: string) {
    this.pilot.reset();
    this.pilot.setCallsign(callsign);
    this.pending = null;
    this.lastLaunch = -1;
    this.kick = 0;
    this.plushPos.copy(PLUSH_ANCHOR).y -= PLUSH_STRING;
    this.plushPrev.copy(this.plushPos);
  }

  // ---------- events ----------

  nearMiss(side: number, razor: boolean) {
    this.pilot.startle(side, razor ? 1 : 0.6);
    this.kick = razor ? 1 : 0.6;
    this.flash.position.set(side * 1.1, 1.45, -1.0);
    this.flash.intensity = (razor ? 4 : 2.5) * Math.PI;
    if (razor && Math.random() < 0.6) this.pending = { name: "wipe", at: this.time + 0.45 };
  }

  /** Deflector shot: a jolt and a flash through the window. */
  fire() {
    this.kick = Math.max(this.kick, 0.35);
    this.flash.position.set(0, 1.5, -1.4);
    this.flash.intensity = 2 * Math.PI;
  }

  /** Reaction to what the deflector hit. */
  deflectorHit(kind: "asteroid" | "split" | "junk" | "satellite") {
    if (kind === "satellite") this.pending = { name: "shrug", at: this.time + 0.5 };
    else if (kind === "asteroid" && Math.random() < 0.4) this.pilot.play("thumbs");
  }

  pickup() {
    if (Math.random() < 0.45) this.pilot.play("thumbs");
  }

  lowFuel() {
    this.pilot.play("tap");
  }

  milestone(key: string) {
    if (key === "iss") this.pilot.play("wave");
    else if (key === "karman") this.pending = { name: "point", at: this.time + 0.9 };
    else if (Math.random() < 0.3) this.pilot.play("point");
  }

  end(reason: EndReason) {
    if (reason === "fuel") this.pilot.play("shrug");
    else if (reason === "moon") this.pilot.play("celebrate");
  }

  // ---------- per frame ----------

  update(dt: number, f: CockpitFrame) {
    this.time += dt;
    const tmp = this.tmp;
    if (f.launch >= 0 && this.lastLaunch < 0.3 && f.launch >= 0.3) this.pilot.play("checks");
    this.lastLaunch = f.launch;
    if (this.pending && this.time >= this.pending.at) {
      this.pilot.play(this.pending.name);
      this.pending = null;
    }

    this.stick.rotation.set(f.steerY * 0.32, 0, -f.steerX * 0.36);
    this.throttle.rotation.x = -0.1 - 0.45 * THREE.MathUtils.clamp(f.thrust - 0.5, 0, 1);

    // Gravity in the cabin follows the ship: on the pad it pulls toward the tail.
    const G = 9.8 * (1 - f.space);
    tmp.q.copy(f.shipQuat).invert();
    const gDir = tmp.g.set(0, -1, 0).applyQuaternion(tmp.q);

    let threat: THREE.Vector3 | null = null;
    let best = 140;
    for (const o of f.threats) {
      if (o.fuel || o.z < 6 || o.z > best || Math.abs(o.x) > 16) continue;
      best = o.z;
      threat = tmp.threat.set(o.x, o.y, -o.z).normalize().multiplyScalar(3).add(tmp.v.set(0, 1.3, 0.2));
    }

    this.pilot.update(dt, { steerX: f.steerX, steerY: f.steerY, g: f.g, shake: f.rumble, threat, plush: this.plushPos });
    this.updatePlush(dt, f, gDir, G);

    // Camera: rigid mount, buzzing with the engines, jolted by near misses.
    this.kick = Math.max(0, this.kick - dt * 2.5);
    const amp = 0.0012 + f.rumble * 0.006 + this.kick * 0.018;
    const r = () => (Math.random() - 0.5) * amp;
    this.camera.position.set(CAM_POS.x + r() * 0.5, CAM_POS.y + r() * 0.5, CAM_POS.z);
    this.camera.rotation.set(CAM_PITCH + r(), CAM_YAW + r(), r() * 0.5);
    this.camera.updateMatrixWorld();

    // Lights: daylight through the window fading to hard sunlight in space.
    const pad = f.launch >= 0;
    this.key.color.set(pad ? 0xeaf2ff : 0xd6e6ff).lerp(tmp.c.set(0xffffff), pad ? 0 : f.space);
    this.key.intensity = (pad ? 0.95 : 0.85 - 0.25 * f.space) * Math.PI;
    this.flash.intensity *= Math.exp(-7 * dt);
    const low = f.fuel < 25 && f.fuel > 0;
    const pulse = 0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / 1.2);
    this.alarm.intensity = low ? pulse * pulse * 2.4 * Math.PI : 0;
    this.glow.intensity = (0.45 + 0.08 * Math.sin(this.time * 7)) * Math.PI;

    this.ledTimer -= dt;
    if (this.ledTimer <= 0) {
      this.ledTimer = 0.22;
      const palette = [0xffb347, 0x7dffb0, 0xeef2ff, 0x2a2e36];
      for (let i = 0; i < 4; i++) {
        const k = Math.floor(Math.random() * this.leds.count);
        this.leds.setColorAt(k, tmp.c.set(palette[Math.floor(Math.random() * palette.length)]));
      }
      if (low) this.leds.setColorAt(0, tmp.c.set(pulse > 0.5 ? 0xff4d5e : 0x2a2e36));
      this.leds.instanceColor!.needsUpdate = true;
    }

    this.screens.update(dt, { km: f.km, pct: f.pct, kmps: f.kmps, fuel: f.fuel, t: f.t, roll: f.roll, pitch: f.pitch, space: f.space, threats: f.threats });
  }

  private fit(aspect: number, worldCam: THREE.PerspectiveCamera) {
    // Narrow (portrait) screens need a taller field of view to keep the pilot and window in frame.
    const narrow = Math.min(1, aspect / 1.5);
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / Math.pow(narrow, 0.7));
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(half * 2), BASE_FOV, 100);
    for (const c of [this.camera, worldCam]) {
      if (Math.abs(c.fov - fov) < 0.01) continue;
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }

  private updatePlush(dt: number, f: CockpitFrame, gDir: THREE.Vector3, G: number) {
    if (dt <= 0) return;
    const p = this.plushPos, prev = this.plushPrev, tmp = this.tmp;
    const a = tmp.a.copy(gDir).multiplyScalar(G);
    a.z += 1.5 * f.g + (f.launch > 3 ? 6 : 0);
    a.x -= f.accel.x * 0.05;
    a.y -= f.accel.y * 0.05;
    // Weightless drift once in space.
    a.x += f.space * Math.sin(this.time * 0.7) * 0.09;
    a.y += f.space * Math.sin(this.time * 0.53 + 1) * 0.09;
    a.z += f.space * Math.cos(this.time * 0.61) * 0.07;
    a.x += (Math.random() - 0.5) * f.rumble * 3;
    const v = tmp.v.copy(p).sub(prev).multiplyScalar(Math.exp(-0.9 * dt));
    prev.copy(p);
    p.add(v).addScaledVector(a, dt * dt);
    const d = tmp.v.copy(p).sub(PLUSH_ANCHOR);
    const len = d.length();
    if (len > PLUSH_STRING) p.copy(PLUSH_ANCHOR).addScaledVector(d, PLUSH_STRING / len);
    p.y = Math.min(p.y, CABIN.y1 - 0.08);

    this.plush.position.copy(p);
    this.plushSpin += dt * 0.5 * f.space;
    tmp.q.setFromUnitVectors(tmp.up.set(0, 1, 0), tmp.a.copy(PLUSH_ANCHOR).sub(p).normalize());
    this.plush.quaternion.copy(tmp.q).multiply(new THREE.Quaternion().setFromAxisAngle(tmp.up.set(0, 1, 0), this.plushSpin));

    // String: straight when taut, a lazy curve when slack.
    const slack = Math.max(0, PLUSH_STRING - len);
    const pos = this.string.geometry.attributes.position as THREE.BufferAttribute;
    const mid = tmp.a.copy(PLUSH_ANCHOR).add(p).multiplyScalar(0.5);
    mid.x += slack * 0.8;
    mid.y -= slack * 0.4;
    for (let i = 0; i < STRING_POINTS; i++) {
      const t = i / (STRING_POINTS - 1), u = 1 - t;
      pos.setXYZ(i,
        u * u * PLUSH_ANCHOR.x + 2 * u * t * mid.x + t * t * p.x,
        u * u * PLUSH_ANCHOR.y + 2 * u * t * mid.y + t * t * (p.y + 0.05),
        u * u * PLUSH_ANCHOR.z + 2 * u * t * mid.z + t * t * p.z);
    }
    pos.needsUpdate = true;
  }

  // ---------- building ----------

  private buildShell() {
    const s = this.scene, C = CABIN;
    const wallMat = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.8, side: THREE.DoubleSide });
    const w = C.x1 - C.x0, h = C.y1 - C.y0, d = C.z1 - C.z0;
    const cx = (C.x0 + C.x1) / 2, cy = (C.y0 + C.y1) / 2, cz = (C.z0 + C.z1) / 2;

    const front = new THREE.Shape();
    front.moveTo(C.x0, C.y0); front.lineTo(C.x1, C.y0); front.lineTo(C.x1, C.y1); front.lineTo(C.x0, C.y1); front.lineTo(C.x0, C.y0);
    const hole = new THREE.Path();
    roundRect(hole, WIN.x0, WIN.y0, WIN.x1, WIN.y1, WIN.r);
    front.holes.push(hole);
    const frontGeo = new THREE.ShapeGeometry(front);
    // Planar UVs so the panel texture tiles at the same scale as the side walls.
    const uv = frontGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 1.2, uv.getY(i) / 1.2);
    const frontMesh = new THREE.Mesh(frontGeo, wallMat);
    frontMesh.position.z = C.z0;

    const plane = (pw: number, ph: number, rx: number, ry: number, x: number, y: number, z: number) => {
      const g = new THREE.PlaneGeometry(pw, ph);
      const u = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < u.count; i++) u.setXY(i, (u.getX(i) * pw) / 1.2, (u.getY(i) * ph) / 1.2);
      const m = new THREE.Mesh(g, wallMat);
      m.rotation.set(rx, ry, 0);
      m.position.set(x, y, z);
      s.add(m);
    };
    plane(d, h, 0, Math.PI / 2, C.x0, cy, cz);
    plane(d, h, 0, -Math.PI / 2, C.x1, cy, cz);
    plane(w, d, Math.PI / 2, 0, cx, C.y1, cz);
    plane(w, d, -Math.PI / 2, 0, cx, C.y0, cz);
    plane(w, h, 0, Math.PI, cx, cy, C.z1);
    s.add(frontMesh);

    // Window frame and a hint of glass.
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.45, metalness: 0.5 });
    const ring = new THREE.Shape();
    roundRect(ring, WIN.x0 - 0.07, WIN.y0 - 0.07, WIN.x1 + 0.07, WIN.y1 + 0.07, WIN.r + 0.05);
    const inner = new THREE.Path();
    roundRect(inner, WIN.x0, WIN.y0, WIN.x1, WIN.y1, WIN.r);
    ring.holes.push(inner);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.09, bevelEnabled: false }), dark);
    frame.position.z = C.z0;
    const glassShape = new THREE.Shape();
    roundRect(glassShape, WIN.x0, WIN.y0, WIN.x1, WIN.y1, WIN.r);
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(glassShape), new THREE.MeshBasicMaterial({ color: 0x8fb0ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false }));
    glass.position.z = C.z0 + 0.03;
    s.add(frame, glass);

    // Ribs, deck under the window, overhead panel.
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x6d727b, roughness: 0.6, metalness: 0.3 });
    for (const z of [-0.6, 0.25, 1.1]) {
      for (const x of [C.x0 + 0.03, C.x1 - 0.03]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.08), ribMat);
        r.position.set(x, cy, z);
        s.add(r);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.08), ribMat);
      top.position.set(cx, C.y1 - 0.03, z);
      s.add(top);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.66), new THREE.MeshStandardMaterial({ color: 0x1f2227, roughness: 0.9 }));
    deck.position.set(cx, 0.92, C.z0 + 0.33);
    s.add(deck);
    const overhead = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 0.6), dark);
    overhead.position.set(0.12, C.y1 - 0.06, -0.5);
    s.add(overhead);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.012, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff1dc }));
    lamp.position.set(0.12, C.y1 - 0.1, -0.2);
    s.add(lamp);

    // Cable run along the left wall and a fire extinguisher below it.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(C.x0 + 0.06, 0.25, 1.2), new THREE.Vector3(C.x0 + 0.1, 0.42, 0.2),
      new THREE.Vector3(C.x0 + 0.08, 0.5, -0.5), new THREE.Vector3(C.x0 + 0.12, 0.85, -1.15),
    ]);
    s.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 8), new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.7 })));
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 14), new THREE.MeshStandardMaterial({ color: 0xc9372c, roughness: 0.4 }));
    ext.position.set(C.x0 + 0.1, 0.6, 0.4);
    s.add(ext);

    const list = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.26),
      new THREE.MeshStandardMaterial({ map: labelTexture(["Pre-flight checklist", "[x] Fuel", "[x] Rocket", "[x] Courage", "[ ] Snacks", "[ ] Return trip"], 256, 330, 30, "#e9e6dc", "#2a2d33"), roughness: 0.9 }),
    );
    list.position.set(1.0, 0.97, -0.8);
    list.rotation.set(-Math.PI / 2 + 0.35, 0, 0.12);
    s.add(list);
  }

  private buildConsole() {
    const g = new THREE.Group();
    g.position.set(0.08, 0.78, -0.45);
    g.rotation.x = -0.9;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.42, 0.14), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.7, metalness: 0.2 })));
    const specs: [THREE.Texture, number, number, number][] = [
      [this.screens.flight, -0.52, 0.38, 0.285],
      [this.screens.radar, 0, 0.3, 0.3],
      [this.screens.fuel, 0.47, 0.38, 0.285],
    ];
    for (const [map, x, w, h] of specs) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, toneMapped: false }));
      m.position.set(x, 0, 0.072);
      m.userData.screen = true;
      g.add(m);
    }
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 20), new THREE.MeshStandardMaterial({ color: 0xff4d5e, emissive: 0x5a0710, roughness: 0.4 }));
    btn.rotation.x = Math.PI / 2;
    btn.position.set(-0.82, -0.12, 0.08);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.03), new THREE.MeshBasicMaterial({ map: labelTexture(["Do not press"], 192, 52, 32, "#e9e6dc", "#c9372c") }));
    tag.position.set(-0.82, -0.18, 0.072);
    g.add(btn, tag);
    this.scene.add(g);
    return g;
  }

  private buildLeds(dash: THREE.Group) {
    const n = 40;
    const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.014, 0.006), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const palette = [0xffb347, 0x7dffb0, 0xeef2ff, 0x2a2e36];
    for (let i = 0; i < n; i++) {
      const row = i < 26 ? 0.175 : -0.175;
      const x = i < 26 ? -0.82 + i * 0.065 : -0.32 + (i - 26) * 0.07;
      leds.setMatrixAt(i, m.makeTranslation(x, row, 0.072));
      leds.setColorAt(i, c.set(palette[i % palette.length]));
    }
    dash.add(leds);
    return leds;
  }

  private buildSeat() {
    const s = this.scene;
    const frame = new THREE.MeshStandardMaterial({ color: 0x2f333b, roughness: 0.6, metalness: 0.3 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x434955, roughness: 0.95 });
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, y, z);
      b.rotation.x = rx;
      s.add(b);
      return b;
    };
    box(0.56, 0.1, 0.55, cushion, 0, 0.42, 0.12);
    box(0.56, 0.72, 0.12, cushion, 0, 0.83, 0.46, 0.1);
    box(0.24, 0.24, 0.1, cushion, 0, 1.38, 0.51, 0.1);
    for (const sx of [-1, 1]) {
      box(0.06, 0.5, 0.16, frame, sx * 0.3, 0.78, 0.45, 0.1);
      box(0.1, 0.06, 0.46, frame, sx * 0.34, 0.6, 0);
    }
    box(0.5, 0.36, 0.5, frame, 0, 0.2, 0.15);

    // Rotational hand controller (right) and throttle (left). Child 0 of each is the grip point.
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.7 });
    this.stick.position.set(0.34, 0.635, -0.19);
    const grip = new THREE.Object3D();
    grip.position.set(0, 0.125, 0.01);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.1, 10), metal);
    shaft.position.y = 0.05;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.08, 14), rubber);
    handle.position.y = 0.125;
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.012), new THREE.MeshStandardMaterial({ color: 0xff4d5e }));
    trigger.position.set(0, 0.13, -0.026);
    this.stick.add(grip, shaft, handle, trigger);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 14), rubber);
    boot.position.set(0.34, 0.64, -0.19);
    s.add(this.stick, boot);

    this.throttle.position.set(-0.34, 0.63, -0.17);
    const tGrip = new THREE.Object3D();
    tGrip.position.set(0, 0.1, 0);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.018), metal);
    lever.position.y = 0.045;
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.07), rubber);
    knob.position.y = 0.1;
    this.throttle.add(tGrip, lever, knob);
    s.add(this.throttle);
  }

  private buildSidePanel() {
    const g = new THREE.Group();
    g.position.set(-0.64, 0.92, -0.22);
    g.rotation.set(-0.3, 0.9, 0, "YXZ");
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 })));
    const sw = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.3, metalness: 0.6 });
    for (let i = 0; i < 8; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 6), sw);
      t.rotation.x = Math.PI / 2 - 0.4;
      t.position.set(-0.15 + (i % 4) * 0.1, i < 4 ? 0.06 : -0.06, 0.04);
      g.add(t);
    }
    this.scene.add(g);
    g.updateMatrixWorld(true);
    return g.localToWorld(new THREE.Vector3(0, 0, 0.06));
  }

  /** A plush Moon, the classic zero-g indicator. Hangs until space, then floats. */
  private buildPlush() {
    const felt = new THREE.MeshStandardMaterial({ color: 0xd2cdc2, roughness: 1 });
    const spot = new THREE.MeshStandardMaterial({ color: 0xa9a397, roughness: 1 });
    const black = new THREE.MeshBasicMaterial({ color: 0x15161a });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), felt);
    this.plush.add(ball);
    for (const [x, y, z, r] of [[0.03, 0.025, -0.035, 0.014], [-0.035, -0.02, -0.03, 0.011], [0.01, 0.04, 0.03, 0.01]]) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), spot);
      c.position.set(x, y, z).normalize().multiplyScalar(0.052);
      c.scale.z = 0.5;
      c.lookAt(0, 0, 0);
      this.plush.add(c);
    }
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 8, 6), black);
      eye.position.set(sx * 0.018, 0.008, 0.052);
      this.plush.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.003, 6, 16, Math.PI), black);
    smile.position.set(0, -0.008, 0.052);
    smile.rotation.z = Math.PI;
    this.plush.add(smile);
    this.scene.add(this.plush);
  }
}
