import * as THREE from "three";
import { AudioEngine } from "./audio/AudioEngine";
import { Voice } from "./audio/Voice";
import { Chatter, type ChatterView, type Quote } from "./chatter";
import { Cockpit, type Threat } from "./cockpit/Cockpit";
import {
  CHARGE_CLOSE, CHARGE_RAZOR, CHARGE_STREAK, DEFLECTOR_ARM_KM, FUEL_BURN, FUEL_PICKUP, JUNK_CLEANUP_FUEL, MAX_BOOST,
  MILESTONES, MOON_KM, SPLIT_RADIUS, TOTAL_UNITS, formatKm, formatPct, kmAt, speedAt, unitsAt, type EndReason,
} from "./constants";
import { Deflector } from "./deflector";
import { Observatory } from "./observatory";
import { LandingSite, type SpotId } from "./surface/LandingSite";
import type { Planting } from "./surface/plantings";
import { Rng, fx } from "./rng";
import { ViewRenderer, type View } from "./views";
import { createEarth, EARTH_RADIUS } from "./world/earth";
import { COUNT_TIME, LAUNCH_TIME, LIFTOFF_AT, LaunchPad, type PadFrame } from "./world/launchpad";
import { createMoon } from "./world/moon";
import { LANE_X, LANE_Y, ObjectFactory, disposeCloud, type WorldObject } from "./world/obstacles";
import { EXTERIOR_LAYER, createRocket } from "./world/rocket";
import { SUN_DIR, createSky, createStars } from "./world/sky";
import { moonSurface, moonSurfaceJob, radialTexture } from "./world/textures";
import type { MoonSurface } from "./world/moon";

export type GameState = "title" | "count" | "play" | "ending" | "over" | "observe" | "landing" | "surface";

/** A test flight starts part-way to the Moon, can't crash and is never submitted. */
export interface TestFlight {
  /** Start this far along, as a percentage of the distance to the Moon. */
  startPct: number;
}

export interface HudRefs {
  root: HTMLElement;
  km: HTMLElement;
  pct: HTMLElement;
  marker: HTMLElement;
  fill: HTMLElement;
  clock: HTMLElement;
  fuelPct: HTMLElement;
  fuelBar: HTMLElement;
  toast: HTMLElement;
  toastTitle: HTMLElement;
  toastDetail: HTMLElement;
  count: HTMLElement;
  nearMiss: HTMLElement;
  nearMissTitle: HTMLElement;
  nearMissDetail: HTMLElement;
  edgeLeft: HTMLElement;
  edgeRight: HTMLElement;
  flares: HTMLElement[];
  chatter: ChatterView;
  /** Whiteout used to cut from the launch pad into the flight. */
  fade: HTMLElement;
  /** Picture-in-picture frame; the game renders into its rectangle. Click swaps views. */
  pip: HTMLElement;
  pipLabel: HTMLElement;
  /** Observatory landmark markers, in LANDMARKS order, and the altitude readout. */
  moonMarks: HTMLElement[];
  moonAlt: HTMLElement;
  /** Name labels over flags and panels at the landing site, in plantings order. */
  siteLabels: HTMLElement[];
  /** Deflector: the lock reticle (with its target label) and one charge pip per slot. */
  reticle: HTMLElement;
  reticleLabel: HTMLElement;
  deflectorPips: HTMLElement[];
}

export interface RunResult {
  km: number;
  pct: number;
  reason: EndReason;
  durationMs: number;
  closeCalls: number;
  bestStreak: number;
  lastMilestone: string | null;
  quote: Quote | null;
  /** Deflector shots fired, and what they took out. */
  shots: number;
  asteroids: number;
  satellites: number;
  junk: number;
  /** True for test flights: don't submit, don't count as a best. */
  test: boolean;
}

export interface GameEvents {
  onStateChange?: (s: GameState) => void;
  /** A flag or panel was tapped at the landing site (id), or the close-up was left by tapping away (null). */
  onFocusPlanting?: (id: string | null) => void;
  onGameOver: (r: RunResult) => void;
}

const FLARES: [number, number, string][] = [
  [0, 260, "radial-gradient(circle,rgba(255,240,215,.55),rgba(255,190,120,.12) 45%,transparent 70%)"],
  [0.35, 60, "radial-gradient(circle,transparent 50%,rgba(140,190,255,.22) 62%,transparent 72%)"],
  [0.7, 26, "radial-gradient(circle,rgba(255,200,140,.35),transparent 70%)"],
  [1.15, 110, "radial-gradient(circle,rgba(120,255,200,.08),rgba(120,160,255,.1) 55%,transparent 70%)"],
  [1.5, 44, "radial-gradient(circle,rgba(255,170,90,.25),transparent 70%)"],
];

interface Fx {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  max: number;
  kind: "bit" | "fire";
}

/** Small box shared by every chip a deflector hit knocks off. */
const CHIP_GEO = new THREE.BoxGeometry(0.22, 0.16, 0.3);

export class Game {
  readonly audio = new AudioEngine();
  readonly voice: Voice;
  private chatter: Chatter;

  private renderer: THREE.WebGLRenderer;
  private views: ViewRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(60, 1, 0.1, 7000);
  private sky = createSky();
  private stars = createStars(2600, 1.3);
  private brightStars = createStars(260, 2.6);
  private sun: THREE.Sprite;
  private earth = createEarth();
  private moon = createMoon(moonSurface());
  private observatory: Observatory | null = null;
  /** The detailed Moon for the observatory, built a slice at a time while the title screen idles. */
  private surfaceJob: Generator<void, MoonSurface> | null = moonSurfaceJob(2048, 1024);
  private idleTime = 0;
  private lowEnd = false;
  private test: TestFlight | null = null;
  /** The landing site, built on the first arrival. */
  private site: LandingSite | null = null;
  private plantings: Planting[] = [];
  private rocket;
  private factory = new ObjectFactory();
  private glowTex: THREE.Texture;
  private fog = new THREE.Fog(0xc6e0f7, 200, 520);

  private objects: WorldObject[] = [];
  private deflector: Deflector;
  /** Seeded per run but separate from `rng`, so fragments never shift the daily layout. */
  private debrisRng = new Rng(1);
  private armAt = -1;
  private armedSaid = true;
  private notAuthSaid = false;
  private kills = { asteroids: 0, satellites: 0, junk: 0 };
  private clouds: THREE.Group[] = [];
  private effects: Fx[] = [];

  private state: GameState = "title";
  private rng = new Rng(1);
  private t = 0;
  private dist = 0;
  private speed = 0;
  private km = 0;
  private fuel = 100;
  private nextObstacle = 0;
  private nextFuel = 0;
  private nextCloud = 0;
  private milestoneIndex = 0;
  private lastMilestone: string | null = null;
  private reason: EndReason = "fuel";
  private endTimer = 0;
  private countdown = 0;
  private lastCount: number | null = null;
  private lowWarned = false;
  private alarmTimer = 0;
  private toastTimer = 0;
  private tipSaid = false;
  private asteroidsSaid = false;
  private quote: Quote | null = null;
  private runs = 0;

  private closeCalls = 0;
  private streak = 0;
  private bestStreak = 0;
  private lastNearMiss = -9;
  private lastSlowmo = -9;
  private boost = 0;
  private slowmo = 0;
  private camKick = 0;

  private target = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private keys: Record<string, boolean> = {};
  private touchId: number | null = null;
  private touchX = 0;
  private touchY = 0;

  // Launch pad, cabin and the two views (outside / cabin) shown big or in the PiP.
  private pad: LaunchPad;
  private padFrame: PadFrame | null = null;
  private cockpit: Cockpit;
  private cabinCam = new THREE.PerspectiveCamera(62, 1, 0.1, 7000);
  private chaseView: View;
  private padView: View;
  private cabinFlight: View;
  private cabinPad: View;
  private preferCabin = false;
  private signalLost = false;
  private canSkip = false;
  private fade = 0;
  private flaresOn = true;
  private threats: Threat[] = [];
  private lastVel = new THREE.Vector2();
  private accel = new THREE.Vector2();
  private lastKm = 0;
  private kmps = 0;

  private camOffset = new THREE.Vector3(10, 3, 10);
  private lookOffset = new THREE.Vector3();
  private orbit = 0.8;
  private raf = 0;
  private last = performance.now();
  private hudCache: Record<string, string> = {};
  private disposers: (() => void)[] = [];

  constructor(private container: HTMLElement, private hud: HudRefs, private events: GameEvents) {
    const lowEnd = matchMedia("(pointer: coarse)").matches && (navigator.hardwareConcurrency || 4) <= 4;
    this.lowEnd = lowEnd;
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : 2));
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";

    this.voice = new Voice(this.audio);
    this.chatter = new Chatter(hud.chatter, this.audio, this.voice);
    try {
      this.runs = parseInt(localStorage.getItem("moonrace-runs") || "0") || 0;
      this.preferCabin = localStorage.getItem("moonrace-view") === "cabin";
    } catch {}

    this.glowTex = radialTexture([[0, "rgba(255,255,255,1)"], [0.12, "rgba(255,244,220,.95)"], [0.35, "rgba(255,190,110,.25)"], [1, "rgba(255,150,60,0)"]], 256);
    this.rocket = createRocket(this.glowTex);
    this.deflector = new Deflector(this.scene, this.glowTex);
    this.cam.layers.enable(EXTERIOR_LAYER);

    this.views = new ViewRenderer(this.renderer, lowEnd);
    this.pad = new LaunchPad(this.glowTex);
    this.cockpit = new Cockpit(this.renderer);
    this.chaseView = { scene: this.scene, camera: this.cam };
    this.padView = { scene: this.pad.scene, camera: this.pad.camera };
    this.cabinFlight = this.cockpit.view(this.scene, this.cabinCam);
    this.cabinPad = this.cockpit.view(this.pad.scene, this.cabinCam);

    const s = this.scene;
    s.fog = this.fog;
    s.add(this.sky, this.stars, this.brightStars, this.earth.group, this.moon.mesh, this.rocket.ship);
    s.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1a22, 0.45 * Math.PI));
    const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.6 * Math.PI);
    sunLight.position.copy(SUN_DIR).multiplyScalar(100);
    s.add(sunLight);
    const fill = new THREE.DirectionalLight(0x6f9cff, 0.45 * Math.PI);
    fill.position.set(-0.4, -0.6, 1).multiplyScalar(100);
    s.add(fill);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
    this.sun.scale.setScalar(900);
    s.add(this.sun);

    hud.flares.forEach((el, i) => {
      el.style.width = el.style.height = FLARES[i][1] + "px";
      el.style.background = FLARES[i][2];
    });

    for (let z = 40; z > -320; z -= 26) this.addCloud(z, false);
    this.bindInput();
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ---------- public API ----------

  /** Starts a run. Must be called from a user gesture so audio can start. */
  start(seed: number, test: TestFlight | null = null) {
    this.hud.root.classList.remove("observing", "on-surface", "first-person");
    this.audio.init();
    this.voice.prepare();
    this.chatter.clear(true);
    this.clearWorld();
    this.rng = new Rng(seed);
    this.debrisRng = new Rng(seed ^ 0x5f3759df);
    this.deflector.reset();
    this.armAt = -1;
    this.armedSaid = true;
    this.notAuthSaid = false;
    this.kills = { asteroids: 0, satellites: 0, junk: 0 };
    this.hud.root.classList.remove("armed");
    this.state = "count";
    this.countdown = COUNT_TIME;
    this.lastCount = null;
    this.t = this.dist = this.km = 0;
    this.fuel = 100;
    this.milestoneIndex = 0;
    this.lastMilestone = null;
    this.lowWarned = false;
    this.alarmTimer = 0;
    this.nextObstacle = 90;
    this.nextFuel = 90;
    this.nextCloud = 0;
    this.closeCalls = this.streak = this.bestStreak = 0;
    this.lastNearMiss = this.lastSlowmo = -9;
    this.boost = this.slowmo = this.camKick = 0;
    this.tipSaid = this.asteroidsSaid = false;
    this.quote = null;
    this.runs++;
    let callsign = "";
    try {
      localStorage.setItem("moonrace-runs", String(this.runs));
      callsign = localStorage.getItem("moonrace-callsign") || "";
    } catch {}
    const ship = this.rocket.ship;
    ship.position.set(0, 0, 0);
    ship.rotation.set(0, 0, 0);
    ship.visible = true;
    this.target.set(0, 0);
    this.vel.set(0, 0);
    this.lastVel.set(0, 0);
    this.lastKm = this.kmps = 0;
    this.pad.reset();
    this.padFrame = null;
    this.cockpit.reset(callsign);
    this.signalLost = false;
    this.hud.pip.classList.remove("lost");
    // The first launch always plays in full; after that it can be skipped.
    this.canSkip = this.runs > 1;
    this.hud.root.classList.toggle("can-skip", this.canSkip);
    this.hud.root.classList.add("playing");
    if (!test || test.startPct <= 0) for (let z = -30; z > -500; z -= 16) this.addCloud(z, false);
    this.test = test;
    this.hud.root.classList.toggle("test-flight", !!test);
    if (test) {
      // Jump ahead: top speed, past the earlier milestones, straight out of the launch.
      this.dist = unitsAt((MOON_KM * THREE.MathUtils.clamp(test.startPct, 0, 99.5)) / 100);
      this.km = kmAt(this.dist);
      this.t = 84;
      while (this.milestoneIndex < MILESTONES.length && MILESTONES[this.milestoneIndex].km <= this.km) this.milestoneIndex++;
      this.nextObstacle = 120;
      this.canSkip = true;
      this.countdown = COUNT_TIME - (LAUNCH_TIME - 0.35);
      this.tipSaid = true;
      // Test flights start armed and fully charged, to try the deflector straight away.
      if (this.km >= DEFLECTOR_ARM_KM) {
        this.deflector.arm(true);
        this.hud.root.classList.add("armed");
      }
    }
    this.setState("count");
  }

  setMuted(m: boolean) {
    this.audio.init();
    this.audio.setMuted(m);
    if (m) this.voice.stop();
  }

  setVoice(on: boolean) {
    this.voice.prepare();
    this.voice.setEnabled(on);
  }

  /** Fires the deflector (click, Space, second finger, or the fire button). */
  fire() {
    if (this.state !== "play") return;
    const r = this.deflector.fire(this.rocket.ship.position);
    if (r === "fired") {
      this.audio.deflectorFire();
      this.cockpit.fire();
      this.camKick = Math.max(this.camKick, 0.25);
      return;
    }
    this.audio.deflectorDenied();
    if (r === "unarmed" && this.km < DEFLECTOR_ARM_KM && !this.notAuthSaid) this.notAuthSaid = !!this.chatter.say("notAuthorized", 1);
    else if (r === "hot") this.chatter.say("overheat", 1, 0.4);
  }

  /** Swaps the big screen and the picture-in-picture (outside ↔ cabin). Remembered. */
  toggleView() {
    this.preferCabin = !this.preferCabin;
    try {
      localStorage.setItem("moonrace-view", this.preferCabin ? "cabin" : "chase");
    } catch {}
  }

  /** Opens the lunar observatory. Call from a user gesture (starts audio). The first visit builds a detailed Moon (~1 s). */
  observe() {
    if (this.state !== "title" && this.state !== "over") return;
    this.audio.init();
    if (!this.observatory) this.buildSurface(Infinity);
    this.observatory!.reset(this.container.clientWidth / Math.max(1, this.container.clientHeight));
    this.chatter.clear(true);
    this.hud.root.classList.add("observing");
    this.setState("observe");
  }

  /** Runs the detailed-Moon job for up to `budgetMs`; installs it when finished. */
  private buildSurface(budgetMs: number) {
    const job = this.surfaceJob;
    if (!job) return;
    const end = performance.now() + budgetMs;
    let r = job.next();
    while (!r.done && performance.now() < end) r = job.next();
    if (!r.done) return;
    this.surfaceJob = null;
    const surface = r.value;
    this.observatory = new Observatory(surface);
    // The in-flight Moon gets the sharper surface too, which shows on arrival.
    const u = this.moon.material.uniforms;
    (u.uMap.value as THREE.Texture).dispose();
    (u.uBump.value as THREE.Texture).dispose();
    u.uMap.value = surface.map;
    u.uBump.value = surface.bump;
    const img = surface.bump.image as { width: number; height: number };
    (u.uTexel.value as THREE.Vector2).set(1 / img.width, 1 / img.height);
  }

  /** Flags and panels at the landing site (oldest first). */
  setPlantings(list: Planting[]) {
    this.plantings = list;
    this.site?.setPlantings(list);
  }

  /** Walks to the flag field and plants it. Call before passing the new list to setPlantings(). */
  plant(p: Planting) {
    this.site?.plant(p);
  }

  walkTo(id: SpotId) {
    this.site?.walkTo(id);
  }

  /** Walk up to a planting for a close look (id), or step back (null). Returns false if it can't. */
  focusPlanting(id: string | null) {
    if (!this.site || this.state !== "surface") return false;
    if (id === null) {
      this.site.unfocus();
      return true;
    }
    return this.site.focus(id);
  }

  /** Straight to the landing site, for testing (?test=surface). Call from a user gesture. */
  landTest() {
    if (this.state !== "title") return;
    this.audio.init();
    this.reason = "moon";
    this.enterSite();
  }

  private enterSite() {
    if (!this.site) {
      this.site = new LandingSite(this.glowTex, this.earth.group, this.lowEnd);
      this.site.setPlantings(this.plantings);
    }
    this.site.beginLanding();
    this.fade = 1;
    this.hud.root.classList.remove("playing");
    this.setState("landing");
  }

  leaveObservatory() {
    if (this.state !== "observe") return;
    this.hud.root.classList.remove("observing");
    this.setState("title");
  }

  /** Turns the observatory toward a landmark (LANDMARKS id). */
  focusLandmark(id: string) {
    this.observatory?.focus(id);
  }

  /** Low sun shows crater shadows; high sun is the flat full Moon. */
  setMoonSun(low: boolean) {
    this.observatory?.setLowSun(low);
  }

  /** Jumps to the end of the launch sequence (not on a player's first launch). */
  skipLaunch() {
    if (this.state !== "count" || !this.canSkip || COUNT_TIME - this.countdown < 0.4) return;
    this.countdown = Math.min(this.countdown, COUNT_TIME - (LAUNCH_TIME - 0.35));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.voice.stop();
    void this.audio.ctx?.close();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- internals ----------

  private setState(s: GameState) {
    this.state = s;
    this.hud.root.classList.toggle("on-surface", s === "landing" || s === "surface");
    this.hud.root.classList.toggle("first-person", s === "surface");
    const live = s === "count" || s === "play" || s === "ending";
    this.hud.root.classList.toggle("pip-on", live);
    if (s !== "count") this.hud.root.classList.remove("can-skip");
    if (s === "count") this.measurePip();
    this.events.onStateChange?.(s);
  }

  private measurePip() {
    const c = this.container.getBoundingClientRect(), p = this.hud.pip.getBoundingClientRect();
    this.views.setPipRect({ x: p.left - c.left, y: p.top - c.top, w: p.width, h: p.height });
  }

  private bindInput() {
    const el = this.renderer.domElement;
    const onMove = (e: PointerEvent) => {
      if (this.state === "observe") return this.observatory?.pointerMove(e, el.clientHeight);
      if (this.state === "surface") return this.site?.pointerMove(e, el.clientHeight);
      if (this.state !== "play") return;
      const w = el.clientWidth, h = el.clientHeight;
      if (e.pointerType === "mouse") {
        this.target.set((e.clientX / w * 2 - 1) * LANE_X * 1.15, -(e.clientY / h * 2 - 1) * LANE_Y * 1.3);
      } else if (this.touchId === e.pointerId) {
        this.target.x += ((e.clientX - this.touchX) / w) * LANE_X * 3;
        this.target.y -= ((e.clientY - this.touchY) / h) * LANE_Y * 3;
        this.touchX = e.clientX;
        this.touchY = e.clientY;
      }
    };
    const onDown = (e: PointerEvent) => {
      if (this.state === "observe") {
        el.setPointerCapture(e.pointerId);
        return this.observatory?.pointerDown(e);
      }
      if (this.state === "count") this.skipLaunch();
      if (this.state === "landing") this.site?.skip();
      if (this.state === "surface") {
        el.setPointerCapture(e.pointerId);
        this.site?.pointerDown(e);
        return;
      }
      if (this.state === "play") {
        if (e.pointerType === "mouse") {
          if (e.button === 0) this.fire();
          return;
        }
        // A second finger fires; the first one keeps steering.
        if (this.touchId !== null && this.touchId !== e.pointerId) return this.fire();
      }
      if (e.pointerType !== "mouse") {
        this.touchId = e.pointerId;
        this.touchX = e.clientX;
        this.touchY = e.clientY;
      }
    };
    const onUp = (e: PointerEvent) => {
      this.observatory?.pointerUp(e);
      const site = this.site;
      if (site) {
        const hit = site.pointerUp(e, el.getBoundingClientRect());
        if (this.state === "surface" && hit) {
          if (site.focus(hit)) this.events.onFocusPlanting?.(hit);
        } else if (this.state === "surface" && hit === "" && site.focusedId) {
          site.unfocus();
          this.events.onFocusPlanting?.(null);
        }
      }
      if (e.pointerId === this.touchId) this.touchId = null;
    };
    const onWheel = (e: WheelEvent) => {
      if (this.state !== "observe") return;
      e.preventDefault();
      this.observatory?.wheel(e.deltaY);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      this.keys[e.key] = true;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (this.state === "play" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      if (this.state === "observe") {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
        if (e.key === "Escape") this.leaveObservatory();
        return;
      }
      if (this.state === "landing" && [" ", "Enter", "Escape"].includes(e.key) && !e.repeat) {
        e.preventDefault();
        this.site?.skip();
      }
      if (this.state === "surface") {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
        return;
      }
      if ((e.key === "c" || e.key === "C") && !e.repeat) this.toggleView();
      if (this.state === "play" && e.key === " " && !e.repeat) this.fire();
      if (this.state === "count" && [" ", "Enter", "Escape"].includes(e.key) && !e.repeat) {
        e.preventDefault();
        this.skipLaunch();
      }
    };
    const onPip = (e: MouseEvent) => {
      e.preventDefault();
      this.toggleView();
      this.hud.pip.blur();
    };
    const pip = this.hud.pip;
    pip.addEventListener("click", onPip);
    const onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.key] = false;
    };
    const onResize = () => this.resize();
    const onVisibility = () => {
      this.audio.suspend(document.hidden);
      if (document.hidden) this.voice.stop();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    this.disposers.push(() => {
      pip.removeEventListener("click", onPip);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.views.setSize(w, h);
    this.measurePip();
  }

  private addCloud(z: number, allowCenter: boolean) {
    const c = this.factory.cloud(z, allowCenter);
    this.scene.add(c);
    this.clouds.push(c);
  }

  private clearWorld() {
    this.objects.forEach((o) => this.scene.remove(o.mesh));
    this.objects = [];
    this.clouds.forEach((c) => {
      this.scene.remove(c);
      disposeCloud(c);
    });
    this.clouds = [];
    this.effects.forEach((f) => this.scene.remove(f.obj));
    this.effects = [];
    this.deflector.reset();
  }

  private toast(title: string, detail: string) {
    this.hud.toastTitle.textContent = title;
    this.hud.toastDetail.textContent = detail;
    this.hud.toast.classList.add("show");
    this.toastTimer = 3.2;
  }

  private retrigger(el: HTMLElement, cls: string) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  private nearMiss(gap: number, dx: number) {
    this.streak = this.t - this.lastNearMiss < 4 ? this.streak + 1 : 1;
    this.lastNearMiss = this.t;
    this.closeCalls++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const razor = gap < 1.1;
    const gain = (razor ? 9 : 5) + Math.min(this.streak - 1, 5) * 2;
    this.fuel = Math.min(100, this.fuel + gain);
    this.boost = 1;
    this.camKick = razor ? 1 : 0.6;
    const h = this.hud;
    this.pop(razor ? "Razor thin" : "Close call", `+${gain} fuel${this.streak > 1 ? `   ×${this.streak} streak` : ""}`, razor ? "razor" : "", dx);
    this.retrigger(dx > 0 ? h.edgeRight : h.edgeLeft, "flash");
    const charge = (razor ? CHARGE_RAZOR : CHARGE_CLOSE) + Math.min(this.streak - 1, 2) * CHARGE_STREAK;
    if (this.deflector.addCharge(Math.min(1, charge))) this.audio.deflectorCharged(Math.floor(this.deflector.charge));
    this.audio.nearMiss(this.streak, razor);
    this.cockpit.nearMiss(dx > 0 ? 1 : -1, razor);
    if (razor) this.chatter.say("razor", 1, 0.6);
    else if (this.streak >= 5) this.chatter.say("streak5", 1, 0.8);
    else if (this.streak >= 3) this.chatter.say("streak3", 1, 0.7);
    else this.chatter.say("close", 1, 0.35);
    if ((razor || this.streak >= 3) && this.t - this.lastSlowmo > 1.6) {
      this.slowmo = 0.95;
      this.lastSlowmo = this.t;
      this.audio.slowmo();
    }
  }

  /** The pop-up text at 60% height (near misses and deflector hits). */
  private pop(title: string, detail: string, cls: "" | "razor" | "bad" | "hit", dx: number) {
    const h = this.hud;
    h.nearMissTitle.textContent = title;
    h.nearMissDetail.textContent = detail;
    for (const c of ["razor", "bad", "hit"]) h.nearMiss.classList.toggle(c, c === cls);
    h.nearMiss.style.setProperty("--dx", `${(dx > 0 ? 1 : -1) * Math.min(120, innerWidth * 0.12)}px`);
    this.retrigger(h.nearMiss, "pop");
  }

  /** What a deflector hit does: shatter, split, clean up, or a satellite you'll regret. */
  private deflected(o: WorldObject) {
    const i = this.objects.indexOf(o);
    if (i < 0) return;
    this.objects.splice(i, 1);
    this.scene.remove(o.mesh);
    const q = o.mesh.position, dx = q.x - this.rocket.ship.position.x;
    const pan = THREE.MathUtils.clamp(dx / 10, -1, 1);
    const split = o.type === "asteroid" && o.radius >= SPLIT_RADIUS;
    const big = split || o.type === "satellite";
    this.impact(o, big);
    this.audio.deflectorHit(big, pan);
    this.camKick = Math.max(this.camKick, big ? 0.8 : 0.5);
    let kind: "asteroid" | "split" | "junk" | "satellite" = "asteroid";
    if (o.type === "asteroid") {
      this.kills.asteroids++;
      if (split) {
        kind = "split";
        const parts = this.factory.fragments(o, this.debrisRng);
        parts.forEach((f) => this.scene.add(f.mesh));
        this.objects.push(...parts);
        this.pop("Split", `Now there are ${parts.length}`, "hit", dx);
        this.chatter.say("asteroidSplit", 1, 0.8);
        if (this.t - this.lastSlowmo > 1.6) {
          this.slowmo = 0.55;
          this.lastSlowmo = this.t;
          this.audio.slowmo();
        }
      } else {
        this.pop("Deflected", "Asteroid destroyed", "hit", dx);
        this.chatter.say("asteroidHit", 1, 0.45);
      }
    } else if (o.type === "junk") {
      kind = "junk";
      this.kills.junk++;
      this.fuel = Math.min(100, this.fuel + JUNK_CLEANUP_FUEL);
      this.pop("Orbital cleanup", `+${JUNK_CLEANUP_FUEL} fuel`, "hit", dx);
      this.chatter.say("junkHit", 1, 0.4);
    } else if (o.type === "satellite") {
      kind = "satellite";
      this.kills.satellites++;
      const parts = this.factory.debris(o, this.debrisRng);
      parts.forEach((f) => this.scene.add(f.mesh));
      this.objects.push(...parts);
      this.pop("Satellite destroyed", "Debris ahead", "bad", dx);
      // Above story beats (2), below endings (3): the satellite line is the one people share.
      this.chatter.say("satHit", 2.5);
    }
    this.cockpit.deflectorHit(kind);
  }

  /** Flash and chips flying off a hit. */
  private impact(o: WorldObject, big: boolean) {
    const at = o.mesh.position;
    const mat = this.factory.chips(o.type);
    const n = big ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(CHIP_GEO, mat);
      b.position.copy(at).add(new THREE.Vector3(fx.range(-1, 1), fx.range(-1, 1), fx.range(-1, 1)).multiplyScalar(o.radius * 0.6));
      b.scale.setScalar(fx.range(0.6, 1.8) * (big ? 1.4 : 1));
      this.scene.add(b);
      const v = new THREE.Vector3(fx.range(-1, 1), fx.range(-1, 1), fx.range(-0.4, 1)).normalize().multiplyScalar(fx.range(6, 18));
      this.effects.push({ obj: b, vel: v, life: fx.range(1.2, 2), max: 0, kind: "bit" });
    }
    for (let i = 0; i < (big ? 5 : 3); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: i === 0 ? 0xffffff : o.type === "satellite" ? 0xff9a5a : 0xbfe0ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
      s.position.copy(at);
      s.scale.setScalar(2);
      this.scene.add(s);
      this.effects.push({ obj: s, vel: new THREE.Vector3(fx.range(-1.5, 1.5), fx.range(-1.5, 1.5), fx.range(-1.5, 1.5)), life: fx.range(0.5, 0.9), max: o.radius * (big ? 5 : 3.5), kind: "fire" });
    }
  }

  private explode() {
    const ship = this.rocket.ship;
    ship.visible = false;
    const colors = [0xff7a2a, 0xffd08a, 0xf2f3f5, 0x555555];
    const bitGeo = new THREE.BoxGeometry(0.18, 0.18, 0.3);
    for (let i = 0; i < 40; i++) {
      const c = colors[i % 4];
      const b = new THREE.Mesh(bitGeo, new THREE.MeshStandardMaterial({ color: c, emissive: i % 4 < 2 ? c : 0, emissiveIntensity: 1.2 }));
      b.position.copy(ship.position);
      this.scene.add(b);
      this.effects.push({ obj: b, vel: new THREE.Vector3(fx.range(-1, 1), fx.range(-1, 1), fx.range(-1, 1)).normalize().multiplyScalar(fx.range(4, 16)), life: Infinity, max: 0, kind: "bit" });
    }
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: i < 6 ? 0xffffff : 0xff8a3a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.position.copy(ship.position).add(new THREE.Vector3(fx.range(-1, 1), fx.range(-1, 1), fx.range(-1, 1)));
      s.scale.setScalar(2);
      this.scene.add(s);
      this.effects.push({ obj: s, vel: new THREE.Vector3(fx.range(-2, 2), fx.range(-2, 2), fx.range(-2, 2)), life: fx.range(0.8, 1.4), max: fx.range(8, 16), kind: "fire" });
    }
  }

  private end(reason: EndReason, origin?: WorldObject["origin"]) {
    this.state = "ending";
    this.reason = reason;
    this.endTimer = reason === "moon" ? 1 : 1.8;
    if (reason === "fuel") this.audio.sputter();
    else if (reason === "moon") this.audio.moon();
    else {
      this.audio.explode();
      this.explode();
    }
    const key = reason === "fuel" ? "nofuel" : reason === "moon" ? "moon" : reason === "balloon" ? "balloonCrash"
      : origin === "debris" ? "kesslerCrash" : origin === "split" ? "splitCrash" : "crash";
    this.hud.root.classList.remove("armed");
    this.quote = this.chatter.say(key, 3);
    this.cockpit.end(reason);
    if (reason !== "fuel" && reason !== "moon") {
      // The cabin feed dies with the rocket; the outside camera takes over.
      this.signalLost = true;
      this.hud.pip.classList.add("lost");
    }
    this.hud.root.classList.remove("playing");
    this.setState("ending");
  }

  private finish() {
    this.chatter.clear(false);
    const moon = this.reason === "moon";
    // Reaching the Moon lands you; the result (and leaderboard) still goes out now.
    if (moon) this.enterSite();
    else this.setState("over");
    this.events.onGameOver({
      km: this.km,
      pct: Math.min(100, (this.km / MOON_KM) * 100),
      reason: this.reason,
      durationMs: Math.round(this.t * 1000),
      closeCalls: this.closeCalls,
      bestStreak: this.bestStreak,
      lastMilestone: this.lastMilestone,
      quote: this.quote,
      shots: this.deflector.shots,
      ...this.kills,
      test: !!this.test,
    });
  }

  private setText(key: string, el: HTMLElement, v: string) {
    if (this.hudCache[key] !== v) {
      this.hudCache[key] = v;
      el.textContent = v;
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const realDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.slowmo > 0) this.slowmo -= realDt;
    const timeScale = this.slowmo > 0 ? 1 - 0.7 * Math.min(1, this.slowmo / 0.6) : 1;
    const dt = realDt * timeScale;
    this.boost = Math.max(0, this.boost - dt * 1.1);
    this.camKick = Math.max(0, this.camKick - realDt * 2.5);

    const ship = this.rocket.ship;
    const sp = ship.position;

    if (this.state === "play") this.updatePlay(dt);
    else if (this.state === "count") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.2);
      const cn = this.countdown > 0.2 ? n : 0;
      if (cn !== this.lastCount) {
        this.lastCount = cn;
        if (cn > 0) this.audio.beep();
        else {
          this.audio.liftoff();
          if (!this.test) this.chatter.say("launch", 2);
        }
      }
      const c = this.hud.count;
      if (this.countdown > 0.2) {
        this.setText("count", c, String(n));
        c.style.opacity = String(Math.min(1, ((this.countdown - 0.2) % 1) * 1.6));
      } else {
        this.setText("count", c, "Liftoff");
        c.style.opacity = String(THREE.MathUtils.clamp(1 - (0.2 - this.countdown) / 1.4, 0, 1));
      }
      const lt = COUNT_TIME - this.countdown;
      this.padFrame = this.pad.update(dt, lt);
      if (this.padFrame.ignitedNow) this.audio.ignition();
      this.fade = this.padFrame.fade;
      if (lt >= LAUNCH_TIME) {
        c.style.opacity = "0";
        this.setState("play");
      }
    } else if (this.state === "landing" || this.state === "surface") {
      const site = this.site!;
      site.keys(realDt, this.keys);
      const sf = site.update(realDt);
      site.labels(this.hud.siteLabels, this.container.clientWidth, this.container.clientHeight);
      this.fade = Math.max(this.fade, sf.fade);
      if (sf.touchdown) {
        this.audio.touchdown();
        this.chatter.say("touchdown", 2);
      }
      if (sf.landed) this.setState("surface");
      if (sf.planted) {
        this.audio.plant();
        this.chatter.say(sf.planted.kind === "flag" ? "planted" : "plaque", 2);
      }
    } else if (this.state === "observe") {
      const o = this.observatory!;
      o.keys(realDt, this.keys);
      o.update(realDt, { marks: this.hud.moonMarks, altitude: this.hud.moonAlt }, this.container.clientWidth, this.container.clientHeight);
    } else if (this.state === "title") {
      this.idleTime += realDt;
      if (this.surfaceJob && this.idleTime > 1.5) this.buildSurface(this.lowEnd ? 3 : 6);
      sp.z -= 6 * dt;
      sp.x = Math.sin(now / 1600) * 0.6;
      sp.y = Math.sin(now / 2100) * 0.4;
      ship.rotation.z = -Math.cos(now / 1600) * 0.05;
      this.nextCloud -= 6 * dt;
      if (this.nextCloud <= 0) {
        this.addCloud(sp.z - 300, true);
        this.nextCloud = fx.range(14, 22);
      }
    } else {
      if (this.state === "ending") {
        this.endTimer -= dt;
        if (this.reason === "moon") this.fade = Math.max(this.fade, THREE.MathUtils.smoothstep(1 - this.endTimer, 0.35, 1));
        if (this.endTimer <= 0) this.finish();
      }
      if (this.reason === "fuel") {
        sp.z -= 6 * dt;
        ship.rotation.z += dt * 0.5;
        ship.rotation.x += dt * 0.15;
      }
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.life -= dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(0.97);
      if (f.kind === "bit") {
        f.obj.rotation.x += dt * 5;
        f.obj.rotation.y += dt * 4;
      } else {
        const a = Math.max(0, f.life);
        f.obj.scale.setScalar(f.max * (1 - a / 1.4) + 2);
        ((f.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = Math.min(1, a);
      }
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        if (f.kind === "fire") ((f.obj as THREE.Sprite).material as THREE.SpriteMaterial).dispose();
        this.effects.splice(i, 1);
      }
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (c.position.z > sp.z + 20) {
        this.scene.remove(c);
        disposeCloud(c);
        this.clouds.splice(i, 1);
        continue;
      }
      // Thin out as a bank reaches the camera, so flying through it never whites out the screen.
      const flying = this.state === "play" || this.state === "ending";
      const fade = flying ? THREE.MathUtils.smoothstep(this.cam.position.z - c.position.z, 2, 36) : 1;
      for (const s of c.children) (s as THREE.Sprite).material.opacity = s.userData.base * fade;
    }
    for (const o of this.objects) {
      o.mesh.rotation.x += o.spin.x * dt;
      o.mesh.rotation.y += o.spin.y * dt;
      o.mesh.rotation.z += o.spin.z * dt;
    }

    const live = this.state === "count" || this.state === "play" || this.state === "ending";
    const cabinMain = live && this.preferCabin && !this.signalLost;
    const observing = this.state === "observe";
    const onSurface = this.state === "landing" || this.state === "surface";
    this.updateEnvironment(dt, realDt, now, !cabinMain && this.state !== "count" && !observing && !onSurface);
    this.chatter.update(realDt);
    const thrust = this.state === "play" ? 1 + this.speed / 200 : this.state === "count" ? this.padFrame?.thrust ?? 0 : 0.5;
    this.rocket.setThrust(thrust, ship.visible && !(this.reason === "fuel" && (this.state === "ending" || this.state === "over")));
    this.audio.update({
      state: this.state,
      speed: this.speed,
      space: observing || onSurface ? 1 : this.spaceFactor(),
      thrust: onSurface ? this.site?.thrust ?? 0 : thrust,
      engineDead: this.reason === "fuel",
      ducked: this.chatter.speaking,
    });
    if (live) this.updateCockpit(dt, thrust);
    this.updateHud(realDt);
    this.render(live, cabinMain, realDt);
  };

  /** Feeds the cabin: controls, g-load, vibration, instruments and what's coming. */
  private updateCockpit(dt: number, thrust: number) {
    const sp = this.rocket.ship.position;
    const counting = this.state === "count", playing = this.state === "play";
    const lt = counting ? COUNT_TIME - this.countdown : -1;
    const pf = this.padFrame;
    const th = this.threats;
    th.length = 0;
    if (playing) {
      for (const o of this.objects) {
        const q = o.mesh.position, z = sp.z - q.z;
        if (z > -2 && z < 260) th.push({ x: q.x - sp.x, y: q.y - sp.y, z, r: o.radius, fuel: o.type === "fuel" });
      }
    }
    if (dt > 0) {
      this.accel.set((this.vel.x - this.lastVel.x) / dt, (this.vel.y - this.lastVel.y) / dt);
      this.lastVel.copy(this.vel);
      const inst = (this.km - this.lastKm) / dt;
      this.kmps += (inst - this.kmps) * Math.min(1, dt * 3);
      this.lastKm = this.km;
    }
    const space = this.spaceFactor();
    const ship = counting ? this.pad.rocket.ship : this.rocket.ship;
    this.cockpit.update(dt, {
      launch: lt,
      steerX: playing ? THREE.MathUtils.clamp((this.target.x - sp.x) / 4, -1, 1) : 0,
      steerY: playing ? THREE.MathUtils.clamp((this.target.y - sp.y) / 3, -1, 1) : 0,
      thrust,
      g: counting ? (lt > LIFTOFF_AT ? 0.75 : (pf?.rumble ?? 0) * 0.25) : playing ? Math.min(1, 0.15 + this.speed / 400 + this.boost * 0.6) : 0,
      rumble: counting ? pf?.rumble ?? 0 : playing ? 0.08 + 0.25 * (1 - space) + this.boost * 0.4 : 0,
      space,
      fuel: this.fuel,
      km: this.km,
      pct: Math.min(100, (this.km / MOON_KM) * 100),
      kmps: Math.max(0, this.kmps),
      t: counting ? -this.countdown : this.t,
      roll: counting ? 0 : ship.rotation.z,
      pitch: counting ? 0 : ship.rotation.x,
      shipQuat: ship.quaternion,
      accel: this.accel,
      threats: th,
    });
  }

  /** Main view full screen, the other one in the picture-in-picture. */
  private render(live: boolean, cabinMain: boolean, realDt: number) {
    const counting = this.state === "count";
    const outside = counting ? this.padView : this.chaseView;
    let main = outside, pip: View | null = null;
    if (live) {
      this.cockpit.placeWorldCamera(this.cabinCam, counting ? this.pad.rocket.ship : this.rocket.ship);
      const cabin = counting ? this.cabinPad : this.cabinFlight;
      main = cabinMain ? cabin : outside;
      pip = this.signalLost ? null : cabinMain ? outside : cabin;
      const label = this.signalLost || !cabinMain ? "Cabin cam" : counting ? (this.padFrame?.shot === "track" ? "Tracking cam" : "Pad cam") : "Chase cam";
      this.setText("pip", this.hud.pipLabel, label);
    }
    if (this.state === "observe" && this.observatory) {
      main = this.observatory.view;
      if (this.views.bloom) this.views.bloom.strength = 0.25;
    }
    if ((this.state === "landing" || this.state === "surface") && this.site) {
      main = this.site.view;
      // Almost no bloom in a close-up, so a sunlit panel stays readable.
      if (this.views.bloom) this.views.bloom.strength = this.site.focusedId ? 0.04 : 0.2;
    }
    this.deflector.hud(
      { reticle: this.hud.reticle, reticleLabel: this.hud.reticleLabel, pips: this.hud.deflectorPips },
      cabinMain ? this.cabinCam : this.cam, this.container.clientWidth, this.container.clientHeight, this.state === "play",
    );
    if (!counting) this.fade = Math.max(0, this.fade - realDt / 0.6);
    const fade = this.fade.toFixed(2);
    if (this.hudCache.fade !== fade) {
      this.hudCache.fade = fade;
      this.hud.fade.style.opacity = fade;
    }
    this.views.render(main, pip, realDt);
  }

  private spaceFactor() {
    const s = THREE.MathUtils.clamp(this.km / 100, 0, 1);
    return s * s * (3 - 2 * s);
  }

  private updatePlay(dt: number) {
    const ship = this.rocket.ship;
    const sp = ship.position;
    this.t += dt;
    this.speed = speedAt(this.t);
    const vz = this.speed * (1 + MAX_BOOST * this.boost);
    this.dist += vz * dt;
    this.km = kmAt(this.dist);
    const progress = Math.min(1, this.dist / TOTAL_UNITS);

    this.fuel -= dt * FUEL_BURN * (this.speed / 60);
    if (this.fuel < 25 && !this.lowWarned) {
      this.lowWarned = true;
      this.toast("Low fuel", "Grab a canister");
      this.chatter.say("lowfuel", 1);
      this.cockpit.lowFuel();
    }
    if (this.fuel > 40) this.lowWarned = false;
    if (this.fuel < 25 && this.fuel > 0) {
      this.alarmTimer -= dt;
      if (this.alarmTimer <= 0) {
        this.audio.alarm();
        this.alarmTimer = 1.2;
      }
    } else this.alarmTimer = 0;

    const k = this.keys, step = 24 * dt;
    if (k.ArrowLeft || k.a) this.target.x -= step;
    if (k.ArrowRight || k.d) this.target.x += step;
    if (k.ArrowUp || k.w) this.target.y += step;
    if (k.ArrowDown || k.s) this.target.y -= step;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -LANE_X, LANE_X);
    this.target.y = THREE.MathUtils.clamp(this.target.y, -LANE_Y, LANE_Y);
    const ease = 1 - Math.exp(-7 * dt), px = sp.x, py = sp.y;
    sp.x += (this.target.x - px) * ease;
    sp.y += (this.target.y - py) * ease;
    if (dt > 0) this.vel.set((sp.x - px) / dt, (sp.y - py) / dt);
    sp.z -= vz * dt;
    ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -this.vel.x * 0.045, 0.15);
    ship.rotation.x = THREE.MathUtils.lerp(ship.rotation.x, this.vel.y * 0.03, 0.15);

    const gap = this.km < 100 ? 34 : THREE.MathUtils.lerp(26, 8.5, Math.pow(progress, 0.7));
    this.nextObstacle -= vz * dt;
    while (this.nextObstacle <= 0) {
      const o = this.factory.obstacle(this.km, sp.z - 470, this.rng, sp);
      if (o.type === "asteroid" && !this.asteroidsSaid) {
        this.asteroidsSaid = true;
        this.chatter.say("asteroids", 2);
      }
      this.scene.add(o.mesh);
      this.objects.push(o);
      this.nextObstacle += gap * this.rng.range(0.55, 1.45);
    }
    this.nextFuel -= vz * dt;
    if (this.nextFuel <= 0) {
      const f = this.factory.fuel(sp.z - 470, this.rng);
      this.scene.add(f.mesh);
      this.objects.push(f);
      this.nextFuel = this.rng.range(150, 200);
    }
    if (this.km < 85) {
      this.nextCloud -= vz * dt;
      if (this.nextCloud <= 0) {
        this.addCloud(sp.z - 490, false);
        this.nextCloud = fx.range(12, 20);
      }
    }

    while (this.milestoneIndex < MILESTONES.length && this.km >= MILESTONES[this.milestoneIndex].km) {
      const m = MILESTONES[this.milestoneIndex];
      this.lastMilestone = m.title;
      this.toast(m.title, m.detail);
      if (m.km === 100) {
        this.audio.karman();
        if (!this.deflector.armed) this.armAt = this.t + 3.5;
      }
      else this.audio.radioBlip();
      this.chatter.say(m.chatter, 2);
      this.cockpit.milestone(m.chatter);
      this.milestoneIndex++;
    }
    if (this.armAt > 0 && this.t >= this.armAt) {
      this.armAt = -1;
      this.deflector.arm(false);
      this.audio.deflectorArm();
      this.hud.root.classList.add("armed");
      this.armedSaid = false;
    }
    // Keep trying until the radio is free: the arming line is the feature's only tutorial.
    if (!this.armedSaid) this.armedSaid = !!this.chatter.say("armed", 2);
    if (!this.tipSaid && this.t > 6 && this.runs <= 3) {
      this.tipSaid = true;
      this.chatter.say("tip", 1);
    }

    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i], q = o.mesh.position;
      if (o.vel) q.addScaledVector(o.vel, dt);
      if (q.z > sp.z + 14) {
        this.scene.remove(o.mesh);
        this.objects.splice(i, 1);
        continue;
      }
      if (!o.passed && q.z > sp.z) {
        o.passed = true;
        const dx = q.x - sp.x, dy = q.y - sp.y, edge = Math.hypot(dx, dy) - o.radius;
        if (o.type !== "fuel" && edge < 7) {
          this.audio.whoosh(THREE.MathUtils.clamp(dx / 6, -1, 1), 1 - Math.max(0, edge) / 7, this.km >= 100);
          if (edge < 2.2 && edge >= 0.5) this.nearMiss(edge, dx);
        }
      }
      if (o.type === "fuel" && q.z < sp.z && q.z > sp.z - 30 && Math.hypot(q.x - sp.x, q.y - sp.y) < 6) {
        q.x += (sp.x - q.x) * Math.min(1, dt * 6);
        q.y += (sp.y - q.y) * Math.min(1, dt * 6);
      }
      if (Math.abs(q.z - sp.z) < o.radius + 1.3) {
        const d = Math.hypot(q.x - sp.x, q.y - sp.y, q.z - sp.z);
        if (o.type === "fuel") {
          if (d < o.radius + 1.6) {
            this.fuel = Math.min(100, this.fuel + FUEL_PICKUP);
            this.audio.pickup();
            this.chatter.say("pickup", 0, 0.12);
            this.cockpit.pickup();
            this.scene.remove(o.mesh);
            this.objects.splice(i, 1);
          }
        } else if (d < o.radius + 0.55 && !this.test) {
          this.end(o.type, o.origin);
          return;
        }
      }
    }
    const shot = this.deflector.update(dt, sp, vz, this.objects);
    shot.hits.forEach((o) => this.deflected(o));
    if (shot.misses) this.chatter.say("missShot", 1, 0.5);
    if (this.fuel <= 0) {
      this.fuel = 0;
      this.end("fuel");
    } else if (this.dist >= TOTAL_UNITS) {
      this.km = MOON_KM;
      this.end("moon");
    }
  }

  private updateEnvironment(dt: number, realDt: number, now: number, flares: boolean) {
    const sp = this.rocket.ship.position;
    const space = this.spaceFactor();
    (this.sky.material as THREE.ShaderMaterial).uniforms.uSpace.value = space;
    this.fog.color.set(0xc6e0f7).lerp(new THREE.Color(0x02040b), space);
    (this.stars.material as THREE.PointsMaterial).opacity = space * 0.9;
    (this.brightStars.material as THREE.PointsMaterial).opacity = space;
    this.sun.material.opacity = 0.55 + 0.45 * space;
    this.sun.scale.setScalar(700 + 500 * space);

    const hv = 14 + 2900 * (1 - Math.exp(-this.km / 25000));
    this.earth.group.position.set(0, -EARTH_RADIUS - hv, sp.z - 180 - 2 * hv);
    this.earth.update(dt);
    const pm = this.km / MOON_KM;
    this.moon.mesh.position.set(-18 * (1 - pm), 16 - 10 * pm, sp.z - (170 + 2700 * (1 - pm)));
    this.moon.material.uniforms.uA.value = 0.25 + 0.75 * space;
    this.moon.mesh.rotation.y += dt * 0.004;

    const wantOff = new THREE.Vector3(), wantLook = new THREE.Vector3();
    const orbiting = this.state === "title" || this.state === "over" || (this.state === "ending" && this.reason !== "fuel");
    if (orbiting) {
      this.orbit += realDt * 0.12;
      const r = this.state === "title" ? 10 : 16;
      wantOff.set(Math.sin(this.orbit) * r, 2.2 + Math.sin(this.orbit * 0.7) * 1.2, Math.cos(this.orbit) * r);
      wantLook.set(0, 0.4, 0);
    } else {
      wantOff.set(-sp.x * 0.4, -sp.y * 0.4 + 2.4, 9.5);
      wantLook.set(-sp.x * 0.2, -sp.y * 0.2 + 0.9, -22);
    }
    const ease = 1 - Math.exp(-(this.state === "play" ? 9 : 2.2) * realDt);
    this.camOffset.lerp(wantOff, ease);
    this.lookOffset.lerp(wantLook, ease);
    this.cam.position.copy(sp).add(this.camOffset);
    if (this.state === "play") {
      const shake = (0.03 * this.speed) / 140 + this.camKick * 0.22;
      this.cam.position.x += (Math.random() - 0.5) * shake;
      this.cam.position.y += (Math.random() - 0.5) * shake;
    }
    this.cam.lookAt(sp.clone().add(this.lookOffset));
    const wantFov = this.state === "play" ? 58 + this.speed * 0.07 + this.boost * 9 : 52;
    if (Math.abs(this.cam.fov - wantFov) > 0.05) {
      this.cam.fov += (wantFov - this.cam.fov) * Math.min(1, realDt * 2);
      this.cam.updateProjectionMatrix();
    }
    this.sky.position.copy(this.cam.position);
    this.stars.position.copy(this.cam.position);
    this.brightStars.position.copy(this.cam.position);
    this.sun.position.copy(this.cam.position).addScaledVector(SUN_DIR, 2800);
    if (this.views.bloom) this.views.bloom.strength = 0.6 + 0.5 * space;

    // Flares belong to the chase camera; hide them when another view is on the big screen.
    if (!flares) {
      if (this.flaresOn) this.hud.flares.forEach((el) => (el.style.opacity = "0"));
      this.flaresOn = false;
      return;
    }
    this.flaresOn = true;

    // Lens flare ghosts along the line from the sun through the screen centre.
    const p = this.cam.position.clone().addScaledVector(SUN_DIR, 100).project(this.cam);
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const visible = p.z < 1 && Math.abs(p.x) < 1.15 && Math.abs(p.y) < 1.15;
    const cx = (p.x * 0.5 + 0.5) * W, cy = (-p.y * 0.5 + 0.5) * H;
    const strength = visible ? Math.max(0, 1 - Math.max(Math.abs(p.x), Math.abs(p.y)) * 0.7) : 0;
    this.hud.flares.forEach((el, i) => {
      const f = FLARES[i][0];
      el.style.transform = `translate(${cx + (W / 2 - cx) * f * 2}px, ${cy + (H / 2 - cy) * f * 2}px) translate(-50%, -50%)`;
      el.style.opacity = (strength * (i === 0 ? 0.9 : 0.75)).toFixed(3);
    });
    void now;
  }

  private updateHud(realDt: number) {
    const h = this.hud;
    if (this.toastTimer > 0) {
      this.toastTimer -= realDt;
      if (this.toastTimer <= 0) h.toast.classList.remove("show");
    }
    const pct = Math.min(100, (this.km / MOON_KM) * 100);
    this.setText("km", h.km, `${formatKm(this.km)} km`);
    this.setText("pct", h.pct, `${formatPct(pct)} of the way to the Moon`);
    const pos = `${pct}%`;
    h.marker.style.left = pos;
    h.fill.style.width = pos;
    const m = Math.floor(this.t / 60), s = Math.floor(this.t % 60);
    this.setText("clock", h.clock, `T+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    h.fuelBar.style.width = `${Math.max(0, this.fuel)}%`;
    h.fuelBar.classList.toggle("low", this.fuel < 25);
    this.setText("fuel", h.fuelPct, `${Math.max(0, Math.round(this.fuel))}%`);
  }
}
