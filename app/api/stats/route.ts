import { NextResponse } from "next/server";
import { dayKey } from "@/lib/daily";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = getStore();
  const day = dayKey();
  const [top, runs, firstMoon] = await Promise.all([store.top(day, 10), store.runsToday(day), store.firstMoon()]);
  return NextResponse.json(
    { day, runs, top: top.map(({ name, pct, km, closeCalls }) => ({ name, pct, km, closeCalls })), firstMoon },
    { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" } },
  );
}
