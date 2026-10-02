export interface ShareParams {
  pct: number;
  km: number;
  closeCalls: number;
  /** Deflector tallies; satellites destroyed is the shame stat. */
  asteroids?: number;
  satellites?: number;
  quote?: string;
  speaker?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 asteroids deflected · 1 satellite destroyed (sorry)", or "" if there's nothing to say. */
export function deflectorSummary(s: { asteroids?: number; satellites?: number }): string {
  const parts: string[] = [];
  if (s.asteroids) parts.push(`${plural(s.asteroids, "asteroid", "asteroids")} deflected`);
  if (s.satellites) parts.push(`${plural(s.satellites, "satellite", "satellites")} destroyed (sorry)`);
  return parts.join(" · ");
}

export function shareQuery(p: ShareParams): string {
  const q = new URLSearchParams({
    p: p.pct.toFixed(p.pct < 10 ? 2 : 1),
    km: String(Math.floor(p.km)),
    cc: String(p.closeCalls),
  });
  if (p.asteroids) q.set("ad", String(p.asteroids));
  if (p.satellites) q.set("sd", String(p.satellites));
  if (p.quote) q.set("q", p.quote.slice(0, 120));
  if (p.speaker) q.set("w", p.speaker.slice(0, 24));
  return q.toString();
}

export function parseShare(sp: Record<string, string | string[] | undefined>): ShareParams {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const num = (k: string, max: number) => Math.min(max, Math.max(0, Number(one(k)) || 0));
  return {
    pct: num("p", 100),
    km: num("km", 384400),
    closeCalls: Math.floor(num("cc", 9999)),
    asteroids: Math.floor(num("ad", 999)),
    satellites: Math.floor(num("sd", 999)),
    quote: one("q")?.slice(0, 120),
    speaker: one("w")?.slice(0, 24),
  };
}
