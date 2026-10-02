import { NextResponse, type NextRequest } from "next/server";
import { MOON_KM } from "@/game/constants";
import { dayKey } from "@/lib/daily";
import { ANONYMOUS, getStore, type RunEntry } from "@/lib/store";
import { verifyRunToken } from "@/lib/token";
import { getPilot, touchPilot } from "@/lib/pilot";
import { checkResult, type FinishBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const store = getStore();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!(await store.rateLimit(`finish:${ip}`, 20, 60))) {
    return NextResponse.json({ error: "Too many runs. Take a breath." }, { status: 429 });
  }

  let body: FinishBody;
  try {
    body = (await req.json()) as FinishBody;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const claims = typeof body.token === "string" ? verifyRunToken(body.token) : null;
  if (!claims) return NextResponse.json({ error: "Invalid run token" }, { status: 401 });

  const problem = checkResult(body, claims);
  if (problem) return NextResponse.json({ error: `Result rejected: ${problem}` }, { status: 422 });
  if (!(await store.claimRun(claims.runId))) {
    return NextResponse.json({ error: "Run already submitted" }, { status: 409 });
  }

  // The name comes from the pilot who started the run, never from the request body,
  // so nobody can post a score as someone else.
  const found = claims.pid ? await getPilot(store, claims.pid) : null;
  const pilot = found ? await touchPilot(store, found) : null;
  const name = pilot?.callsign ?? ANONYMOUS;
  const km = Math.min(MOON_KM, body.km);
  const pct = Math.min(100, (km / MOON_KM) * 100);
  // Runs that cross midnight count for the day they started, if it's still today or yesterday.
  const today = dayKey();
  const day = claims.day === today || Date.now() - claims.iat < 2 * 60 * 60 * 1000 ? claims.day : today;
  const entry: RunEntry = {
    runId: claims.runId,
    name,
    km,
    pct,
    closeCalls: Math.floor(body.closeCalls),
    reason: body.reason,
    at: Date.now(),
    durationMs: Math.round(body.durationMs),
    ...(pilot ? { pilotId: pilot.id } : {}),
  };
  // Both boards keep each pilot's best run only; names are their current callsign when read.
  const placed = await store.recordRun(day, entry);
  const { rank, total } = placed.today;
  const allTime = placed.allTime;
  let firstToMoon = false;
  if (body.reason === "moon") firstToMoon = await store.claimFirstMoon({ name, at: Date.now(), ...(pilot ? { pilotId: pilot.id } : {}) });

  return NextResponse.json({ rank, total, firstToMoon, allTime });
}
