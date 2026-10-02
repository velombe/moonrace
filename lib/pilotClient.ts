/**
 * Browser side of pilots (see lib/pilot.ts): keeps this device's pilot key in
 * localStorage and sends it as a header, which also works inside portal iframes
 * where cookies are blocked.
 */
export interface PilotInfo {
  id: string;
  callsign: string | null;
  /** Best recorded run (what the all-time board shows); null until one is recorded with a callsign. */
  best: { pct: number; km: number } | null;
}

export type ClaimResult = { ok: true; pilot: PilotInfo } | { ok: false; error: string; suggestion?: string };

const KEY = "moonrace-pilot";

function getKey() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function setKey(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {}
}

/** Authorization header for API calls, if this device has a pilot. */
export function pilotHeaders(): Record<string, string> {
  const k = getKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

const jsonHeaders = () => ({ "Content-Type": "application/json", ...pilotHeaders() });

type Ensured = { pilot: PilotInfo; claim?: { error: string; suggestion?: string } } | null;
let pending: Promise<Ensured> | null = null;

/**
 * Loads this device's pilot, or creates one (claiming the callsign typed before
 * pilots existed). `claim` says why that callsign couldn't be claimed. Null if
 * the server can't be reached; the game still plays, unsubmitted.
 */
export function ensurePilot(localCallsign: string): Promise<Ensured> {
  // One request at a time: a double mount (React Strict Mode) must not make two pilots.
  pending ??= loadPilot(localCallsign).finally(() => {
    pending = null;
  });
  return pending;
}

async function loadPilot(localCallsign: string): Promise<Ensured> {
  const wanted = localCallsign.trim();
  try {
    if (getKey()) {
      const r = await fetch("/api/pilot", { headers: pilotHeaders(), cache: "no-store" });
      if (r.ok) {
        const { pilot } = (await r.json()) as { pilot: PilotInfo };
        // Lost the callsign (lapsed and taken) or never had one: try the local one again.
        if (!pilot.callsign && wanted) {
          const c = await claimCallsign(wanted);
          return c.ok ? { pilot: c.pilot } : { pilot, claim: { error: c.error, suggestion: c.suggestion } };
        }
        return { pilot };
      }
      if (r.status !== 401) return null;
    }
    const r = await fetch("/api/pilot", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ callsign: wanted }) });
    if (!r.ok) return null;
    const d = (await r.json()) as { token: string; pilot: PilotInfo; claim?: { error: string; suggestion?: string } };
    setKey(d.token);
    return { pilot: d.pilot, claim: d.claim };
  } catch {
    return null;
  }
}

export async function claimCallsign(callsign: string): Promise<ClaimResult> {
  try {
    const r = await fetch("/api/pilot/callsign", { method: "PUT", headers: jsonHeaders(), body: JSON.stringify({ callsign }) });
    const d = await r.json();
    return r.ok ? { ok: true, pilot: d.pilot } : { ok: false, error: d.error ?? "Couldn't save that.", suggestion: d.suggestion };
  } catch {
    return { ok: false, error: "Can't reach mission control. Try again." };
  }
}

/** A new recovery code; the previous one stops working. */
export async function newRecoveryCode(): Promise<string> {
  const r = await fetch("/api/pilot/recovery", { method: "POST", headers: pilotHeaders() });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Couldn't make a code.");
  return d.code as string;
}

/** Switches this device to the pilot a recovery code belongs to. */
export async function recoverPilot(code: string): Promise<ClaimResult> {
  try {
    const r = await fetch("/api/pilot/recover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.error ?? "That code didn't work." };
    setKey(d.token);
    return { ok: true, pilot: d.pilot };
  } catch {
    return { ok: false, error: "Can't reach mission control. Try again." };
  }
}
