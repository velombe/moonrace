import { NextResponse } from "next/server";
import { dayKey, daySeed } from "@/lib/daily";
import { bearer } from "@/lib/pilot";
import { issueRunToken, verifyPilotToken } from "@/lib/token";

export const dynamic = "force-dynamic";

/** Issues a signed run token with today's shared seed, bound to the pilot if they sent their key. */
export async function POST(req: Request) {
  const day = dayKey();
  const seed = daySeed(day);
  const { token } = issueRunToken(seed, day, verifyPilotToken(bearer(req)) ?? undefined);
  return NextResponse.json({ token, seed, day }, { headers: { "Cache-Control": "no-store" } });
}
