import * as THREE from "three";
import { canvas, colorTex } from "../world/textures";

export type HandPose = "grip" | "open" | "point" | "thumb";
export type GestureName = "checks" | "tap" | "thumbs" | "wave" | "wipe" | "point" | "shrug" | "celebrate";

/** Points in the cabin the pilot reaches for. Objects are read every frame because they move. */
export interface PilotAnchors {
  stick: THREE.Object3D;
  throttle: THREE.Object3D;
  fuelScreen: THREE.Vector3;
  flightScreen: THREE.Vector3;
  sidePanel: THREE.Vector3;
  window: THREE.Vector3;
}

export interface PilotInput {
  /** Stick command, -1..1 (right / up positive). */
  steerX: number;
  steerY: number;
  /** 0..1 acceleration pressing the pilot into the seat. */
  g: number;
  /** 0..1 vibration. */
  shake: number;
  /** A point (cabin frame) worth staring at, e.g. the nearest incoming obstacle. */
  threat: THREE.Vector3 | null;
  /** Where the plush toy is, for pointing at it. */
  plush: THREE.Vector3;
}

const UPPER = 0.32;
const FORE = 0.3;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => t * t * (3 - 2 * t);

type Key = [time: number, at: THREE.Vector3 | null];

interface Gesture {
  name: GestureName;
  dur: number;
  priority: number;
  /** Keep the final pose until reset (end-of-run reactions). */
  hold?: boolean;
  left?: Key[];
  right?: Key[];
  leftPose?: HandPose;
  rightPose?: HandPose;
  look?: (t: number) => THREE.Vector3 | null;
  lean?: (t: number) => number;
  shrug?: (t: number) => number;
  bounce?: (t: number) => number;
}

/** Piecewise smooth path through keys; a null key means "the hand's home control". */
function sample(keys: Key[], t: number, home: THREE.Vector3, out: THREE.Vector3) {
  if (t <= keys[0][0]) return out.copy(keys[0][1] ?? home);
  for (let i = 1; i < keys.length; i++) {
    const [t1, p1] = keys[i];
    if (t <= t1) {
      const [t0, p0] = keys[i - 1];
      return out.copy(p0 ?? home).lerp(p1 ?? home, ease((t - t0) / Math.max(1e-4, t1 - t0)));
    }
  }
  return out.copy(keys[keys.length - 1][1] ?? home);
}

/** Two-bone arm (shoulder → elbow → wrist) with a simple glove. */
class Arm {
  readonly hand = new THREE.Group();
  readonly target = new THREE.Vector3();
  private upper: THREE.Mesh;
  private fore: THREE.Mesh;
  private elbow: THREE.Mesh;
  private fist: THREE.Mesh;
  private thumb: THREE.Mesh;
  private fingers: THREE.Mesh;
  private index: THREE.Mesh;
  private pose: HandPose | null = null;
  private e = new THREE.Vector3();
  private w = new THREE.Vector3();
  private d = new THREE.Vector3();
  private p = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor(root: THREE.Object3D, private side: number, suit: THREE.Material, joint: THREE.Material, glove: THREE.Material, accent: THREE.Material) {
    this.upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, UPPER - 0.07, 4, 10), suit);
    this.fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, FORE - 0.06, 4, 10), suit);
    this.elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), joint);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.05, 0.05, 14), accent);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.02;
    this.fist = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.08, 0.085), glove);
    this.fist.position.z = -0.045;
    this.thumb = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.055, 0.024), glove);
    this.fingers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.072, 0.075), glove);
    this.fingers.position.z = -0.12;
    this.index = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.019, 0.075), glove);
    this.index.position.set(0, 0.022, -0.115);
    this.hand.add(cuff, this.fist, this.thumb, this.fingers, this.index);
    root.add(this.upper, this.fore, this.elbow, this.hand);
    this.setPose("grip");
  }

  setPose(p: HandPose) {
    if (p === this.pose) return;
    this.pose = p;
    this.fingers.visible = p === "open";
    this.index.visible = p === "point";
    const t = this.thumb;
    t.rotation.set(0, 0, 0);
    if (p === "thumb") t.position.set(0, 0.07, -0.03);
    else if (p === "open") {
      t.position.set(-this.side * 0.04, 0.01, -0.05);
      t.rotation.z = this.side * 0.9;
    } else {
      t.position.set(0, 0.045, -0.07);
      t.rotation.x = -1.25;
    }
  }

  /** Places the arm from shoulder `s` toward `target`, bending the elbow toward `pole`. */
  solve(s: THREE.Vector3, pole: THREE.Vector3) {
    const d = this.d.copy(this.target).sub(s);
    const len = THREE.MathUtils.clamp(d.length(), 0.08, UPPER + FORE - 0.002);
    d.normalize();
    const cosA = (UPPER * UPPER + len * len - FORE * FORE) / (2 * UPPER * len);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const p = this.p.copy(pole).sub(s);
    p.addScaledVector(d, -p.dot(d)).normalize();
    const e = this.e.copy(s).addScaledVector(d, UPPER * cosA).addScaledVector(p, UPPER * sinA);
    const w = this.w.copy(s).addScaledVector(d, len);
    this.bone(this.upper, s, e);
    this.bone(this.fore, e, w);
    this.elbow.position.copy(e);
    this.hand.position.copy(w);
    const dir = this.d.copy(w).sub(e).normalize();
    this.m.lookAt(e, w, Math.abs(dir.y) > 0.85 ? Z_AXIS : Y_AXIS);
    this.hand.quaternion.setFromRotationMatrix(this.m);
  }

  private bone(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, this.p.copy(b).sub(a).normalize());
  }
}

/**
 * The astronaut in the left seat. Hands follow the stick and throttle, the
 * head tracks whatever is coming, and small gestures play on game events.
 */
export class Pilot {
  readonly root = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private shoulderL = new THREE.Object3D();
  private shoulderR = new THREE.Object3D();
  private left: Arm;
  private right: Arm;
  private tagCanvas;
  private tagTex: THREE.CanvasTexture;
  private gesture: Gesture | null = null;
  private gt = 0;
  private time = 0;
  private yaw = 0;
  private pitch = 0;
  private flinch = 0;
  private flinchSide = 0;
  private glance = 4;
  private glanceAt: THREE.Vector3 | null = null;
  private plushAt = new THREE.Vector3();
  private tmp = {
    homeL: new THREE.Vector3(), homeR: new THREE.Vector3(), want: new THREE.Vector3(),
    sL: new THREE.Vector3(), sR: new THREE.Vector3(), pole: new THREE.Vector3(),
    neck: new THREE.Vector3(), look: new THREE.Vector3(), idle: new THREE.Vector3(),
  };

  constructor(private anchors: PilotAnchors) {
    const suit = new THREE.MeshStandardMaterial({ color: 0xcfd2d9, roughness: 0.85 });
    const joint = new THREE.MeshStandardMaterial({ color: 0x8e939c, roughness: 0.7 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x34373d, roughness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.5, emissive: 0x3a2000 });
    const shell = new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.3 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x3a2808, metalness: 1, roughness: 0.08, envMapIntensity: 2.2 });

    // Legs, seated, mostly hidden behind the console.
    for (const sx of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 10), suit);
      thigh.position.set(sx * 0.11, 0.56, -0.06);
      thigh.rotation.x = Math.PI / 2 - 0.08;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 10), suit);
      shin.position.set(sx * 0.12, 0.34, -0.3);
      shin.rotation.x = 0.25;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.2), glove);
      boot.position.set(sx * 0.12, 0.12, -0.38);
      this.root.add(thigh, shin, boot);
    }

    // Torso pivots at the hips so it can lean, sway and press into the seat.
    this.torso.position.set(0, 0.52, 0.2);
    this.root.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 14), suit);
    chest.scale.set(1.28, 1, 0.82);
    chest.position.set(0, 0.32, 0);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.07), joint);
    pack.position.set(0.02, 0.27, -0.14);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.015, 0.01), new THREE.MeshBasicMaterial({ color: 0x7dffb0 }));
    lamp.position.set(0.07, 0.3, -0.178);
    const lamp2 = lamp.clone();
    lamp2.material = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    lamp2.position.x = 0.02;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), accent);
    patch.position.set(0.12, 0.43, -0.135);
    patch.rotation.y = Math.PI + 0.35;
    const strap = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.02), strap);
      s.position.set(sx * 0.11, 0.33, -0.145);
      s.rotation.z = sx * 0.12;
      this.torso.add(s);
    }
    const t = canvas(256, 64);
    this.tagCanvas = t;
    this.tagTex = colorTex(t.c);
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.034), new THREE.MeshStandardMaterial({ map: this.tagTex, roughness: 0.8 }));
    tag.position.set(-0.11, 0.42, -0.143);
    tag.rotation.y = Math.PI - 0.3;
    this.torso.add(chest, pack, lamp, lamp2, patch, tag);
    this.setCallsign("");

    for (const [o, sx] of [[this.shoulderL, -1], [this.shoulderR, 1]] as const) {
      o.position.set(sx * 0.22, 0.48, 0.02);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.078, 14, 10), suit);
      o.add(ball);
      this.torso.add(o);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 8, 24), joint);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.57, 0.02);
    this.torso.add(ring);

    // Head pivots at the neck ring; the helmet sits above it.
    this.head.position.set(0, 0.58, 0.02);
    this.head.rotation.order = "YXZ";
    this.torso.add(this.head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 28, 20), shell);
    helmet.position.y = 0.15;
    const vis = new THREE.Mesh(new THREE.SphereGeometry(0.159, 28, 16, Math.PI * 1.5 - 0.95, 1.9, 0.72, 1.12), visor);
    vis.position.y = 0.15;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.157, 0.008, 6, 40, Math.PI), accent);
    stripe.position.y = 0.15;
    stripe.rotation.set(0, Math.PI / 2, Math.PI / 2);
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10), joint);
    light.rotation.z = Math.PI / 2;
    light.position.set(0.155, 0.2, -0.02);
    const comm = light.clone();
    comm.position.x = -0.155;
    this.head.add(helmet, vis, stripe, light, comm);

    this.left = new Arm(this.root, -1, suit, joint, glove, accent);
    this.right = new Arm(this.root, 1, suit, joint, glove, accent);
    this.reset();
  }

  /** The pilot wears your callsign. */
  setCallsign(name: string) {
    const { c, ctx } = this.tagCanvas;
    ctx.fillStyle = "#101a33";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#ffb347";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, c.width - 4, c.height - 4);
    ctx.fillStyle = "#eef2ff";
    ctx.font = '700 34px "Saira Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((name.trim() || "Pilot").slice(0, 18), c.width / 2, c.height / 2 + 2, c.width - 20);
    this.tagTex.needsUpdate = true;
  }

  reset() {
    this.gesture = null;
    this.flinch = 0;
    this.yaw = this.pitch = 0;
    this.left.setPose("grip");
    this.right.setPose("grip");
    this.anchors.throttle.getWorldPosition(this.left.target);
    this.anchors.stick.getWorldPosition(this.right.target);
  }

  /** Startle reaction; `side` is where the thing passed (+1 right). */
  startle(side: number, strength: number) {
    this.flinch = Math.max(this.flinch, strength);
    this.flinchSide = -side;
  }

  /** Plays a gesture unless a more important one is running. */
  play(name: GestureName) {
    const g = this.makeGesture(name);
    if (this.gesture && (this.gesture.hold || (this.gt < this.gesture.dur && this.gesture.priority > g.priority))) return;
    this.gesture = g;
    this.gt = 0;
  }

  update(dt: number, input: PilotInput) {
    this.time += dt;
    this.plushAt.copy(input.plush);
    const tmp = this.tmp, a = this.anchors;
    let g = this.gesture;
    if (g) {
      this.gt += dt;
      if (this.gt >= g.dur && !g.hold) g = this.gesture = null;
    }
    const gt = this.gt;

    a.throttle.getWorldPosition(tmp.homeL);
    a.stick.getWorldPosition(tmp.homeR);
    this.flinch *= Math.exp(-4.5 * dt);

    // Torso: pressed back by g, sways against the turn, leans into reaches.
    const lean = g?.lean?.(gt) ?? 0;
    const shrug = g?.shrug?.(gt) ?? 0;
    const breathe = Math.sin(this.time * 1.7) * 0.006;
    const jitter = input.shake * 0.006;
    this.torso.rotation.set(
      input.g * 0.07 - lean + (Math.random() - 0.5) * jitter,
      0,
      input.steerX * 0.07 + this.flinch * this.flinchSide * 0.06,
    );
    this.torso.position.y = 0.52 + (g?.bounce?.(gt) ?? 0) + breathe;
    this.torso.position.z = 0.2 + input.g * 0.03;
    this.shoulderL.position.y = this.shoulderR.position.y = 0.48 + shrug * 0.06;
    this.torso.updateMatrixWorld(true);

    // Hands: gesture path or home control, followed with a little lag.
    const follow = 1 - Math.exp(-16 * dt);
    const wantL = g?.left ? sample(g.left, gt, tmp.homeL, tmp.want) : tmp.homeL;
    this.left.target.lerp(wantL, follow);
    this.left.setPose(g?.left && gt < g.dur - 0.25 ? g.leftPose ?? "grip" : g?.hold ? g.leftPose ?? "grip" : "grip");
    const wantR = g?.right ? sample(g.right, gt, tmp.homeR, tmp.want) : tmp.homeR;
    this.right.target.lerp(wantR, follow);
    this.right.setPose(g?.right && (gt < g.dur - 0.25 || g.hold) ? g.rightPose ?? "grip" : "grip");

    this.shoulderL.getWorldPosition(tmp.sL);
    this.shoulderR.getWorldPosition(tmp.sR);
    this.left.solve(tmp.sL, tmp.pole.copy(tmp.sL).add(V(-0.55, -0.6, 0.45)));
    this.right.solve(tmp.sR, tmp.pole.copy(tmp.sR).add(V(0.55, -0.6, 0.45)));

    // Head: gesture focus, else the incoming threat, else idle glances.
    this.glance -= dt;
    if (this.glance <= 0) {
      this.glanceAt = this.glanceAt ? null : Math.random() < 0.5 ? a.fuelScreen : a.flightScreen;
      this.glance = this.glanceAt ? 0.7 + Math.random() * 0.4 : 3.5 + Math.random() * 4;
    }
    let look = g?.look?.(gt) ?? null;
    if (!look) look = input.threat;
    if (!look && this.glanceAt) look = this.glanceAt;
    if (!look) look = tmp.idle.set(0.3 + Math.sin(this.time * 0.37) * 0.6, 1.3 + Math.sin(this.time * 0.23) * 0.2, -3);
    this.head.getWorldPosition(tmp.neck);
    const d = tmp.look.copy(look).sub(tmp.neck);
    const yawT = THREE.MathUtils.clamp(Math.atan2(-d.x, -d.z), -1.05, 1.05);
    const pitchT = THREE.MathUtils.clamp(Math.atan2(d.y - 0.12, Math.hypot(d.x, d.z)), -0.6, 0.5);
    const k = 1 - Math.exp(-7 * dt);
    this.yaw += (yawT - this.yaw) * k;
    this.pitch += (pitchT - this.pitch) * k;
    const hj = input.shake * 0.02;
    this.head.rotation.set(
      this.pitch + input.g * 0.14 - shrug * 0.15 + (Math.random() - 0.5) * hj,
      this.yaw + this.flinch * this.flinchSide * 0.55 + (Math.random() - 0.5) * hj,
      this.flinch * this.flinchSide * -0.2,
    );
  }

  private makeGesture(name: GestureName): Gesture {
    const a = this.anchors;
    const headish = () => this.head.getWorldPosition(this.tmp.neck).clone().add(V(0, 0.15, 0));
    switch (name) {
      case "checks": {
        const sw = a.sidePanel, f = a.flightScreen;
        return {
          name, dur: 2.3, priority: 1, leftPose: "point",
          left: [[0, null], [0.45, sw.clone().add(V(0, 0.02, 0.03))], [0.6, sw], [0.75, sw.clone().add(V(0, 0.03, 0.02))],
            [1.15, f.clone().add(V(0, 0.02, 0.05))], [1.3, f], [1.45, f.clone().add(V(0, 0.02, 0.05))], [1.6, f], [2.3, null]],
          look: (t) => (t < 1.0 ? sw : t < 1.9 ? f : null),
          lean: (t) => 0.1 * Math.sin(Math.min(1, t / 2.3) * Math.PI),
        };
      }
      case "tap": {
        const s = a.fuelScreen, back = s.clone().add(V(0, 0.03, 0.06));
        return {
          name, dur: 1.6, priority: 2, rightPose: "point",
          right: [[0, null], [0.4, back], [0.52, s], [0.66, back], [0.78, s], [0.92, back], [1.04, s], [1.6, null]],
          look: (t) => (t < 1.3 ? s : null),
          lean: (t) => 0.16 * Math.sin(Math.min(1, t / 1.6) * Math.PI),
        };
      }
      case "thumbs": {
        const p = V(-0.12, 1.12, -0.36);
        return { name, dur: 1.5, priority: 1, leftPose: "thumb", left: [[0, null], [0.35, p], [1.1, p.clone().add(V(0, 0.015, 0))], [1.5, null]] };
      }
      case "wave": {
        const p = V(-0.28, 1.36, -0.32), keys: Key[] = [[0, null], [0.35, p]];
        for (let i = 1; i <= 6; i++) keys.push([0.35 + i * 0.2, p.clone().add(V(i % 2 ? 0.1 : -0.04, 0, 0))]);
        keys.push([1.95, p], [2.3, null]);
        return { name, dur: 2.3, priority: 2, leftPose: "open", left: keys, look: () => a.window.clone().add(V(-1.2, 0.5, 0)) };
      }
      case "wipe": {
        return {
          name, dur: 1.2, priority: 2, leftPose: "open",
          left: [[0, null], [0.3, V(0.1, 1.22, -0.12)], [0.62, V(-0.12, 1.23, -0.1)], [1.2, null]],
          lean: (t) => -0.05 * Math.sin(Math.min(1, t / 1.2) * Math.PI),
        };
      }
      case "point": {
        return {
          name, dur: 1.9, priority: 1, leftPose: "point",
          left: [[0, null], [0.4, V(-0.06, 1.18, -0.42)], [1.5, V(-0.06, 1.2, -0.44)], [1.9, null]],
          look: (t) => (t < 1.6 ? this.plushAt : null),
        };
      }
      case "shrug": {
        return {
          name, dur: 1.4, priority: 5, hold: true, leftPose: "open", rightPose: "open",
          left: [[0, null], [0.5, a.fuelScreen.clone().add(V(-0.1, 0.05, 0.08))], [0.9, V(-0.36, 1.0, -0.12)]],
          right: [[0, null], [0.9, V(0.36, 1.0, -0.12)]],
          shrug: (t) => ease(Math.min(1, Math.max(0, (t - 0.7) / 0.5))),
          look: (t) => (t < 0.8 ? a.fuelScreen : headish().add(V(0, -0.4, -1))),
        };
      }
      case "celebrate": {
        const up = (sx: number): Key[] => {
          const keys: Key[] = [[0, null]];
          for (let i = 0; i < 10; i++) keys.push([0.35 + i * 0.32, V(sx * 0.27, i % 2 ? 1.5 : 1.62, -0.08)]);
          return keys;
        };
        return {
          name, dur: 3.6, priority: 5, hold: true, leftPose: "grip", rightPose: "grip",
          left: up(-1), right: up(1),
          bounce: (t) => Math.abs(Math.sin(t * 9.8)) * 0.025,
          look: () => a.window.clone().add(V(0, 0.3, 0)),
        };
      }
    }
  }
}
