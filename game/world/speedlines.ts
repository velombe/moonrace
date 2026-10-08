import * as THREE from "three";

const COUNT = 150;

/**
 * Streaks of light around the flight path that rush past the camera at speed.
 * The lines sit still in the world and are recycled ahead once the camera passes
 * them, so they stream by at the ship's real speed. Visual only (Math.random).
 */
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private pos = new Float32Array(COUNT * 6);
  private mat = new THREE.LineBasicMaterial({ color: 0xd6e8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private seeded = false;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  private place(i: number, cam: THREE.Vector3, z: number, len: number) {
    // A ring around the camera's line of travel, clear of the ship in the middle.
    const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 22;
    const x = cam.x + Math.cos(a) * r, y = cam.y + Math.sin(a) * r * 0.7, p = this.pos, o = i * 6;
    p[o] = x; p[o + 1] = y; p[o + 2] = z;
    p[o + 3] = x; p[o + 4] = y; p[o + 5] = z - len;
  }

  /** `intensity` 0–1 (speed and boost); `speed` in units/s sets the streak length. */
  update(cam: THREE.Vector3, intensity: number, speed: number) {
    this.mat.opacity = Math.min(1, intensity) * 0.32;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) {
      this.seeded = false;
      return;
    }
    const len = 3 + speed * 0.05;
    if (!this.seeded) {
      for (let i = 0; i < COUNT; i++) this.place(i, cam, cam.z - 20 - Math.random() * 240, len);
      this.seeded = true;
    }
    for (let i = 0; i < COUNT; i++) {
      const o = i * 6;
      // Passed the camera: recycle it far ahead. Keep length in step with speed.
      if (this.pos[o + 5] > cam.z + 2) this.place(i, cam, cam.z - 120 - Math.random() * 160, len);
      else this.pos[o + 5] = this.pos[o + 2] - len;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
