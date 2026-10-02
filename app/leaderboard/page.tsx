import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";
import { dayKey } from "@/lib/daily";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today's leaderboard — moonrace.lol" };

export default async function LeaderboardPage() {
  const store = getStore();
  const day = dayKey();
  const [top, runs, first] = await Promise.all([store.top(day, 50), store.runsToday(day), store.firstMoon()]);
  return (
    <main className="page">
      <div className="col wide">
        <p className="lb-kicker">moonrace<span>.lol</span> · {day} UTC</p>
        <h1>Today&apos;s furthest</h1>
        <p>
          Everyone flies the same route today. {runs.toLocaleString("en-US")} {runs === 1 ? "run" : "runs"} so far.
        </p>
        <p className={`lb-first${first ? " claimed" : ""}`}>
          <span className="lb-moon" aria-hidden="true" />
          {first ? (
            <span>First ever to reach the Moon: <strong>{first.name}</strong></span>
          ) : (
            <span>Nobody has reached the Moon yet. The first name goes here forever.</span>
          )}
        </p>
        {top.length === 0 ? (
          <p className="lb-empty">No flights yet today. The podium is yours.</p>
        ) : (
          <Leaderboard entries={top} />
        )}
        <p className="lb-cta"><Link className="btn go" href="/">Launch</Link></p>
      </div>
    </main>
  );
}
