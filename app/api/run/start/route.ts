import { NextResponse } from "next/server";
import { dayKey, daySeed } from "@/lib/daily";
import { issueRunToken } from "@/lib/token";

export const dynamic = "force-dynamic";

/** Issues a signed run token with today's shared seed. */
export async function POST() {
  const day = dayKey();
  const seed = daySeed(day);
  const { token } = issueRunToken(seed, day);
  return NextResponse.json({ token, seed, day }, { headers: { "Cache-Control": "no-store" } });
}
