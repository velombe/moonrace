import { NextResponse } from "next/server";
import { claimCallsign, pilotFromRequest, publicPilot } from "@/lib/pilot";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Claim or change this pilot's callsign. First come, first served. */
export async function PUT(req: Request) {
  const store = getStore();
  const p = await pilotFromRequest(store, req);
  if (!p) return NextResponse.json({ error: "Unknown pilot" }, { status: 401 });
  if (!(await store.rateLimit(`callsign:${p.id}`, 20, 3600))) {
    return NextResponse.json({ error: "That's a lot of name changes. Try again in a bit." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { callsign?: unknown };
  const r = await claimCallsign(store, p, body.callsign);
  if (!r.ok) return NextResponse.json({ error: r.error, suggestion: r.suggestion }, { status: r.taken ? 409 : 400 });
  return NextResponse.json({ pilot: await publicPilot(store, r.pilot) });
}
