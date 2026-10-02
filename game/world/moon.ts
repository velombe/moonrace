import * as THREE from "three";

export const MOON_RADIUS = 60;

export interface MoonSurface {
  map: THREE.Texture;
  bump: THREE.Texture;
}

/**
 * The Moon uses its own light direction (`uL`, world space) so it always reads
 * as a lit, cratered disc. Relief comes from the height map via bump mapping,
 * so craters respond to where the light is.
 */
export function createMoon(surface: MoonSurface, segments = 96) {
  const img = surface.bump.image as { width: number; height: number };
  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uMap: { value: surface.map },
      uBump: { value: surface.bump },
      uTexel: { value: new THREE.Vector2(1 / img.width, 1 / img.height) },
      uRadius: { value: MOON_RADIUS },
      /** Relief exaggeration. */
      uBumpScale: { value: 2.5 },
      uL: { value: new THREE.Vector3(0.5, 0.22, 0.84).normalize() },
      uA: { value: 1 },
      uAmbient: { value: 0.01 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vPole;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vPole = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform sampler2D uBump; uniform vec2 uTexel; uniform float uRadius;
      uniform float uBumpScale; uniform vec3 uL; uniform float uA; uniform float uAmbient;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPole;
      void main() {
        vec3 t = texture2D(uMap, vUv).rgb;
        vec3 N = normalize(vN);
        // East/north on the sphere; the height map's u runs east and v runs north.
        vec3 east = cross(normalize(vPole), N);
        float cosLat = max(length(east), 0.03);
        east /= cosLat;
        vec3 north = cross(N, east);
        // Central differences at the pixel footprint: sharp up close, smooth from afar.
        vec2 fw = clamp(fwidth(vUv), uTexel, uTexel * 6.0);
        float hE = texture2D(uBump, vUv + vec2(fw.x, 0.0)).r - texture2D(uBump, vUv - vec2(fw.x, 0.0)).r;
        float hN = texture2D(uBump, vUv + vec2(0.0, fw.y)).r - texture2D(uBump, vUv - vec2(0.0, fw.y)).r;
        float dsE = 12.566 * uRadius * cosLat * fw.x;
        float dsN = 6.2832 * uRadius * fw.y;
        vec3 n = normalize(N - uBumpScale * (hE / dsE * east + hN / dsN * north));
        float base = dot(N, uL);
        float d = dot(n, uL);
        // Soft terminator from the smooth normal, relief from the bumped one.
        float l = smoothstep(-0.06, 0.3, base) * (0.25 + 0.85 * max(d, 0.0));
        gl_FragColor = vec4(t * (uAmbient + 1.15 * l), uA);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, segments, Math.round(segments * 0.66)), material);
  mesh.rotation.y = -Math.PI / 2;
  return { mesh, material };
}
