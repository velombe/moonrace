import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EXTERIOR_LAYER, createRocket } from "./rocket";
import { createSky } from "./sky";
import { cloudPuffTexture, padGroundTexture } from "./textures";

// Launch sequence timeline, in seconds since the countdown started.
// The countdown text (3-2-1, Liftoff) is driven by Game; these line up with it.
/** Countdown length; Game shows 3-2-1 over this. */
export const COUNT_TIME = 3.2;
/** Engines light and the pad fills with steam. */
const IGNITION_AT = 1.5;
/** Hold-downs release (countdown reads "Liftoff"). */
export const LIFTOFF_AT = 3.0;
/** Cut to the flight. */
export const LAUNCH_TIME = 6.0;
/** Whiteout as the rocket punches into the cloud deck before the cut. */
const FADE_TIME = 0.55;
/** End of the engine close-up; the long-lens tracking shot follows. */
const CLOSE_SHOT_END = LIFTOFF_AT + 0.9;

// Pad scale matches the rocket model (~3.75 units tall, so 1 unit ≈ 30 m).
const PAD_TOP = 0.85;
const SHIP_Y = PAD_TOP + 1.63;
const TOWER_X = -1.55;
const TOWER_W = 0.3;
const TOWER_TOP = PAD_TOP + 5.4;
const BEACH_Z = -40;
const PAD_SUN = new THREE.Vector3(0.8, 0.38, 0.3).normalize();
const MAX_PUFFS = 190;

export interface PadFrame {
  thrust: number;
  engineOn: boolean;
  /** 0..1 engine rumble, for camera shake and the cabin. */
  rumble: number;
  /** 0..1 whiteout at the end of the sequence. */
  fade: number;
  /** True on the frame the engines light. */
  ignitedNow: boolean;
  /** Which shot is live, for the PiP label. */
  shot: "wide" | "close" | "track";
}

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  vel: THREE.Vector3;
  age: number;
  life: number;
  s0: number;
  s1: number;
  shade: number;
  hot: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function beam(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const g = new THREE.BoxGeometry(t, a.distanceTo(b), t);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
  return g;
}

/** Lattice launch tower as a single merged mesh. */
function towerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const w = TOWER_W, cx = TOWER_X, h0 = PAD_TOP, h1 = TOWER_TOP, n = 14;
  const corners: [number, number][] = [[-w, -w], [w, -w], [w, w], [-w, w]];
  for (const [x, z] of corners) parts.push(beam(V(cx + x, h0, z), V(cx + x, h1, z), 0.06));
  for (let i = 0; i <= n; i++) {
    const y = h0 + ((h1 - h0) * i) / n, y2 = h0 + ((h1 - h0) * (i + 1)) / n;
    for (let k = 0; k < 4; k++) {
      const [x1, z1] = corners[k], [x2, z2] = corners[(k + 1) % 4];
      parts.push(beam(V(cx + x1, y, z1), V(cx + x2, y, z2), 0.035));
      if (i < n) {
        parts.push(i % 2
          ? beam(V(cx + x1, y, z1), V(cx + x2, y2, z2), 0.024)
          : beam(V(cx + x2, y, z2), V(cx + x1, y2, z1), 0.024));
      }
    }
  }
  parts.push(beam(V(cx, h1, 0), V(cx, h1 + 0.4, 0), 0.1));
  parts.push(beam(V(cx - 0.6, h1 + 0.4, 0), V(cx + 1.15, h1 + 0.4, 0), 0.12));
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * The launch pad: its own little world with sky, coast, tower, swing arms,
 * steam and smoke, plus the camera that films the launch.
 */
export class LaunchPad {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 7000);
  readonly rocket;
  private sky = createSky();
  private arms: { pivot: THREE.Object3D; from: number; dur: number; swing: number }[] = [];
  private puffs: Puff[] = [];
  private nextPuff = 0;
  private emit = { vent: 0, trench: 0, base: 0, trail: 0 };
  private flash: THREE.Sprite;
  private padLight = new THREE.PointLight(0xff9a40, 0, 34, 1.4);
  private look = new THREE.Vector3();
  private ignited = false;
  private shot: PadFrame["shot"] = "wide";
  private frame: PadFrame = { thrust: 0, engineOn: false, rumble: 0, fade: 0, ignitedNow: false, shot: "wide" };

  constructor(glowTex: THREE.Texture) {
    const s = this.scene;
    s.fog = new THREE.Fog(0xc6e0f7, 90, 1500);
    this.camera.layers.enable(EXTERIOR_LAYER);
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.uSun.value = PAD_SUN.clone();
    skyMat.uniforms.uSpace.value = 0;
    s.add(this.sky);

    // Softer than the flight scene: the rocket faces the sun here and is mostly white paint.
    s.add(new THREE.HemisphereLight(0xcfe0ff, 0x5a5040, 0.45 * Math.PI));
    const sun = new THREE.DirectionalLight(0xfff0d8, 0.95 * Math.PI);
    sun.position.copy(PAD_SUN).multiplyScalar(100);
    s.add(sun);
    this.padLight.position.set(0, PAD_TOP + 0.4, 0);
    s.add(this.padLight);

    this.buildGround();
    this.buildPad();
    this.buildProps();

    this.rocket = createRocket(glowTex);
    s.add(this.rocket.ship);

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flash.position.set(0, PAD_TOP + 0.15, 0);
    s.add(this.flash);

    const puffMap = cloudPuffTexture();
    for (let i = 0; i < MAX_PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({ map: puffMap, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      s.add(sprite);
      this.puffs.push({ sprite, mat, vel: new THREE.Vector3(), age: 0, life: 0, s0: 1, s1: 1, shade: 1, hot: 0 });
    }
    this.reset();
  }

  /** Puts the rocket back on the pad with the arms attached. */
  reset() {
    const ship = this.rocket.ship;
    ship.position.set(0, SHIP_Y, 0);
    ship.rotation.set(Math.PI / 2, 0, 0);
    ship.visible = true;
    this.rocket.setThrust(0, false);
    this.arms.forEach((a) => (a.pivot.rotation.y = 0));
    this.puffs.forEach((p) => {
      p.sprite.visible = false;
      p.age = p.life = 0;
    });
    this.emit = { vent: 0, trench: 0, base: 0, trail: 0 };
    this.ignited = false;
    this.flash.scale.setScalar(0.001);
    this.padLight.intensity = 0;
    this.look.set(-0.5, 3, 0);
  }

  /** Advances the sequence to `lt` seconds after the countdown started. */
  update(dt: number, lt: number): PadFrame {
    const f = this.frame;
    const ship = this.rocket.ship;
    const at = Math.max(0, lt - LIFTOFF_AT);

    f.ignitedNow = !this.ignited && lt >= IGNITION_AT;
    if (f.ignitedNow) this.ignited = true;
    const ign = smooth(IGNITION_AT, IGNITION_AT + 0.9, lt);
    f.engineOn = lt >= IGNITION_AT;
    f.thrust = f.engineOn ? 0.35 + 0.95 * ign + 0.2 * Math.min(1, at) : 0;
    this.rocket.setThrust(f.thrust, f.engineOn);

    // Ascent: slow off the pad, then accelerating, pitching downrange over the ocean.
    const h = 0.7 * at * at + 0.37 * at * at * at;
    const pitch = 0.55 * smooth(1.0, 3.2, at);
    ship.position.set(0, SHIP_Y + h, -0.35 * h * pitch);
    ship.rotation.set(Math.PI / 2 - pitch, 0, 0);

    for (const a of this.arms) a.pivot.rotation.y = a.swing * smooth(a.from, a.from + a.dur, lt);

    const fire = ign * (1 - smooth(0.5, 3, at));
    this.flash.scale.setScalar(fire > 0 ? (3 + 8 * fire) * rand(0.88, 1.12) : 0.001);
    this.flash.material.opacity = Math.min(1, fire * 1.2);
    this.padLight.intensity = fire * rand(7, 11) * Math.PI;

    this.updateSmoke(dt, lt, at, ign, h);

    f.rumble = f.engineOn ? Math.min(1, 0.35 + 0.65 * ign + 0.3 * Math.min(1, at)) : 0;
    f.fade = smooth(LAUNCH_TIME - FADE_TIME, LAUNCH_TIME, lt);
    this.film(dt, lt, f.rumble);
    f.shot = this.shot;
    return f;
  }

  // ---------- building ----------

  private buildGround() {
    const s = this.scene;
    const map = padGroundTexture();
    map.repeat.set(160, 80);
    const landLen = 2000 - BEACH_Z;
    const land = new THREE.Mesh(new THREE.PlaneGeometry(4000, landLen), new THREE.MeshStandardMaterial({ map, roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.z = BEACH_Z + landLen / 2;
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(4000, 7), new THREE.MeshStandardMaterial({ color: 0xd9cba6, roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.z = BEACH_Z - 3.5;
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 4000), new THREE.MeshStandardMaterial({ color: 0x2b6386, roughness: 0.22, metalness: 0.1 }));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.z = BEACH_Z - 7 - 2000;
    s.add(land, beach, ocean);

    // Crawlerway leading inland from the pad.
    const crawler = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 400), new THREE.MeshStandardMaterial({ color: 0xa69f90, roughness: 1 }));
    crawler.rotation.set(-Math.PI / 2, 0, 0.7);
    crawler.position.set(-140, 0.012, 160);
    s.add(crawler);
  }

  private buildPad() {
    const s = this.scene;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 });
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 0.02, 64), concrete);
    apron.position.y = 0.01;
    const hard = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 0.35, 48), concrete);
    hard.position.y = 0.175;
    // Flame trench openings on either side, where the exhaust escapes.
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 1 });
    for (const sx of [-1, 1]) {
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 1.6), dark);
      mouth.position.set(sx * 7.9, 0.15, 0);
      s.add(mouth);
    }
    const mlp = new THREE.Mesh(new THREE.BoxGeometry(3.6, PAD_TOP - 0.35, 2.8), new THREE.MeshStandardMaterial({ color: 0x575a60, roughness: 0.8, metalness: 0.2 }));
    mlp.position.y = 0.35 + (PAD_TOP - 0.35) / 2;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05), dark);
    hole.rotation.x = -Math.PI / 2;
    hole.position.y = PAD_TOP + 0.003;
    s.add(apron, hard, mlp, hole);
    const post = new THREE.BoxGeometry(0.1, 0.14, 0.1), postMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.7 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, p = new THREE.Mesh(post, postMat);
      p.position.set(Math.cos(a) * 0.55, PAD_TOP + 0.07, Math.sin(a) * 0.55);
      s.add(p);
    }

    const red = new THREE.MeshStandardMaterial({ color: 0xb8452e, roughness: 0.65, metalness: 0.25 });
    s.add(new THREE.Mesh(towerGeometry(), red));

    // Swing arms. The crew access arm goes early; the rest swing clear at liftoff.
    const armMat = new THREE.MeshStandardMaterial({ color: 0x8d3424, roughness: 0.7, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.6 });
    const reach = TOWER_X + TOWER_W, len = -0.42 - reach;
    const specs: [number, number, number, boolean][] = [
      [4.35, 0.3, 1.0, true],
      [3.3, LIFTOFF_AT - 0.12, 0.6, false],
      [2.25, LIFTOFF_AT - 0.04, 0.6, false],
      [1.45, LIFTOFF_AT + 0.04, 0.6, false],
    ];
    for (const [y, from, dur, crew] of specs) {
      const pivot = new THREE.Group();
      pivot.position.set(reach, y, 0);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(len, crew ? 0.14 : 0.08, crew ? 0.16 : 0.1), armMat);
      arm.position.x = len / 2;
      pivot.add(arm);
      if (crew) {
        const room = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.22), white);
        room.position.x = len - 0.06;
        pivot.add(room);
      }
      s.add(pivot);
      this.arms.push({ pivot, from, dur, swing: crew ? -1.45 : 1.3 });
    }
  }

  private buildProps() {
    const s = this.scene;
    const metal = new THREE.MeshStandardMaterial({ color: 0xb4b6b8, roughness: 0.5, metalness: 0.4 });
    const mast = new THREE.CylinderGeometry(0.035, 0.06, 7.8, 8);
    for (const a of [2.0, 3.6, 5.3]) {
      const m = new THREE.Mesh(mast, metal);
      m.position.set(Math.cos(a) * 9.5, 3.9, Math.sin(a) * 9.5);
      s.add(m);
    }
    const tank = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe6e4dd, roughness: 0.5 }));
    tank.position.set(14, 4.6, -15);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 4, 10), metal);
    leg.position.set(14, 2, -15);
    s.add(tank, leg);

    // Distant assembly building and support sheds for scale.
    const bldg = new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.85 });
    const vab = new THREE.Mesh(new THREE.BoxGeometry(6.6, 5.6, 7.4), bldg);
    vab.position.set(-58, 2.8, 26);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.05, 4.8, 1.3), new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.8 }));
    door.position.set(-54.68, 2.4, 26);
    s.add(vab, door);
    for (const [x, z, w, h, d] of [[-30, 14, 3, 1, 2], [22, 18, 2.4, 0.8, 1.6], [-14, -22, 2, 0.7, 3]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bldg);
      b.position.set(x, h / 2, z);
      s.add(b);
    }

    // Coastal scrub, scattered for scale and depth.
    const bushes = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x3d4a2a, roughness: 1, flatShading: true }), 520);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    while (n < 520) {
      const a = Math.random() * Math.PI * 2, r = 28 + Math.pow(Math.random(), 0.7) * 420;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      if (p.z < BEACH_Z + 4) continue;
      const k = rand(0.5, 1.6);
      sc.set(k * rand(1, 1.8), k * rand(0.5, 0.9), k * rand(1, 1.8));
      q.setFromEuler(new THREE.Euler(0, Math.random() * 6, 0));
      bushes.setMatrixAt(n++, m.compose(p, q, sc));
    }
    s.add(bushes);
  }

  // ---------- smoke ----------

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, s0: number, s1: number, shade: number, hot: number) {
    const p = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % this.puffs.length;
    p.sprite.position.copy(pos);
    p.vel.copy(vel);
    p.age = 0;
    p.life = life;
    p.s0 = s0;
    p.s1 = s1;
    p.shade = shade;
    p.hot = hot;
    p.mat.rotation = Math.random() * Math.PI * 2;
    p.sprite.visible = true;
  }

  private updateSmoke(dt: number, lt: number, at: number, ign: number, h: number) {
    const e = this.emit;
    const ship = this.rocket.ship.position;
    // Liquid oxygen boil-off venting down the sides before ignition.
    if (lt < IGNITION_AT + 0.3) {
      e.vent += dt * 8;
      while (e.vent >= 1) {
        e.vent--;
        const a = Math.random() * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        this.spawn(V(c * 0.42, ship.y + rand(-0.4, 1.4), s * 0.42), V(c * 0.5, -0.35, s * 0.5), 2.4, 0.25, 1.5, 0.72, 0);
      }
    }
    if (lt >= IGNITION_AT) {
      const pour = ign * (1 - smooth(4, 14, h));
      // Exhaust deflected out of both ends of the flame trench.
      e.trench += dt * 46 * pour;
      while (e.trench >= 1) {
        e.trench--;
        const sx = Math.random() < 0.5 ? -1 : 1;
        this.spawn(V(sx * 8.4, 0.5, rand(-0.6, 0.6)), V(sx * rand(6, 12), rand(0.4, 2.6), rand(-2.4, 2.4)), rand(3.5, 5.5), 1.6, rand(8, 13), rand(0.55, 0.7), 0.5);
      }
      // Steam boiling up around the launcher.
      e.base += dt * 26 * pour;
      while (e.base >= 1) {
        e.base--;
        const a = Math.random() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), r = rand(0.7, 1.6);
        this.spawn(V(c * r, PAD_TOP + rand(-0.2, 0.3), s * r), V(c * rand(2, 4.5), rand(0.4, 2.2), s * rand(2, 4.5)), rand(2.4, 3.6), 1, rand(4, 6.5), rand(0.6, 0.74), 1);
      }
    }
    // Exhaust column trailing the climbing rocket.
    if (at > 0 && h < 40) {
      e.trail += dt * 30;
      while (e.trail >= 1) {
        e.trail--;
        this.spawn(V(ship.x + rand(-0.3, 0.3), ship.y - 2.4 - Math.random() * 1.2, ship.z + rand(-0.3, 0.3)), V(rand(-0.6, 0.6), rand(-1.5, 0), rand(-0.6, 0.6)), rand(3, 4.5), 0.9, rand(3.5, 5.5), rand(0.6, 0.72), 0.8);
      }
    }

    const fire = ign * (1 - smooth(0.5, 3, at));
    const drag = Math.exp(-0.9 * dt);
    for (const p of this.puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        continue;
      }
      const k = p.age / p.life;
      p.vel.multiplyScalar(drag);
      p.vel.y += 0.3 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.sprite.position.y < 0.2) p.sprite.position.y = 0.2;
      const size = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k));
      p.sprite.scale.set(size, size * 0.85, 1);
      p.mat.opacity = Math.min(1, p.age / 0.15) * Math.min(1, (1 - k) / 0.45) * 0.88;
      const glow = p.hot * fire * Math.exp(-p.age * 2.2);
      p.mat.color.setRGB(p.shade + glow * 0.45, p.shade + glow * 0.08, p.shade - glow * 0.35);
    }
  }

  // ---------- camera ----------

  private film(dt: number, lt: number, rumble: number) {
    const cam = this.camera, ship = this.rocket.ship.position;
    let fov: number, shake: number;
    if (lt < IGNITION_AT) {
      // Wide establishing shot, slow push in.
      this.shot = "wide";
      const k = smooth(0, IGNITION_AT, lt);
      cam.position.set(10.5 - 1.9 * k, 1.1 + 0.25 * k, 15.5 - 2.7 * k);
      this.look.set(-0.5, 3.0, 0);
      fov = 38;
      shake = 0;
    } else if (lt < CLOSE_SHOT_END) {
      // Low close-up on the engines as they light and the clamps let go.
      this.shot = "close";
      const k = smooth(IGNITION_AT, CLOSE_SHOT_END, lt);
      cam.position.set(3.1 - 0.3 * k, 0.95, 4.4 - 0.4 * k);
      this.look.set(0, 1.5 + 0.9 * k, 0);
      fov = 48;
      shake = 0.05 * rumble;
    } else {
      // Long-lens tracking shot from the press site.
      if (this.shot !== "track") this.look.copy(ship).y += 0.6;
      this.shot = "track";
      cam.position.set(17, 0.9, 26);
      this.look.lerp(V(ship.x, ship.y + 0.6, ship.z), 1 - Math.exp(-5 * dt));
      fov = 24;
      shake = 0.025 * rumble;
    }
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.look);
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
    }
    this.sky.position.copy(cam.position);
  }
}
