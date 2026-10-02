import { NextResponse } from "next/server";
import { newRecoveryCode, pilotFromRequest } from "@/lib/pilot";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A fresh recovery code for this pilot. Any older code stops working. */
export async function POST(req: Request) {
  const store = getStore();
  const p = await pilotFromRequest(store, req);
  if (!p) return NextResponse.json({ error: "Unknown pilot" }, { status: 401 });
  if (!(await store.rateLimit(`recovery:${p.id}`, 10, 3600))) {
    return NextResponse.json({ error: "Try again in a bit." }, { status: 429 });
  }
  return NextResponse.json({ code: await newRecoveryCode(store, p) }, { headers: { "Cache-Control": "no-store" } });
}
