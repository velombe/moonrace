import * as THREE from "three";
import { canvas, colorTex } from "../world/textures";

/** A flag or panel left at the landing site. */
export interface Planting {
  id: string;
  kind: "flag" | "panel";
  /** Shown on the pole tag or engraved on the panel. */
  name: string;
  /** ISO 3166-1 alpha-2 country code, or null for the plain moonrace flag. */
  country: string | null;
  /** Panel logo as a (small) image URL, usually a data URL. */
  logo: string | null;
  createdAt: number;
}

export type NewPlanting = Pick<Planting, "kind" | "name" | "country" | "logo">;

/** Where country flag images live (copied from flag-icons by `npm run flags`). Override for portal builds. */
export const plantingAssets = { flagUrl: (code: string) => `/flags/${code}.svg` };

const FONT = '"Saira Condensed", "Arial Narrow", sans-serif';
const images = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Draws a country flag (or the plain moonrace flag) to fill the canvas. */
export function drawFlag(ctx: CanvasRenderingContext2D, w: number, h: number, flag: HTMLImageElement | null) {
  if (flag) {
    ctx.drawImage(flag, 0, 0, w, h);
    return;
  }
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffb347";
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.42, h * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#02040b";
  ctx.font = `500 ${Math.round(h * 0.13)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("moonrace.lol", w / 2, h * 0.8);
}

export interface PanelArt {
  name: string;
  logo: HTMLImageElement | null;
  flag: HTMLImageElement | null;
  date: Date;
}

/** The engraved aluminium plaque. Also used by the UI for its live preview. */
export function drawPanel(ctx: CanvasRenderingContext2D, w: number, h: number, art: PanelArt) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#d3d6db");
  g.addColorStop(0.5, "#a9adb4");
  g.addColorStop(1, "#c7cad0");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Brushed grain, deterministic so the live preview doesn't shimmer as you type.
  const rnd = (n: number) => { const v = Math.sin(n * 12.9898) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < h; i += 2) {
    ctx.fillStyle = `rgba(${rnd(i) < 0.5 ? "255,255,255" : "40,44,52"},${rnd(i + 0.5) * 0.06})`;
    ctx.fillRect(0, i, w, 1 + rnd(i + 0.25));
  }
  const u = w / 1024;
  ctx.strokeStyle = "rgba(30,33,40,.6)";
  ctx.lineWidth = 4 * u;
  ctx.strokeRect(22 * u, 22 * u, w - 44 * u, h - 44 * u);
  for (const [x, y] of [[44, 44], [w / u - 44, 44], [44, h / u - 44], [w / u - 44, h / u - 44]]) {
    ctx.fillStyle = "#7d828b";
    ctx.beginPath(); ctx.arc(x * u, y * u, 10 * u, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#4b4f57";
    ctx.beginPath(); ctx.moveTo((x - 6) * u, y * u); ctx.lineTo((x + 6) * u, y * u); ctx.stroke();
  }

  // Engraved text: dark fill with a light lower edge.
  const engrave = (text: string, x: number, y: number, size: number, weight: number, maxW: number, align: CanvasTextAlign = "left", italic = false) => {
    ctx.font = `${italic ? "italic " : ""}${weight} ${size * u}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.fillText(text, x * u, (y + 2) * u, maxW * u);
    ctx.fillStyle = "#24272d";
    ctx.fillText(text, x * u, y * u, maxW * u);
  };
  engrave("moonrace.lol", 70, 100, 30, 500, 400);
  if (art.flag) {
    ctx.drawImage(art.flag, w - 210 * u, 64 * u, 136 * u, 102 * u);
    ctx.strokeStyle = "rgba(30,33,40,.5)";
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(w - 210 * u, 64 * u, 136 * u, 102 * u);
  }
  let x = 512, align: CanvasTextAlign = "center", maxW = 860;
  if (art.logo) {
    const box = 250, k = Math.min(box / art.logo.naturalWidth, box / art.logo.naturalHeight);
    const lw = art.logo.naturalWidth * k, lh = art.logo.naturalHeight * k;
    ctx.drawImage(art.logo, (70 + (box - lw) / 2) * u, (200 + (box - lh) / 2) * u, lw * u, lh * u);
    x = 360; align = "left"; maxW = 600;
  }
  const date = art.date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  engrave(art.name, x, 320, 104, 300, maxW, align);
  engrave(`Landed on the Moon · ${date}`, x, 386, 38, 500, maxW, align);
  engrave("Came in peace, slightly over budget.", x, 440, 30, 300, maxW, align, true);
  engrave("Mare Marginis · 13° N 80° E", 512, h / u - 70, 26, 500, 800, "center");
}

function nameTag(name: string) {
  const { c, ctx } = canvas(256, 64);
  ctx.fillStyle = "#1b1e24";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#eef2ff";
  ctx.font = `500 34px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 128, 34, 236);
  return colorTex(c);
}

const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.35, metalness: 0.85 });

/** Apollo-style flag: no wind on the Moon, so a crossbar holds the cloth out, crinkles and all. */
/**
 * Close-up reading mode for the printed face (flag cloth, panel plate): evenly
 * lit at a fixed brightness, so the sun can't glare or wash it out from any
 * angle. `false` puts the normal sunlit finish back.
 */
export function setMatte(g: THREE.Object3D, matte: boolean) {
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (!(mat instanceof THREE.MeshStandardMaterial) || !mat.userData.face) continue;
      if (matte && !mat.userData.finish) {
        mat.userData.finish = {
          roughness: mat.roughness, metalness: mat.metalness, color: mat.color.clone(),
          emissive: mat.emissive.clone(), emissiveMap: mat.emissiveMap, emissiveIntensity: mat.emissiveIntensity,
        };
        mat.roughness = 1;
        mat.metalness = 0;
        mat.color.set(0x000000);
        mat.emissive.set(0xffffff);
        mat.emissiveMap = mat.map;
        mat.emissiveIntensity = 0.82;
        mat.needsUpdate = true;
      } else if (!matte && mat.userData.finish) {
        const f = mat.userData.finish;
        mat.roughness = f.roughness;
        mat.metalness = f.metalness;
        mat.color.copy(f.color);
        mat.emissive.copy(f.emissive);
        mat.emissiveMap = f.emissiveMap;
        mat.emissiveIntensity = f.emissiveIntensity;
        mat.needsUpdate = true;
        delete mat.userData.finish;
      }
    }
  });
}

export function makeFlag(p: Planting) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 2.4, 10), metal);
  pole.position.y = 1.2;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.95, 8), metal);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0.475, 2.3, 0);
  const geo = new THREE.PlaneGeometry(0.92, 0.62, 30, 14);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 0.46, y = pos.getY(i);
    const sag = (0.31 - y) * 0.06;
    pos.setZ(i, Math.sin(x * 11 + 0.6) * 0.025 * (0.4 + x) + Math.sin(x * 23 + y * 7) * 0.008 + sag * Math.sin(x * 5));
  }
  geo.translate(0.475, 2.29 - 0.31, 0);
  geo.computeVertexNormals();
  const { c, ctx } = canvas(512, 344);
  drawFlag(ctx, 512, 344, null);
  const tex = colorTex(c);
  const clothMat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85 });
  clothMat.userData.face = true;
  const cloth = new THREE.Mesh(geo, clothMat);
  if (p.country) {
    void loadImage(plantingAssets.flagUrl(p.country)).then((img) => {
      if (!img) return;
      drawFlag(ctx, 512, 344, img);
      tex.needsUpdate = true;
    });
  }
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.065), new THREE.MeshStandardMaterial({ map: nameTag(p.name), roughness: 0.6 }));
  tag.position.set(0, 1.05, 0.02);
  g.add(pole, bar, cloth, tag);
  g.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return g;
}

/** A standard plaque on two short legs, tilted back to catch the light. Faces local +Z. */
export function makePanel(p: Planting) {
  const g = new THREE.Group();
  const { c, ctx } = canvas(1024, 640);
  const tex = colorTex(c);
  const art: PanelArt = { name: p.name, logo: null, flag: null, date: new Date(p.createdAt) };
  const draw = () => {
    drawPanel(ctx, 1024, 640, art);
    tex.needsUpdate = true;
  };
  draw();
  void Promise.all([
    p.logo ? loadImage(p.logo) : Promise.resolve(null),
    p.country ? loadImage(plantingAssets.flagUrl(p.country)) : Promise.resolve(null),
  ]).then(([logo, flag]) => {
    if (!logo && !flag) return;
    art.logo = logo;
    art.flag = flag;
    draw();
  });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.55 });
  face.userData.face = true;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.69, 0.025), [metal, metal, metal, metal, face, metal]);
  plate.position.y = 0.72;
  plate.rotation.x = -0.45;
  g.add(plate);
  for (const sx of [-0.38, 0.38]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.72, 8), metal);
    // Behind the plate: it tilts back, so legs in front would poke through its face.
    leg.position.set(sx, 0.36, -0.12);
    g.add(leg);
  }
  g.traverse((o) => (o.castShadow = o.receiveShadow = true));
  return g;
}
