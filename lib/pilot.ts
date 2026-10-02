import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Store } from "./store";
import { verifyPilotToken } from "./token";

/**
 * Pilots without signup: each device gets a pilot key (see issuePilotToken),
 * a callsign is reserved by the first pilot to claim it, and a recovery code
 * moves the pilot to another device.
 *
 * Keys: `pilot:<id>` record, `callsign:<normalized>` → pilot id,
 * `recover:<sha256(code)>` → pilot id.
 */
export interface Pilot {
  id: string;
  callsign: string | null;
  createdAt: number;
  /** Hash of the current recovery code, so a new one revokes the old. */
  recoveryHash?: string;
}

/** A callsign lapses after this long without a run, so names aren't held forever. */
export const CALLSIGN_TTL = 60 * 60 * 24 * 90;
const PILOT_TTL = 60 * 60 * 24 * 400;
const RECOVERY_TTL = PILOT_TTL;

const RESERVED = ["anonymous", "anonymouspilot", "houston", "missioncontrol", "moonrace", "moonracelol", "admin", "administrator", "moderator", "mod", "system", "official", "iss", "nasa"];
// Basic filter only: substrings that are never okay in a public callsign. Kept to words
// that don't hide inside ordinary names (no "cock" → Hancock, "rape" → Grape).
const BLOCKED = ["fuck", "shit", "cunt", "nigg", "faggot", "rapist", "nazi", "hitler", "whore", "slut", "bitch", "retard", "kike", "chink", "pussy", "penis", "vagina", "porn", "dildo", "wank"];

/** Callsign as shown: letters, digits, space, `_ . -`; 2–18 characters. */
export function displayCallsign(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFKC").replace(/[^\p{L}\p{N} _.\-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 18);
}

/** Uniqueness key: case, spaces and `_ . -` don't count ("Ada Lovelace" = "ada_lovelace"). */
export function callsignKey(display: string): string {
  return display.toLowerCase().replace(/[\s_.\-]/g, "");
}

/** Returns an error message, or null if the callsign is allowed. */
export function checkCallsign(display: string): string | null {
  const key = callsignKey(display);
  if (display.length < 2 || key.length < 2) return "At least 2 letters or digits.";
  if (RESERVED.includes(key)) return "That one belongs to mission control.";
  const plain = key.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (BLOCKED.some((w) => plain.includes(w))) return "Mission control would have to read that out loud. Try another.";
  return null;
}

export async function getPilot(store: Store, id: string): Promise<Pilot | null> {
  const v = await store.kvGet<Pilot | string>(`pilot:${id}`);
  if (!v) return null;
  return typeof v === "string" ? (JSON.parse(v) as Pilot) : v;
}

async function savePilot(store: Store, p: Pilot) {
  await store.kvSet(`pilot:${p.id}`, p, { ex: PILOT_TTL });
}

export async function createPilot(store: Store): Promise<Pilot> {
  const p: Pilot = { id: randomUUID(), callsign: null, createdAt: Date.now() };
  await savePilot(store, p);
  return p;
}

/**
 * Keeps a pilot and their callsign alive (called on load and on each run).
 * If the callsign lapsed and someone else took it, the pilot loses it.
 */
export async function touchPilot(store: Store, p: Pilot): Promise<Pilot> {
  if (p.callsign) {
    const key = `callsign:${callsignKey(p.callsign)}`;
    const owner = await store.kvGet<string>(key);
    if (owner === p.id) await store.kvExpire(key, CALLSIGN_TTL);
    else if (!owner && (await store.kvSet(key, p.id, { nx: true, ex: CALLSIGN_TTL }))) {
      // Lapsed but still free: quietly re-reserved.
    } else p = { ...p, callsign: null };
  }
  await savePilot(store, p);
  return p;
}

export type ClaimResult = { ok: true; pilot: Pilot } | { ok: false; taken: boolean; error: string; suggestion?: string };

/** First come, first served. Releases the pilot's previous callsign on success. */
export async function claimCallsign(store: Store, p: Pilot, raw: unknown): Promise<ClaimResult> {
  const display = displayCallsign(raw);
  const bad = checkCallsign(display);
  if (bad) return { ok: false, taken: false, error: bad };
  const key = callsignKey(display);
  const prev = p.callsign ? callsignKey(p.callsign) : null;
  if (key !== prev) {
    const mine = (await store.kvGet<string>(`callsign:${key}`)) === p.id;
    if (!mine && !(await store.kvSet(`callsign:${key}`, p.id, { nx: true, ex: CALLSIGN_TTL }))) {
      return { ok: false, taken: true, error: "Taken by another pilot.", suggestion: await suggest(store, display) };
    }
    if (prev && (await store.kvGet<string>(`callsign:${prev}`)) === p.id) await store.kvDel(`callsign:${prev}`);
  } else await store.kvExpire(`callsign:${key}`, CALLSIGN_TTL);
  // Same key, different styling ("ada" → "Ada") is just a restyle.
  const next = { ...p, callsign: display };
  await savePilot(store, next);
  return { ok: true, pilot: next };
}

async function suggest(store: Store, display: string) {
  for (let n = 2; n < 10; n++) {
    const tail = `-${n}`;
    const s = display.slice(0, 18 - tail.length) + tail;
    if (!(await store.kvGet<string>(`callsign:${callsignKey(s)}`))) return s;
  }
  return undefined;
}

// Crockford base32: no I, L, O or U, so codes survive being read aloud or handwritten.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function normalizeCode(code: string) {
  return code.toUpperCase().replace(/^MOON/, "").replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

const hashCode = (code: string) => createHash("sha256").update(`moonrace:${normalizeCode(code)}`).digest("hex");

/** New recovery code (60 bits) for this pilot; the previous one stops working. */
export async function newRecoveryCode(store: Store, p: Pilot): Promise<string> {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
  const code = `MOON-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  const hash = hashCode(code);
  if (p.recoveryHash) await store.kvDel(`recover:${p.recoveryHash}`);
  await store.kvSet(`recover:${hash}`, p.id, { ex: RECOVERY_TTL });
  await savePilot(store, { ...p, recoveryHash: hash });
  return code;
}

/** The pilot a recovery code belongs to, or null. */
export async function recoverPilot(store: Store, code: unknown): Promise<Pilot | null> {
  if (typeof code !== "string" || normalizeCode(code).length !== 12) return null;
  const id = await store.kvGet<string>(`recover:${hashCode(code)}`);
  return id ? getPilot(store, id) : null;
}

/** Client IP for rate limits. */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** Pilot key from the `Authorization: Bearer <key>` header. */
export function bearer(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** The pilot whose key signed this request, or null. */
export async function pilotFromRequest(store: Store, req: Request): Promise<Pilot | null> {
  const id = verifyPilotToken(bearer(req));
  return id ? getPilot(store, id) : null;
}

/** What the client gets to see, including their best recorded run (the all-time one). */
export async function publicPilot(store: Store, p: Pilot) {
  const b = await store.bestOf(p.id);
  return { id: p.id, callsign: p.callsign, best: b ? { pct: b.pct, km: b.km } : null };
}
