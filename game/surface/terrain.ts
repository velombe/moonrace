import * as THREE from "three";
import { fbm } from "../noise";
import { Rng } from "../rng";
import { canvas, colorTex } from "../world/textures";

/** Real Moon radius (m), for the horizon drop. */
const MOON_R = 1_737_400;
/** Terrain reaches this far (m); the horizon for a standing astronaut is ~2.4 km. */
export const TERRAIN_RADIUS = 2500;
const CELL = 40;

interface Crater {
  x: number;
  z: number;
  r: number;
  depth: number;
  rim: number;
}

/** A flattened area (landing pad, flag field) where small craters and bumps fade out. */
export interface FlatZone {
  x: number;
  z: number;
  r: number;
}

/**
 * The ground around the landing zone, in metres (x east, z south). Deterministic,
 * so every visit (and every planting's spot) lands on the same terrain.
 */
export class Terrain {
  private grid = new Map<string, Crater[]>();
  private regolith = regolith();

  constructor(private flats: FlatZone[], featured: { x: number; z: number; r: number }[], seed = 1969) {
    const rng = new Rng(seed);
    const add = (x: number, z: number, r: number) => {
      const c: Crater = { x, z, r, depth: r * (r > 20 ? 0.12 : 0.19), rim: r * 0.045 };
      const reach = r * 1.7;
      for (let gx = Math.floor((x - reach) / CELL); gx <= Math.floor((x + reach) / CELL); gx++) {
        for (let gz = Math.floor((z - reach) / CELL); gz <= Math.floor((z + reach) / CELL); gz++) {
          const k = `${gx},${gz}`;
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(c);
        }
      }
    };
    const clear = (x: number, z: number, r: number) => flats.every((f) => Math.hypot(x - f.x, z - f.z) > f.r + r * 1.7);
    featured.forEach((f) => add(f.x, f.z, f.r));
    // Small craters everywhere nearby, big ones further out (power-law sizes).
    for (let i = 0; i < 1400; i++) {
      const a = rng.next() * Math.PI * 2, d = Math.sqrt(rng.next()) * 400;
      const x = Math.cos(a) * d, z = Math.sin(a) * d, r = 0.3 * Math.pow(40, Math.pow(rng.next(), 2.6));
      if (clear(x, z, r)) add(x, z, r);
    }
    for (let i = 0; i < 70; i++) {
      const a = rng.next() * Math.PI * 2, d = 150 + rng.next() * (TERRAIN_RADIUS - 150);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      add(x, z, 15 + Math.pow(rng.next(), 2) * 140);
    }
  }

  /** Ground height (m) at x, z. */
  height(x: number, z: number): number {
    let flat = 0;
    for (const f of this.flats) flat = Math.max(flat, 1 - THREE.MathUtils.smoothstep(Math.hypot(x - f.x, z - f.z), f.r * 0.55, f.r));
    const keep = 1 - 0.9 * flat;
    let h = 3 * (fbm(x * 0.003 + 50, 1, z * 0.003 + 50, 7, 4) - 0.5);
    h += keep * (0.6 * (fbm(x * 0.04, 2, z * 0.04, 11, 3) - 0.5) + 0.05 * (fbm(x * 0.7, 3, z * 0.7, 13, 2) - 0.5));
    const list = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (list) {
      for (const c of list) {
        const t = Math.hypot(x - c.x, z - c.z) / c.r;
        if (t >= 1.7) continue;
        let v: number;
        if (t < 1) {
          const floor = c.r > 20 ? 0.4 : 0;
          const b = t < floor ? 0 : (t - floor) / (1 - floor);
          v = -c.depth * (1 - b * b) + c.rim * Math.pow(t, 4);
        } else v = c.rim * Math.exp(-((t - 1) * (t - 1)) / 0.14);
        h += c.r > 6 ? v : v * keep;
      }
    }
    return h - (x * x + z * z) / (2 * MOON_R);
  }

  /** Polar mesh: ~35 cm spacing near the landing zone, coarser toward the horizon. */
  mesh(lowEnd: boolean) {
    const seg = lowEnd ? 256 : 512;
    const radii: number[] = [0];
    const near = lowEnd ? 0.6 : 0.36;
    while (radii[radii.length - 1] < 55) radii.push(radii[radii.length - 1] + near);
    while (radii[radii.length - 1] < TERRAIN_RADIUS) radii.push(radii[radii.length - 1] * (lowEnd ? 1.05 : 1.03));
    const rings = radii.length;
    const pos = new Float32Array((1 + (rings - 1) * seg) * 3);
    const uv = new Float32Array((1 + (rings - 1) * seg) * 2);
    const col = new Float32Array((1 + (rings - 1) * seg) * 3);
    let v = 0;
    const put = (x: number, z: number) => {
      const y = this.height(x, z);
      pos.set([x, y, z], v * 3);
      uv.set([x / 3.5, z / 3.5], v * 2);
      // Slow albedo variation so the tiled grain doesn't read as a pattern.
      const a = 0.5 + 0.16 * (fbm(x * 0.012 + 9, 4, z * 0.012 + 9, 17, 3) - 0.5) + 0.06 * (fbm(x * 0.15, 5, z * 0.15, 19, 2) - 0.5);
      col.set([a, a * 0.985, a * 0.96], v * 3);
      v++;
    };
    put(0, 0);
    for (let k = 1; k < rings; k++) {
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        put(Math.cos(a) * radii[k], Math.sin(a) * radii[k]);
      }
    }
    const idx: number[] = [];
    for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    for (let k = 1; k < rings - 1; k++) {
      const a0 = 1 + (k - 1) * seg, a1 = 1 + k * seg;
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        idx.push(a0 + s, a0 + s1, a1 + s, a0 + s1, a1 + s1, a1 + s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const { map, normal } = this.regolith;
    const mat = new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(0.85, 0.85), vertexColors: true, roughness: 1, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /** Rocks and pebbles, none on the landing pad: a few detailed boulders, lots of cheap pebbles. */
  rocks(lowEnd: boolean) {
    const rng = new Rng(4242);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a857d, roughness: 0.95, normalMap: this.regolith.normal, normalScale: new THREE.Vector2(1.5, 1.5) });
    const shape = (k: number, detail: number) => {
      const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        v.multiplyScalar(0.65 + 0.7 * fbm(v.x * 1.4 + k * 9, v.y * 1.4, v.z * 1.4, 31 + k, 4));
        v.y *= 0.7;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      return g;
    };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const scatter = (geo: THREE.BufferGeometry, count: number, min: number, max: number, spread: number) => {
      const inst = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        let x = 0, z = 0;
        const size = min * Math.pow(max / min, Math.pow(rng.next(), 2.2));
        for (let tries = 0; tries < 10; tries++) {
          const a = rng.next() * Math.PI * 2, d = 3 + Math.pow(rng.next(), 1.5) * spread;
          x = Math.cos(a) * d;
          z = Math.sin(a) * d;
          if (size < 0.08 || this.flats.every((f) => Math.hypot(x - f.x, z - f.z) > f.r * 0.8)) break;
        }
        p.set(x, this.height(x, z) - size * 0.25, z);
        q.setFromEuler(e.set(rng.range(-0.3, 0.3), rng.next() * 6.28, rng.range(-0.3, 0.3)));
        s.set(size * rng.range(0.8, 1.3), size * rng.range(0.6, 1), size * rng.range(0.8, 1.3));
        inst.setMatrixAt(i, m.compose(p, q, s));
      }
      inst.castShadow = inst.receiveShadow = true;
      return inst;
    };
    const out: THREE.InstancedMesh[] = [];
    for (let k = 0; k < 2; k++) out.push(scatter(shape(k, lowEnd ? 2 : 3), lowEnd ? 25 : 45, 0.3, 2.2, 260));
    for (let k = 2; k < 6; k++) out.push(scatter(shape(k, 1), lowEnd ? 160 : 340, 0.03, 0.3, 160));
    return out;
  }
}

// ---------- regolith textures (tileable) ----------

function hash(x: number, y: number, s: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise that wraps every `period` cells, so the texture tiles. */
function pnoise(x: number, y: number, period: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (i: number) => ((i % period) + period) % period;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fine regolith: grainy albedo plus a normal map with pebbles and tiny pits. */
function regolith(N = 512) {
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let h = 0, amp = 1, f = 8;
      for (let o = 0; o < 5; o++, amp *= 0.5, f *= 2) h += amp * pnoise((x / N) * f, (y / N) * f, f, 77 + o);
      H[y * N + x] = h * 0.5;
    }
  }
  const rng = new Rng(99);
  const bump = (cx: number, cy: number, r: number, amt: number) => {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = Math.hypot(dx, dy) / r;
        if (t >= 1) continue;
        const x = (((cx + dx) % N) + N) % N, y = (((cy + dy) % N) + N) % N;
        H[y * N + x] += amt * (amt > 0 ? Math.sqrt(1 - t * t) : (1 - t * t) - 0.6 * Math.pow(t, 6));
      }
    }
  };
  // Sparse pebbles and the odd tiny pit; regolith is mostly fine powder.
  for (let i = 0; i < 110; i++) bump(rng.int(N), rng.int(N), 2 + rng.int(4), 0.25 + rng.next() * 0.45);
  for (let i = 0; i < 12; i++) bump(rng.int(N), rng.int(N), 6 + rng.int(12), -0.25 - rng.next() * 0.3);

  const albedo = canvas(N, N), norm = canvas(N, N);
  const ai = albedo.ctx.createImageData(N, N), ni = norm.ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const p = y * N + x, o = p * 4;
      const at = (dx: number, dy: number) => H[(((y + dy) % N + N) % N) * N + (((x + dx) % N + N) % N)];
      const nx = (at(-1, 0) - at(1, 0)) * 2.2, ny = (at(0, -1) - at(0, 1)) * 2.2;
      const l = Math.hypot(nx, ny, 1);
      ni.data[o] = (nx / l * 0.5 + 0.5) * 255;
      ni.data[o + 1] = (-ny / l * 0.5 + 0.5) * 255;
      ni.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
      ni.data[o + 3] = 255;
      const grain = hash(x, y, 5);
      const v = 205 + 40 * (H[p] - 0.45) + (grain - 0.5) * 34;
      ai.data[o] = v; ai.data[o + 1] = v * 0.99; ai.data[o + 2] = v * 0.97; ai.data[o + 3] = 255;
    }
  }
  albedo.ctx.putImageData(ai, 0, 0);
  norm.ctx.putImageData(ni, 0, 0);
  const map = colorTex(albedo.c);
  const normal = new THREE.CanvasTexture(norm.c);
  for (const t of [map, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, normal };
}
