import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Final colour grade, on display-space colours after OutputPass: a little more
 * saturation and contrast, cool shadows and warm highlights. `uAmount` 0–1 blends it.
 */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 g = mix(vec3(l), c.rgb, 1.16);
      g = (g - 0.5) * 1.08 + 0.5;
      g += mix(vec3(-0.012, 0.0, 0.03), vec3(0.03, 0.012, -0.02), smoothstep(0.2, 0.85, l));
      gl_FragColor = vec4(mix(c.rgb, clamp(g, 0.0, 1.0), uAmount), c.a);
    }`,
};

/** A camera looking at a scene, optionally with a second scene drawn on top (the cockpit over the world). */
export interface View {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  overlay?: { scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null;
  /** Called with the target aspect before rendering, so a view can adapt its field of view. */
  fit?: (aspect: number) => void;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** World pass, then an optional overlay pass after a depth clear, then (optional) bloom and output. */
class Chain {
  readonly composer: EffectComposer;
  private world: RenderPass;
  private over: RenderPass;

  readonly grade: ShaderPass | null;

  constructor(renderer: THREE.WebGLRenderer, bloom: UnrealBloomPass | null, grade = false) {
    const blank = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
    this.composer = new EffectComposer(renderer);
    this.world = new RenderPass(blank, cam);
    this.over = new RenderPass(blank, cam);
    this.over.clear = false;
    this.over.clearDepth = true;
    this.composer.addPass(this.world);
    this.composer.addPass(this.over);
    if (bloom) this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    this.grade = grade ? new ShaderPass(GradeShader) : null;
    if (this.grade) this.composer.addPass(this.grade);
  }

  render(v: View, aspect: number, dt: number) {
    v.fit?.(aspect);
    fitAspect(v.camera, aspect);
    this.world.scene = v.scene;
    this.world.camera = v.camera;
    this.over.enabled = !!v.overlay;
    if (v.overlay) {
      fitAspect(v.overlay.camera, aspect);
      this.over.scene = v.overlay.scene;
      this.over.camera = v.overlay.camera;
    }
    this.composer.render(dt);
  }
}

function fitAspect(cam: THREE.PerspectiveCamera, aspect: number) {
  if (Math.abs(cam.aspect - aspect) > 1e-4) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }
}

/**
 * Renders a main view full screen and an optional picture-in-picture view into
 * a rectangle of the same canvas. Both go through OutputPass so custom shaders
 * get the same colour conversion.
 */
export class ViewRenderer {
  readonly bloom: UnrealBloomPass | null = null;
  private main: Chain;
  private pip: Chain;
  private size = new THREE.Vector2();
  private rect: Rect | null = null;

  constructor(private renderer: THREE.WebGLRenderer, lowEnd: boolean) {
    if (!lowEnd) this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.45, 0.88);
    // The grade costs a full-screen pass; low-end devices skip it (like bloom).
    this.main = new Chain(renderer, this.bloom, !lowEnd);
    this.pip = new Chain(renderer, null);
    this.pip.composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5));
  }

  /** Colour grade strength for the main view (0 turns the pass off). */
  setGrade(amount: number) {
    const g = this.main.grade;
    if (!g) return;
    g.enabled = amount > 0.001;
    g.uniforms.uAmount.value = amount;
  }

  setSize(w: number, h: number) {
    this.main.composer.setSize(w, h);
  }

  /** PiP rectangle in CSS pixels from the canvas's top-left, or null to hide it. */
  setPipRect(r: Rect | null) {
    this.rect = r && r.w >= 8 && r.h >= 8 ? r : null;
    if (this.rect) this.pip.composer.setSize(Math.round(this.rect.w), Math.round(this.rect.h));
  }

  render(main: View, pip: View | null, dt: number) {
    const r = this.renderer, size = r.getSize(this.size);
    this.main.render(main, size.x / Math.max(1, size.y), dt);
    const rect = this.rect;
    if (!pip || !rect) return;
    const y = size.y - rect.y - rect.h;
    r.setViewport(rect.x, y, rect.w, rect.h);
    r.setScissor(rect.x, y, rect.w, rect.h);
    r.setScissorTest(true);
    this.pip.render(pip, rect.w / rect.h, dt);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
  }
}
