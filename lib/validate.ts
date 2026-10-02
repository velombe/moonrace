import { MOON_KM, kmAt, maxUnitsIn, type EndReason } from "@/game/constants";
import type { RunClaims } from "./token";

export interface FinishBody {
  token: string;
  km: number;
  durationMs: number;
  closeCalls: number;
  reason: EndReason;
  name?: string;
}

const REASONS: EndReason[] = ["balloon", "satellite", "junk", "asteroid", "fuel", "moon"];
const MAX_TOKEN_AGE_MS = 2 * 60 * 60 * 1000;

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Anonymous pilot";
  const s = raw.replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 18);
  return s.length >= 2 ? s : "Anonymous pilot";
}

/**
 * Rejects results that are physically impossible for this run.
 * Returns an error string, or null if the result is plausible.
 */
export function checkResult(body: FinishBody, claims: RunClaims, now = Date.now()): string | null {
  if (!REASONS.includes(body.reason)) return "bad reason";
  if (![body.km, body.durationMs, body.closeCalls].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) return "bad numbers";
  const elapsed = now - claims.iat;
  if (elapsed > MAX_TOKEN_AGE_MS) return "token expired";
  // The run can't have lasted longer than the time since the token was issued.
  if (body.durationMs > elapsed + 2000) return "duration exceeds elapsed time";
  // Distance can't exceed what a perfect, always-boosting player could cover.
  const maxKm = kmAt(maxUnitsIn(body.durationMs / 1000)) * 1.01 + 1;
  if (body.km > Math.min(MOON_KM, maxKm)) return "distance too high for duration";
  if (body.reason === "moon" && body.km < MOON_KM * 0.999) return "moon claim without distance";
  if (body.closeCalls > body.durationMs / 250 + 2) return "too many close calls";
  return null;
}
