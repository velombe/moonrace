import { NextResponse } from "next/server";
import { clientIp, publicPilot, recoverPilot, touchPilot } from "@/lib/pilot";
import { getStore } from "@/lib/store";
import { issuePilotToken } from "@/lib/token";

export const dynamic = "force-dynamic";

/** Bring a pilot (and their callsign) to this device with a recovery code. */
export async function POST(req: Request) {
  const store = getStore();
  // Guessing a 60-bit code is hopeless, and this keeps it that way.
  if (!(await store.rateLimit(`recover:${clientIp(req)}`, 10, 3600))) {
    return NextResponse.json({ error: "Too many tries. Wait an hour and try again." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const p = await recoverPilot(store, body.code);
  if (!p) return NextResponse.json({ error: "That code doesn't match any pilot." }, { status: 404 });
  return NextResponse.json({ token: issuePilotToken(p.id), pilot: await publicPilot(store, await touchPilot(store, p)) }, { headers: { "Cache-Control": "no-store" } });
}
