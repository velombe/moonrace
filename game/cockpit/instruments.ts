import * as THREE from "three";
import { formatKm } from "../constants";
import { LANE_X, LANE_Y } from "../world/obstacles";
import { canvas, colorTex } from "../world/textures";

/** Something ahead of the ship, relative to it (z = distance ahead). */
export interface Threat {
  x: number;
  y: number;
  z: number;
  r: number;
  fuel: boolean;
}

export interface ScreenData {
  km: number;
  pct: number;
  kmps: number;
  fuel: number;
  /** Mission time in seconds, or negative during the countdown. */
  t: number;
  roll: number;
  pitch: number;
  space: number;
  threats: Threat[];
}

const INK = "#eef2ff", HAZE = "#9aabcf", FLARE = "#ffb347", SIGNAL = "#ff4d5e", BG = "#050b16";
const FONT = '"Saira Condensed", "Arial Narrow", sans-serif';
/** Radar shows contacts up to this far ahead (game units). */
const RADAR_RANGE = 260;

function screen(w: number, h: number) {
  const { c, ctx } = canvas(w, h);
  const tex = colorTex(c);
  tex.anisotropy = 1;
  return { c, ctx, tex };
}

/** The three glass-cockpit displays, redrawn a dozen times a second. */
export class Screens {
  private flightS = screen(256, 192);
  private radarS = screen(256, 256);
  private fuelS = screen(256, 192);
  readonly flight = this.flightS.tex;
  readonly radar = this.radarS.tex;
  readonly fuel = this.fuelS.tex;
  private acc = 1;
  private time = 0;

  update(dt: number, d: ScreenData) {
    this.time += dt;
    this.acc += dt;
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    this.drawFlight(d);
    this.drawRadar(d);
    this.drawFuel(d);
  }

  private frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(154,171,207,.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = HAZE;
    ctx.font = `500 15px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, 14, 24);
  }

  private drawFlight(d: ScreenData) {
    const { ctx, tex } = this.flightS, w = 256, h = 192;
    this.frame(ctx, w, h, "Altitude");
    ctx.fillStyle = INK;
    ctx.font = `300 34px ${FONT}`;
    ctx.fillText(`${formatKm(d.km)} km`, 14, 60, 150);
    ctx.fillStyle = HAZE;
    ctx.font = `500 15px ${FONT}`;
    ctx.fillText("Velocity", 14, 88);
    ctx.fillStyle = INK;
    ctx.font = `300 26px ${FONT}`;
    ctx.fillText(`${d.kmps < 100 ? d.kmps.toFixed(1) : formatKm(d.kmps)} km/s`, 14, 116, 150);
    const t = Math.abs(d.t), m = Math.floor(t / 60), s = Math.floor(t % 60);
    ctx.fillStyle = FLARE;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(`T${d.t < 0 ? "-" : "+"}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, 14, 172);

    // Attitude ball: sky over ground in the atmosphere, Earth under black in space.
    const cx = 200, cy = 72, r = 40;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-d.roll * 3);
    const off = THREE.MathUtils.clamp(d.pitch * 120, -r, r);
    ctx.fillStyle = d.space > 0.5 ? "#02040b" : "#2a6bb5";
    ctx.fillRect(-r * 2, -r * 2, r * 4, r * 2 + off);
    ctx.fillStyle = d.space > 0.5 ? "#16335e" : "#6b4a2b";
    ctx.fillRect(-r * 2, off, r * 4, r * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-r * 2, off);
    ctx.lineTo(r * 2, off);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = FLARE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy); ctx.lineTo(cx - 8, cy); ctx.lineTo(cx, cy + 6); ctx.lineTo(cx + 8, cy); ctx.lineTo(cx + 22, cy);
    ctx.stroke();
    ctx.strokeStyle = "rgba(154,171,207,.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Earth → Moon progress.
    const x0 = 150, x1 = 238, y = 160;
    ctx.strokeStyle = "rgba(238,242,255,.3)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillStyle = "#4aa3ff"; ctx.beginPath(); ctx.arc(x0, y, 5, 0, 7); ctx.fill();
    ctx.fillStyle = "#d9d5cc"; ctx.beginPath(); ctx.arc(x1, y, 5, 0, 7); ctx.fill();
    ctx.fillStyle = FLARE; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * Math.min(1, d.pct / 100), y, 4, 0, 7); ctx.fill();
    tex.needsUpdate = true;
  }

  private drawRadar(d: ScreenData) {
    const { ctx, tex } = this.radarS, w = 256, cx = 128, cy = 136, R = 104;
    this.frame(ctx, w, w, "Proximity");
    const sc = R / (LANE_X * 1.3);
    ctx.strokeStyle = "rgba(154,171,207,.28)";
    ctx.lineWidth = 1.5;
    for (const k of [1 / 3, 2 / 3, 1]) {
      ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,179,71,.35)";
    ctx.strokeRect(cx - LANE_X * sc, cy - LANE_Y * sc, LANE_X * 2 * sc, LANE_Y * 2 * sc);

    // Sweep.
    const a = this.time * 2.4;
    const g = typeof ctx.createConicGradient === "function" ? ctx.createConicGradient(a - 0.9, cx, cy) : null;
    if (g) {
      g.addColorStop(0, "rgba(255,179,71,0)");
      g.addColorStop(0.14, "rgba(255,179,71,.16)");
      g.addColorStop(0.145, "rgba(255,179,71,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    }

    let danger = false;
    for (const o of d.threats) {
      if (o.z < 0 || o.z > RADAR_RANGE) continue;
      const near = 1 - o.z / RADAR_RANGE;
      const px = cx + o.x * sc, py = cy - o.y * sc;
      const hit = !o.fuel && o.z < 140 && Math.hypot(o.x, o.y) < o.r + 0.9;
      danger ||= hit;
      ctx.globalAlpha = 0.35 + 0.65 * near;
      ctx.fillStyle = o.fuel ? FLARE : hit ? (Math.floor(this.time * 8) % 2 ? SIGNAL : "#ffd0d5") : INK;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, (1.5 + o.r * sc * 0.5) * (0.4 + 0.6 * near)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = FLARE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 6, cy + 5); ctx.lineTo(cx - 6, cy + 5); ctx.closePath();
    ctx.stroke();
    ctx.font = `500 15px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillStyle = danger ? SIGNAL : HAZE;
    ctx.fillText(danger ? "Collision course" : `${d.threats.length} contacts`, w - 14, 24);
    tex.needsUpdate = true;
  }

  private drawFuel(d: ScreenData) {
    const { ctx, tex } = this.fuelS, w = 256, h = 192;
    const low = d.fuel < 25, blink = Math.floor(this.time * 3) % 2 === 0;
    this.frame(ctx, w, h, "Fuel");
    if (low && blink) {
      ctx.fillStyle = "rgba(255,77,94,.16)";
      ctx.fillRect(7, 7, w - 14, h - 14);
    }
    ctx.fillStyle = low ? SIGNAL : INK;
    ctx.font = `200 72px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(`${Math.max(0, Math.round(d.fuel))}%`, 14, 104);
    const x = 16, y = 124, bw = w - 32, bh = 16;
    ctx.fillStyle = "rgba(238,242,255,.12)";
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = low ? SIGNAL : FLARE;
    ctx.fillRect(x, y, bw * Math.max(0, Math.min(1, d.fuel / 100)), bh);
    ctx.fillStyle = BG;
    for (let i = 1; i < 10; i++) ctx.fillRect(x + (bw * i) / 10 - 1, y, 2, bh);
    ctx.font = `500 16px ${FONT}`;
    ctx.fillStyle = low ? (blink ? SIGNAL : HAZE) : HAZE;
    ctx.fillText(low ? "Low fuel. Grab a canister." : d.fuel > 99 ? "Tanks full" : "Nominal", 16, 168, w - 32);
    tex.needsUpdate = true;
  }
}
