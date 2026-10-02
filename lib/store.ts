import { Redis } from "@upstash/redis";

export interface RunEntry {
  runId: string;
  name: string;
  km: number;
  pct: number;
  closeCalls: number;
  reason: string;
  at: number;
}

export interface FirstMoon {
  name: string;
  at: number;
}

/**
 * Storage for runs and leaderboards. Uses Upstash Redis when configured,
 * otherwise an in-memory store (local development only; resets on restart
 * and is not shared between serverless instances).
 */
export interface Store {
  claimRun(runId: string): Promise<boolean>;
  rateLimit(key: string, limit: number, windowSec: number): Promise<boolean>;
  recordRun(day: string, entry: RunEntry): Promise<{ rank: number; total: number }>;
  top(day: string, limit: number): Promise<RunEntry[]>;
  runsToday(day: string): Promise<number>;
  claimFirstMoon(entry: FirstMoon): Promise<boolean>;
  firstMoon(): Promise<FirstMoon | null>;
}

const DAY_TTL = 60 * 60 * 24 * 8;

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

  async recordRun(day: string, e: RunEntry) {
    const board = `board:${day}`;
    await this.r.set(`run:${e.runId}`, JSON.stringify(e), { ex: DAY_TTL });
    await this.r.zadd(board, { score: e.km, member: e.runId });
    await this.r.expire(board, DAY_TTL);
    const runs = await this.r.incr(`runs:${day}`);
    if (runs === 1) await this.r.expire(`runs:${day}`, DAY_TTL);
    const higher = await this.r.zcount(board, `(${e.km}`, "+inf");
    const total = await this.r.zcard(board);
    return { rank: higher + 1, total };
  }

  async top(day: string, limit: number) {
    const ids = await this.r.zrange<string[]>(`board:${day}`, 0, limit - 1, { rev: true });
    if (!ids.length) return [];
    const raw = await this.r.mget<(RunEntry | string | null)[]>(...ids.map((id) => `run:${id}`));
    return raw
      .map((v) => (typeof v === "string" ? (JSON.parse(v) as RunEntry) : v))
      .filter((v): v is RunEntry => !!v);
  }

  async runsToday(day: string) {
    return Number((await this.r.get<number>(`runs:${day}`)) ?? 0);
  }

  async claimFirstMoon(entry: FirstMoon) {
    return (await this.r.set("moon:first", JSON.stringify(entry), { nx: true })) === "OK";
  }

  async firstMoon() {
    const v = await this.r.get<FirstMoon | string>("moon:first");
    if (!v) return null;
    return typeof v === "string" ? (JSON.parse(v) as FirstMoon) : v;
  }
}

class MemoryStore implements Store {
  private used = new Set<string>();
  private limits = new Map<string, number>();
  private boards = new Map<string, RunEntry[]>();
  private runs = new Map<string, number>();
  private first: FirstMoon | null = null;

  async claimRun(runId: string) {
    if (this.used.has(runId)) return false;
    this.used.add(runId);
    return true;
  }
  async rateLimit(key: string, limit: number, windowSec: number) {
    const k = `${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = (this.limits.get(k) ?? 0) + 1;
    this.limits.set(k, n);
    return n <= limit;
  }
  async recordRun(day: string, e: RunEntry) {
    const b = this.boards.get(day) ?? [];
    b.push(e);
    b.sort((a, c) => c.km - a.km);
    this.boards.set(day, b);
    this.runs.set(day, (this.runs.get(day) ?? 0) + 1);
    return { rank: b.filter((x) => x.km > e.km).length + 1, total: b.length };
  }
  async top(day: string, limit: number) {
    return (this.boards.get(day) ?? []).slice(0, limit);
  }
  async runsToday(day: string) {
    return this.runs.get(day) ?? 0;
  }
  async claimFirstMoon(entry: FirstMoon) {
    if (this.first) return false;
    this.first = entry;
    return true;
  }
  async firstMoon() {
    return this.first;
  }
}

const globalStore = globalThis as unknown as { __moonraceStore?: Store };

export function getStore(): Store {
  if (!globalStore.__moonraceStore) {
    const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
    globalStore.__moonraceStore = url && token ? new RedisStore(new Redis({ url, token })) : new MemoryStore();
  }
  return globalStore.__moonraceStore;
}
