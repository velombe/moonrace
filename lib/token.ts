import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface RunClaims {
  runId: string;
  seed: number;
  day: string;
  iat: number; // ms since epoch
  /** The pilot flying this run, when they have a pilot key. */
  pid?: string;
}

function secret(): string {
  const s = process.env.RUN_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("RUN_SECRET must be set in production");
  }
  return s || "dev-only-secret";
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueRunToken(seed: number, day: string, pid?: string): { token: string; claims: RunClaims } {
  const claims: RunClaims = { runId: randomUUID(), seed, day, iat: Date.now(), ...(pid ? { pid } : {}) };
  const payload = b64(JSON.stringify(claims));
  return { token: `${payload}.${sign(payload)}`, claims };
}

export function verifyRunToken(token: string): RunClaims | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as RunClaims;
  } catch {
    return null;
  }
}

/** Pilot key: `p1.<pilotId>.<sig>`. Stateless; it only proves which pilot this device is. */
export function issuePilotToken(pid: string): string {
  return `p1.${pid}.${sign(`pilot:${pid}`)}`;
}

export function verifyPilotToken(token: string | null | undefined): string | null {
  const [v, pid, sig] = (token ?? "").split(".");
  if (v !== "p1" || !pid || !sig || !/^[0-9a-f-]{36}$/.test(pid)) return null;
  const expected = Buffer.from(sign(`pilot:${pid}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? pid : null;
}
