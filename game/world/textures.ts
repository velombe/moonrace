import * as THREE from "three";
import { fbm, smoothstep } from "../noise";
import { MOON_RADIUS, type MoonSurface } from "./moon";

// All textures are generated procedurally. For production you can bake these
// once into image files under /public to shave ~1s off startup.

export function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

export function colorTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function earthTextures(W = 768, H = 384) {
  const land = canvas(W, H), spec = canvas(W, H), cloud = canvas(W, H);
  const img = land.ctx.createImageData(W, H);
  const simg = spec.ctx.createImageData(W, H);
  const cimg = cloud.ctx.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - j / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), latd = Math.abs(lat * 57.3);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2, px = cl * Math.cos(lon), pz = cl * Math.sin(lon), py = sl;
      const n = fbm(px * 1.7 + 5, py * 1.7 + 5, pz * 1.7 + 5, 11, 5);
      const o = (j * W + i) * 4;
      let r: number, g: number, b: number, sp: number;
      if (n < 0.52) {
        const t = smoothstep(0.38, 0.52, n);
        r = 6 + 14 * t; g = 22 + 46 * t; b = 58 + 70 * t; sp = 160;
      } else {
        const m = fbm(px * 6, py * 6, pz * 6, 31, 3);
        const desert = Math.exp(-Math.pow((latd - 24) / 13, 2)) * smoothstep(0.35, 0.6, m);
        const hi = smoothstep(0.6, 0.72, n);
        r = 48 + (165 - 48) * desert; g = 86 + (135 - 86) * desert; b = 40 + (88 - 40) * desert;
        r += (120 - r) * hi; g += (110 - g) * hi; b += (100 - b) * hi; sp = 18;
        const shade = 0.8 + 0.35 * m;
        r *= shade; g *= shade; b *= shade;
      }
      const ice = smoothstep(64, 74, latd + fbm(px * 4, py * 4, pz * 4, 51, 2) * 10);
      r += (236 - r) * ice; g += (242 - g) * ice; b += (250 - b) * ice;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      simg.data[o] = simg.data[o + 1] = simg.data[o + 2] = sp * (1 - ice); simg.data[o + 3] = 255;
      const cn = fbm(px * 2.6 + 9, py * 5.2 + 9, pz * 2.6 + 9, 71, 5);
      const ca = smoothstep(0.47, 0.7, cn + 0.08 * Math.cos(lat * 6));
      cimg.data[o] = cimg.data[o + 1] = cimg.data[o + 2] = 255; cimg.data[o + 3] = ca * 235;
    }
  }
  land.ctx.putImageData(img, 0, 0);
  spec.ctx.putImageData(simg, 0, 0);
  cloud.ctx.putImageData(cimg, 0, 0);
  return { map: colorTex(land.c), specular: new THREE.CanvasTexture(spec.c), clouds: colorTex(cloud.c) };
}

// Selenographic layout (degrees, east positive). Texture u = 0.5 + lon/360, so
// lon 0 sits at the sphere's local +X; see moonPoint() in moonAtlas.ts.
interface Mare { lat: number; lon: number; r: number; sx?: number; d?: number }
const MARIA: Mare[] = [
  { lat: 15, lon: -55, r: 21, sx: 0.9 }, { lat: 32, lon: -60, r: 13 }, { lat: -1, lon: -44, r: 14 }, // Oceanus Procellarum
  { lat: 33, lon: -16, r: 17 }, // Imbrium
  { lat: 28, lon: 17.5, r: 10.5 }, // Serenitatis
  { lat: 8.5, lon: 31, r: 12 }, // Tranquillitatis
  { lat: 17, lon: 59, r: 8, sx: 1.25 }, // Crisium
  { lat: -8, lon: 51, r: 10 }, // Fecunditatis
  { lat: -15, lon: 35, r: 6 }, // Nectaris
  { lat: -21, lon: -17, r: 10 }, // Nubium
  { lat: -10, lon: -23, r: 6 }, // Cognitum
  { lat: -24, lon: -39.5, r: 6 }, // Humorum
  { lat: 13, lon: 4, r: 4.5 }, // Vaporum
  { lat: 56, lon: -18, r: 5.5, sx: 4 }, { lat: 57, lon: 24, r: 4.5, sx: 3.5 }, // Frigoris
  { lat: 13.3, lon: 86.1, r: 6.5, d: 0.75 }, // Marginis (the moonrace landing zone)
  { lat: 27, lon: 148, r: 5 }, // Moscoviense (far side)
  { lat: -19.4, lon: -92.8, r: 4.5 }, // Orientale
  { lat: -53, lon: -169, r: 30, d: 0.22 }, // South Pole–Aitken basin
];
interface Crater { lat: number; lon: number; r: number; rays?: number; dark?: boolean }
const CRATERS: Crater[] = [
  { lat: -43.3, lon: -11.2, r: 1.45, rays: 1 }, // Tycho
  { lat: 9.6, lon: -20.1, r: 1.55, rays: 0.7 }, // Copernicus
  { lat: 8.1, lon: -38, r: 0.55, rays: 0.4 }, // Kepler
  { lat: 23.7, lon: -47.4, r: 0.7, rays: 0.35 }, // Aristarchus
  { lat: 51.6, lon: -9.4, r: 1.7, dark: true }, // Plato
  { lat: -58.4, lon: -14.4, r: 3.8 }, // Clavius
  { lat: -5.5, lon: -68.3, r: 2.8, dark: true }, // Grimaldi
  { lat: -9.3, lon: -1.9, r: 2.6 }, // Ptolemaeus
  { lat: -11.4, lon: 26.4, r: 1.65 }, // Theophilus
  { lat: -8.9, lon: 61.1, r: 2.2 }, // Langrenus
  { lat: -89.7, lon: 129.8, r: 0.35 }, // Shackleton
  { lat: -45.4, lon: 175.9, r: 3 }, // Von Kármán
];

/**
 * Builds the Moon step by step (yields every few rows) so a big one can be made
 * in idle time without freezing a frame. Returns a colour map with the real seas,
 * craters and rays, and a half-float height map (world units for a radius-60
 * Moon) that the shader turns into relief.
 */
export function* moonSurfaceJob(W = 1024, H = 512): Generator<void, MoonSurface> {
  const col = canvas(W, H);
  const img = col.ctx.createImageData(W, H);
  const height = new Float32Array(W * H);
  const mareAt = new Float32Array(W * H);
  const cosM = MARIA.map((m) => Math.cos((m.lat * Math.PI) / 180));
  for (let j = 0; j < H; j++) {
    const latD = 90 - ((j + 0.5) / H) * 180, lat = (latD * Math.PI) / 180, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < W; i++) {
      const lonD = ((i + 0.5) / W) * 360 - 180, lon = (lonD * Math.PI) / 180;
      const px = cl * Math.cos(lon), pz = cl * Math.sin(lon);
      const n1 = fbm(px * 1.6 + 3, sl * 1.6 + 3, pz * 1.6 + 3, 91, 4);
      const n2 = fbm(px * 9, sl * 9, pz * 9, 97, 3);
      let mare = 0;
      for (let k = 0; k < MARIA.length; k++) {
        const m = MARIA[k];
        let dl = lonD - m.lon;
        if (dl > 180) dl -= 360;
        else if (dl < -180) dl += 360;
        const dx = (dl * cosM[k]) / (m.sx ?? 1), dy = latD - m.lat;
        const d = Math.sqrt(dx * dx + dy * dy) + (n1 - 0.5) * m.r * 0.6;
        const v = smoothstep(m.r * 1.05, m.r * 0.78, d) * (m.d ?? 1);
        if (v > mare) mare = v;
      }
      const o = (j * W + i) * 4, p = j * W + i;
      const hi = 178 + 46 * (n2 - 0.5) + 20 * (n1 - 0.5);
      const lo = 98 + 26 * (n2 - 0.5);
      const v = hi + (lo - hi) * mare;
      img.data[o] = v * (1 + 0.02 * mare); img.data[o + 1] = v * (1 - 0.005 * mare); img.data[o + 2] = v * (1 - 0.04 * mare); img.data[o + 3] = 255;
      // Heights in degrees of arc for now: seas sit lower, highlands are rumpled.
      height[p] = -0.04 * mare + 0.025 * (n2 - 0.5) + 0.03 * (n1 - 0.5);
      mareAt[p] = mare;
    }
    yield;
  }
  col.ctx.putImageData(img, 0, 0);

  const ppd = W / 360;
  const toXY = (lat: number, lon: number): [number, number] => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
  /** Radial gradient disc at lat/lon, stretched for the equirectangular map and wrapped at the seam. */
  const disc = (lat: number, lon: number, rDeg: number, stops: [number, string][]) => {
    const ctx = col.ctx, [x, y] = toXY(lat, lon), r = Math.max(0.6, rDeg * ppd);
    const sx = 1 / Math.max(0.02, Math.cos((lat * Math.PI) / 180));
    for (const ox of [0, -W, W]) {
      if (x + ox + r * sx < 0 || x + ox - r * sx > W) continue;
      ctx.save();
      ctx.translate(x + ox, y);
      ctx.scale(sx, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      stops.forEach(([k, c]) => g.addColorStop(k, c));
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  };
  /** Stamps a crater into the height field: bowl, raised rim, then a soft ejecta skirt. */
  const stamp = (lat: number, lon: number, r: number) => {
    const deep = r < 1.5 ? 0.2 : 0.2 - 0.06 * Math.min(1, (r - 1.5) / 3);
    const D = deep * r, rim = 0.045 * r, reach = 1.7;
    const cosL = Math.max(0.02, Math.cos((lat * Math.PI) / 180));
    const [cx, cy] = toXY(lat, lon);
    const ry = Math.ceil(r * reach * ppd), rx = Math.min(W / 2, Math.ceil((r * reach * ppd) / cosL));
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
      const dLat = ((cy - (y + 0.5)) / H) * 180;
      const rowCos = Math.max(0.02, Math.cos(((90 - ((y + 0.5) / H) * 180) * Math.PI) / 180));
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dLon = ((x + 0.5 - cx) / W) * 360 * rowCos;
        const t = Math.sqrt(dLat * dLat + dLon * dLon) / r;
        if (t >= reach) continue;
        let h: number;
        if (t < 1) {
          // Flat-ish floor on big craters, round bowl on small ones.
          const floor = r > 2 ? 0.45 : 0;
          const b = t < floor ? 0 : (t - floor) / (1 - floor);
          h = -D * (1 - b * b) + rim * Math.pow(t, 4);
        } else h = rim * Math.exp(-((t - 1) * (t - 1)) / 0.14);
        height[y * W + (((x % W) + W) % W)] += h;
      }
    }
  };
  const crater = (lat: number, lon: number, r: number, dark = false) => {
    disc(lat, lon, r, dark
      ? [[0, "rgba(40,40,44,.5)"], [0.85, "rgba(40,40,44,.38)"], [1, "rgba(40,40,44,0)"]]
      : [[0, "rgba(30,30,34,.07)"], [0.8, "rgba(30,30,34,.04)"], [1, "rgba(30,30,34,0)"]]);
    stamp(lat, lon, r);
  };

  // Background cratering, heavier in the highlands than on the smooth seas.
  const count = Math.round(560 * (W / 1024) * (W / 1024));
  for (let n = 0; n < count; n++) {
    const lat = Math.asin(Math.random() * 2 - 1) * (180 / Math.PI), lon = Math.random() * 360 - 180;
    const [x, y] = toXY(lat, lon);
    const m = mareAt[Math.min(H - 1, Math.floor(y)) * W + Math.min(W - 1, Math.floor(x))];
    if (m > 0.5 && Math.random() < 0.75) continue;
    crater(lat, lon, 0.1 + Math.pow(Math.random(), 4) * 3.6);
    if (n % 20 === 19) yield;
  }

  // Named craters, with bright ray systems on the young ones.
  col.ctx.globalCompositeOperation = "lighter";
  for (const c of CRATERS) {
    if (!c.rays) continue;
    disc(c.lat, c.lon, c.r * 3.2, [[0, `rgba(255,255,255,${0.15 * c.rays})`], [1, "rgba(255,255,255,0)"]]);
    const [x, y] = toXY(c.lat, c.lon), sx = 1 / Math.cos((c.lat * Math.PI) / 180);
    for (let k = 0; k < 70 * c.rays; k++) {
      const a = Math.random() * Math.PI * 2, len = c.r * ppd * (4 + Math.random() * 22) * c.rays;
      const g = col.ctx.createLinearGradient(x, y, x + Math.cos(a) * len * sx, y + Math.sin(a) * len);
      g.addColorStop(0, `rgba(255,255,255,${0.035 + Math.random() * 0.055})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      col.ctx.strokeStyle = g;
      col.ctx.lineWidth = Math.max(1, c.r * ppd * (0.12 + Math.random() * 0.25));
      col.ctx.beginPath();
      col.ctx.moveTo(x, y);
      col.ctx.lineTo(x + Math.cos(a) * len * sx, y + Math.sin(a) * len);
      col.ctx.stroke();
    }
  }
  col.ctx.globalCompositeOperation = "source-over";
  for (const c of CRATERS) crater(c.lat, c.lon, c.r, c.dark);
  yield;

  // Light 3x3 blur so crater rims don't stair-step between texels.
  const tmp = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const r = j * W;
      tmp[r + i] = (height[r + ((i + W - 1) % W)] + 2 * height[r + i] + height[r + ((i + 1) % W)]) * 0.25;
    }
  }
  for (let j = 0; j < H; j++) {
    const up = Math.max(0, j - 1) * W, dn = Math.min(H - 1, j + 1) * W, r = j * W;
    for (let i = 0; i < W; i++) height[r + i] = (tmp[up + i] + 2 * tmp[r + i] + tmp[dn + i]) * 0.25;
  }
  yield;

  const toWorld = (Math.PI / 180) * MOON_RADIUS;
  const half = new Uint16Array(W * H);
  // Data textures start at the bottom row; the canvas starts at the top (north).
  for (let j = 0; j < H; j++) {
    const src = j * W, dst = (H - 1 - j) * W;
    for (let i = 0; i < W; i++) half[dst + i] = THREE.DataUtils.toHalfFloat(height[src + i] * toWorld);
  }
  const bump = new THREE.DataTexture(half, W, H, THREE.RedFormat, THREE.HalfFloatType);
  bump.wrapS = THREE.RepeatWrapping;
  bump.minFilter = bump.magFilter = THREE.LinearFilter;
  bump.needsUpdate = true;
  return { map: colorTex(col.c), bump };
}

/** Builds a Moon surface in one go. */
export function moonSurface(W = 1024, H = 512): MoonSurface {
  const job = moonSurfaceJob(W, H);
  let r = job.next();
  while (!r.done) r = job.next();
  return r.value;
}

export function radialTexture(stops: [number, string][], size = 128) {
  const { c, ctx } = canvas(size, size);
  const h = size / 2;
  const g = ctx.createRadialGradient(h, h, 0, h, h, h);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return colorTex(c);
}

export function cloudPuffTexture() {
  const { c, ctx } = canvas(256, 256);
  for (let i = 0; i < 34; i++) {
    const px = 128 + (Math.random() - 0.5) * 130, py = 138 + (Math.random() - 0.5) * 60, r = 30 + Math.random() * 50;
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return colorTex(c);
}

export function rocketPaintTexture() {
  const { c, ctx } = canvas(256, 512);
  ctx.fillStyle = "#f2f3f5";
  ctx.fillRect(0, 0, 256, 512);
  const V = (v: number) => (1 - v) * 512;
  for (let q = 0; q < 4; q++) {
    ctx.fillStyle = "#16181d";
    if (q % 2 === 0) ctx.fillRect(q * 64, V(0.36), 64, V(0.22) - V(0.36));
    else ctx.fillRect(q * 64, V(0.22), 64, V(0.06) - V(0.22));
  }
  ctx.fillStyle = "#16181d";
  ctx.fillRect(0, V(0.6), 256, V(0.57) - V(0.6));
  ctx.fillRect(0, V(0.76), 256, V(0.745) - V(0.76));
  ctx.fillStyle = "#c9372c";
  ctx.fillRect(0, V(0.52), 256, V(0.505) - V(0.52));
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    ctx.fillRect(0, Math.random() * 512, 256, 1 + Math.random() * 2);
  }
  return colorTex(c);
}

export function solarPanelTexture() {
  const { c, ctx } = canvas(128, 64);
  ctx.fillStyle = "#0f2a66";
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = "rgba(140,180,255,.45)";
  for (let i = 0; i <= 128; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 64); ctx.stroke(); }
  for (let j = 0; j <= 64; j += 16) { ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(128, j); ctx.stroke(); }
  return colorTex(c);
}

export function bumpNoiseTexture() {
  const { c, ctx } = canvas(128, 128);
  const im = ctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = fbm((i % 128) / 12, Math.floor(i / 128) / 12, 0, 5, 4) * 255;
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
    im.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Coastal scrub around the launch pad: tiling greens and sandy browns. */
export function padGroundTexture() {
  const { c, ctx } = canvas(256, 256);
  ctx.fillStyle = "#5f6a43";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 2 + Math.random() * 9;
    const sand = Math.random() < 0.3;
    ctx.fillStyle = sand
      ? `rgba(${150 + Math.random() * 40},${135 + Math.random() * 30},${95 + Math.random() * 20},.35)`
      : `rgba(${50 + Math.random() * 40},${70 + Math.random() * 40},${35 + Math.random() * 20},.4)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = colorTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
