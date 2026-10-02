import * as THREE from "three";
import { earthTextures } from "./textures";

export const EARTH_RADIUS = 520;

export function createEarth() {
  const tex = earthTextures();
  const group = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 96, 64),
    new THREE.MeshPhongMaterial({ map: tex.map, specularMap: tex.specular, specular: new THREE.Color(0x3a4a66), shininess: 22, fog: false }),
  );
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.008, 96, 64),
    new THREE.MeshLambertMaterial({ map: tex.clouds, transparent: true, depthWrite: false, fog: false }),
  );
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.06, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 p = modelViewMatrix * vec4(position, 1.0);
          vP = p.xyz;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vP;
        void main() {
          float r = dot(normalize(vN), normalize(vP));
          float a = pow(clamp(r, 0.0, 1.0), 2.2);
          gl_FragColor = vec4(pow(vec3(0.3, 0.6, 1.0), vec3(2.2)) * a * 1.6, 1.0);
        }`,
    }),
  );
  group.add(ball, clouds, atmosphere);
  group.rotation.z = 0.35;
  return {
    group,
    update(dt: number) {
      ball.rotation.y += dt * 0.004;
      clouds.rotation.y += dt * 0.0055;
    },
  };
}
