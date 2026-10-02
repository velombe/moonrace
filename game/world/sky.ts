import * as THREE from "three";

export const SUN_DIR = new THREE.Vector3(0.58, 0.3, -0.76).normalize();

/** Atmosphere gradient that fades into black space as `space` goes 0 → 1. */
export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSpace: { value: 0 }, uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uSpace; uniform vec3 uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 hor = vec3(0.78, 0.88, 0.97);
        vec3 zen = vec3(0.12, 0.36, 0.78);
        vec3 c = mix(hor, zen, pow(h, 0.45));
        c = mix(c, hor * 0.85, step(d.y, 0.0));
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.86, 0.62) * (pow(s, 8.0) * 0.35 + pow(s, 120.0) * 0.8) * (1.0 - uSpace * 0.7);
        c = mix(c, vec3(0.004, 0.007, 0.018), uSpace);
        c += vec3(1.0, 0.9, 0.75) * pow(s, 900.0) * uSpace * 2.0;
        gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3400, 32, 16), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

export function createStars(count: number, size: number) {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 3000;
    pos.push(r * s * Math.cos(t), r * u, r * s * Math.sin(t));
    col.push(0.8 + 0.2 * Math.random(), 0.85 + 0.15 * Math.random(), 1);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
