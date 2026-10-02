import { Redis } from "@upstash/redis";

export interface RunEntry {
  runId: string;
  /** Callsign when flown. Boards show the pilot's current callsign instead (see `named`). */
  name: string;
  km: number;
  pct: number;
  closeCalls: number;
  reason: string;
  at: number;
  /** Owner, for runs flown with a pilot key. */
  pilotId?: string;
  /** Run length; breaks ties (faster wins), which matters most at the Moon. */
  durationMs?: number;
}

/** Where a run puts its pilot on a board. `improved`: it beat their previous best there. */
export interface Placing {
  rank: number;
  total: number;
  improved: boolean;
}

/**
 * Board ordering in one sortable number: distance to 0.1 km first, then the faster
 * run. Run tokens expire after 2 h, so durationMs < 1e7 and the parts never overlap
 * (max ≈ 3.8e13, well inside exact double range).
 */
export function runScore(e: Pick<RunEntry, "km" | "durationMs">): number {
  const ms = Math.min(9_999_999, Math.max(0, Math.round(e.durationMs ?? 9_999_999)));
  return Math.floor(e.km * 10) * 1e7 + (9_999_999 - ms);
}

export interface FirstMoon {
  name: string;
  at: number;
  pilotId?: string;
}

export const ANONYMOUS = "Anonymous pilot";

/** A board slot: one per pilot; runs flown without a pilot each get their own. */
const memberOf = (e: RunEntry) => e.pilotId ?? `anon:${e.runId}`;

/**
 * Storage for runs and leaderboards. Uses Upstash Redis when configured,
 * otherwise an in-memory store (local development only; resets on restart
 * and is not shared between serverless instances).
 *
 * Both boards hold each pilot's best run only (today's board per day, the
 * all-time board overall), and show the pilot's current callsign, so claiming
 * or changing it later renames their entries.
 */
export interface Store {
  claimRun(runId: string): Promise<boolean>;
  rateLimit(key: string, limit: number, windowSec: number): Promise<boolean>;
  /** Counts the run and keeps it if it's the pilot's best today / ever (all-time needs a pilot). */
  recordRun(day: string, entry: RunEntry): Promise<{ today: Placing; allTime: Placing | null }>;
  top(day: string, limit: number): Promise<RunEntry[]>;
  topAllTime(limit: number): Promise<RunEntry[]>;
  /** A pilot's best run ever (their all-time entry), or null. */
  bestOf(pilotId: string): Promise<RunEntry | null>;
  runsToday(day: string): Promise<number>;
  claimFirstMoon(entry: FirstMoon): Promise<boolean>;
  firstMoon(): Promise<FirstMoon | null>;
  // Small key-value layer for pilots, callsigns and recovery codes (see lib/pilot.ts).
  kvGet<T>(key: string): Promise<T | null>;
  /** Returns false if `nx` was set and the key already exists. `ex` is a TTL in seconds. */
  kvSet(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<boolean>;
  kvDel(key: string): Promise<void>;
  kvExpire(key: string, ex: number): Promise<void>;
}

const DAY_TTL = 60 * 60 * 24 * 8;
const ALL_TIME = "alltime";
const dayBoard = (day: string) => `board:${day}`;

const parse = <T,>(v: T | string | null | undefined): T | null => (typeof v === "string" ? (JSON.parse(v) as T) : v ?? null);

class RedisStore implements Store {
  constructor(private r: Redis) {}

  async claimRun(runId: string) {
    return (await this.r.set(`used:${runId}`, 1, { nx: true, ex: 60 * 60 * 24 })) === "OK";
  }

  async rateLimit(key: string, limit: number, windowSec: number) {
    const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = await this.r.incr(k);
    if (n === 1) await this.r.expire(k, windowSec);
    return n <= limit;
  }

  /** Keeps `e` as the member's entry on `board` if it beats what's there. Entries live at `<board>:e:<member>`. */
  private async keepBest(board: string, e: RunEntry, ttl?: number): Promise<Placing> {
    const member = memberOf(e), score = runScore(e);
    const prev = await this.r.zscore(board, member);
    const improved = prev === null || score > Number(prev);
    if (improved) {
      await this.r.set(`${board}:e:${member}`, JSON.stringify(e), ttl ? { ex: ttl } : undefined);
      await this.r.zadd(board, { score, member });
      if (ttl) await this.r.expire(board, ttl);
    }
    const best = improved ? score : Number(prev);
    const [higher, total] = await Promise.all([this.r.zcount(board, `(${best}`, "+inf"), this.r.zcard(board)]);
    return { rank: higher + 1, total, improved };
  }

  private async readBoard(board: string, limit: number) {
    const members = await this.r.zrange<string[]>(board, 0, limit - 1, { rev: true });
    if (!members.length) return [];
    const raw = await this.r.mget<(RunEntry | string | null)[]>(...members.map((m) => `${board}:e:${m}`));
    return this.named(raw.map((v) => parse(v)).filter((v): v is RunEntry => !!v));
  }

  /** Current callsigns for these entries' pilots. */
  private async named(entries: RunEntry[]) {
    const ids = [...new Set(entries.flatMap((e) => (e.pilotId ? [e.pilotId] : [])))];
    const pilots = ids.length ? await this.r.mget<({ callsign: string | null } | string | null)[]>(...ids.map((id) => `pilot:${id}`)) : [];
    const names = new Map(ids.map((id, i) => [id, parse(pilots[i])] as const));
    return entries.map((e) => ({ ...e, name: nameFor(e, e.pilotId ? names.get(e.pilotId) : undefined) }));
  }

  async recordRun(day: string, e: RunEntry) {
    const runs = await this.r.incr(`runs:${day}`);
    if (runs === 1) await this.r.expire(`runs:${day}`, DAY_TTL);
    const today = await this.keepBest(dayBoard(day), e, DAY_TTL);
    const allTime = e.pilotId ? await this.keepBest(ALL_TIME, e) : null;
    return { today, allTime };
  }

  top(day: string, limit: number) {
    return this.readBoard(dayBoard(day), limit);
  }

  topAllTime(limit: number) {
    return this.readBoard(ALL_TIME, limit);
  }

  async bestOf(pilotId: string) {
    return parse(await this.r.get<RunEntry | string>(`${ALL_TIME}:e:${pilotId}`));
  }

  async runsToday(day: string) {
    return Number((await this.r.get<number>(`runs:${day}`)) ?? 0);
  }

  async claimFirstMoon(entry: FirstMoon) {
    return (await this.r.set("moon:first", JSON.stringify(entry), { nx: true })) === "OK";
  }

  async firstMoon() {
    const f = parse(await this.r.get<FirstMoon | string>("moon:first"));
    if (!f?.pilotId) return f;
    return { ...f, name: nameFor(f, parse(await this.r.get<{ callsign: string | null } | string>(`pilot:${f.pilotId}`))) };
  }

  async kvGet<T>(key: string) {
    return (await this.r.get<T>(key)) ?? null;
  }
  async kvSet(key: string, value: unknown, opts: { nx?: boolean; ex?: number } = {}) {
    const r = opts.nx
      ? await this.r.set(key, value, opts.ex ? { nx: true, ex: opts.ex } : { nx: true })
      : await this.r.set(key, value, opts.ex ? { ex: opts.ex } : undefined);
    return r === "OK";
  }
  async kvDel(key: string) {
    await this.r.del(key);
  }
  async kvExpire(key: string, ex: number) {
    await this.r.expire(key, ex);
  }
}

/**
 * Display name: the pilot's current callsign, "Anonymous pilot" if they have none,
 * or the name it was flown under if the pilot record is gone.
 */
function nameFor(e: { name: string; pilotId?: string }, pilot: { callsign: string | null } | null | undefined) {
  if (!e.pilotId) return ANONYMOUS;
  if (pilot === null || pilot === undefined) return e.name || ANONYMOUS;
  return pilot.callsign ?? ANONYMOUS;
}

/** The in-memory store's data, kept apart from the class so it survives dev reloads. */
interface MemoryState {
  used: Set<string>;
  limits: Map<string, number>;
  /** board key → member → best entry. */
  boards: Map<string, Map<string, RunEntry>>;
  runs: Map<string, number>;
  first: FirstMoon | null;
  kv: Map<string, { v: unknown; until: number }>;
}

const emptyMemory = (): MemoryState => ({
  used: new Set(), limits: new Map(), boards: new Map(), runs: new Map(), first: null, kv: new Map(),
});

class MemoryStore implements Store {
  constructor(private s: MemoryState) {}

  async claimRun(runId: string) {
    if (this.s.used.has(runId)) return false;
    this.s.used.add(runId);
    return true;
  }
  async rateLimit(key: string, limit: number, windowSec: number) {
    const k = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = (this.s.limits.get(k) ?? 0) + 1;
    this.s.limits.set(k, n);
    return n <= limit;
  }
  private keepBest(board: string, e: RunEntry): Placing {
    const b = this.s.boards.get(board) ?? new Map<string, RunEntry>();
    this.s.boards.set(board, b);
    const member = memberOf(e), prev = b.get(member);
    const improved = !prev || runScore(e) > runScore(prev);
    if (improved) b.set(member, e);
    const best = runScore(b.get(member)!);
    return { rank: [...b.values()].filter((x) => runScore(x) > best).length + 1, total: b.size, improved };
  }
  private readBoard(board: string, limit: number) {
    return [...(this.s.boards.get(board)?.values() ?? [])]
      .sort((a, b) => runScore(b) - runScore(a))
      .slice(0, limit)
      .map((e) => ({ ...e, name: nameFor(e, e.pilotId ? this.pilot(e.pilotId) : undefined) }));
  }
  private pilot(id: string) {
    return (this.live(`pilot:${id}`)?.v as { callsign: string | null } | undefined) ?? null;
  }
  async recordRun(day: string, e: RunEntry) {
    this.s.runs.set(day, (this.s.runs.get(day) ?? 0) + 1);
    return { today: this.keepBest(dayBoard(day), e), allTime: e.pilotId ? this.keepBest(ALL_TIME, e) : null };
  }
  async top(day: string, limit: number) {
    return this.readBoard(dayBoard(day), limit);
  }
  async topAllTime(limit: number) {
    return this.readBoard(ALL_TIME, limit);
  }
  async bestOf(pilotId: string) {
    return this.s.boards.get(ALL_TIME)?.get(pilotId) ?? null;
  }
  async runsToday(day: string) {
    return this.s.runs.get(day) ?? 0;
  }
  async claimFirstMoon(entry: FirstMoon) {
    if (this.s.first) return false;
    this.s.first = entry;
    return true;
  }
  async firstMoon() {
    const f = this.s.first;
    return f?.pilotId ? { ...f, name: nameFor(f, this.pilot(f.pilotId)) } : f;
  }
  private live(key: string) {
    const e = this.s.kv.get(key);
    if (e && e.until < Date.now()) this.s.kv.delete(key);
    return this.s.kv.get(key);
  }
  async kvGet<T>(key: string) {
    return (this.live(key)?.v as T | undefined) ?? null;
  }
  async kvSet(key: string, value: unknown, opts: { nx?: boolean; ex?: number } = {}) {
    if (opts.nx && this.live(key)) return false;
    this.s.kv.set(key, { v: structuredClone(value), until: opts.ex ? Date.now() + opts.ex * 1000 : Infinity });
    return true;
  }
  async kvDel(key: string) {
    this.s.kv.delete(key);
  }
  async kvExpire(key: string, ex: number) {
    const e = this.live(key);
    if (e) e.until = Date.now() + ex * 1000;
  }
}

// Only the data and the connection live on globalThis (so dev reloads keep the in-memory
// boards). The store object itself is rebuilt from the current code on each module load:
// caching the instance kept old class versions alive in dev, without newly added methods.
// Bump the memory key when MemoryState's shape changes, so a running dev server starts fresh.
const shared = globalThis as unknown as { __moonraceRedis?: Redis; __moonraceMemoryV2?: MemoryState };
let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
    store = url && token
      ? new RedisStore((shared.__moonraceRedis ??= new Redis({ url, token })))
      : new MemoryStore((shared.__moonraceMemoryV2 ??= emptyMemory()));
  }
  return store;
}
