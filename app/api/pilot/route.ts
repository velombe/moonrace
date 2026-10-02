import { NextResponse } from "next/server";
import { claimCallsign, clientIp, createPilot, pilotFromRequest, publicPilot, touchPilot } from "@/lib/pilot";
import { getStore } from "@/lib/store";
import { issuePilotToken } from "@/lib/token";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** The signed-in pilot (Authorization: Bearer <pilot key>). Keeps their callsign reserved. */
export async function GET(req: Request) {
  const store = getStore();
  const p = await pilotFromRequest(store, req);
  if (!p) return NextResponse.json({ error: "Unknown pilot" }, { status: 401, headers: noStore });
  return NextResponse.json({ pilot: await publicPilot(store, await touchPilot(store, p)) }, { headers: noStore });
}

/** New pilot for this device, optionally claiming a callsign in the same step. */
export async function POST(req: Request) {
  const store = getStore();
  if (!(await store.rateLimit(`pilot-new:${clientIp(req)}`, 10, 3600))) {
    return NextResponse.json({ error: "Too many new pilots from here. Try again later." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { callsign?: unknown };
  let p = await createPilot(store);
  let claim: { error: string; suggestion?: string } | undefined;
  if (typeof body.callsign === "string" && body.callsign.trim()) {
    const r = await claimCallsign(store, p, body.callsign);
    if (r.ok) p = r.pilot;
    else claim = { error: r.error, suggestion: r.suggestion };
  }
  return NextResponse.json({ token: issuePilotToken(p.id), pilot: await publicPilot(store, p), claim }, { headers: noStore });
}
