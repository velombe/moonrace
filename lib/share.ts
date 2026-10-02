export interface ShareParams {
  pct: number;
  km: number;
  closeCalls: number;
  quote?: string;
  speaker?: string;
}

export function shareQuery(p: ShareParams): string {
  const q = new URLSearchParams({
    p: p.pct.toFixed(p.pct < 10 ? 2 : 1),
    km: String(Math.floor(p.km)),
    cc: String(p.closeCalls),
  });
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
    quote: one("q")?.slice(0, 120),
    speaker: one("w")?.slice(0, 24),
  };
}
