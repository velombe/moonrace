/** UTC day key, e.g. "2026-09-30". Everyone shares the same daily run. */
export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Deterministic seed for a given day, so every player gets the same run layout. */
export function daySeed(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
