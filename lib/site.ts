import type { NewPlanting, Planting } from "@/game/surface/plantings";

export type { NewPlanting, Planting } from "@/game/surface/plantings";

/**
 * Where flags and panels at the landing site are kept. Everyone who lands
 * should see everyone's plantings; for now this is device-local storage, to be
 * replaced by a cloud implementation (list from the API, logo upload to blob
 * storage) behind the same interface.
 */
export interface SiteStore {
  list(): Promise<Planting[]>;
  add(p: NewPlanting): Promise<Planting>;
}

const KEY = "moonrace-site";

/** Test store: browser localStorage (~5 MB, so logos are kept small). */
export class LocalSiteStore implements SiteStore {
  async list(): Promise<Planting[]> {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? (raw as Planting[]).sort((a, b) => a.createdAt - b.createdAt) : [];
    } catch {
      return [];
    }
  }

  async add(p: NewPlanting): Promise<Planting> {
    const all = await this.list();
    const planting: Planting = { ...p, name: cleanPlantingName(p.name), id: crypto.randomUUID(), createdAt: Date.now() };
    try {
      localStorage.setItem(KEY, JSON.stringify([...all, planting]));
    } catch {
      throw new Error("Not enough storage on this device for that logo. Try a smaller image.");
    }
    return planting;
  }
}

/** Letters, digits, spaces and a little punctuation; 2–32 characters. */
export function cleanPlantingName(raw: string): string {
  const s = raw.replace(/[^\p{L}\p{N} _.&'\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 32);
  return s.length >= 2 ? s : "Anonymous pilot";
}

/** Reads an uploaded image and shrinks it to fit `max` px, as a PNG data URL. */
export async function shrinkLogo(file: File, max = 256): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Images up to 8 MB, please.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read that image."));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((img.naturalWidth || max) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || max) * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
