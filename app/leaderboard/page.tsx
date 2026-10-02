import Link from "next/link";
import Leaderboard from "@/components/Leaderboard";
import { dayKey } from "@/lib/daily";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard — moonrace.lol" };

type Props = { searchParams: Promise<{ board?: string }> };

export default async function LeaderboardPage({ searchParams }: Props) {
  const allTime = (await searchParams).board === "all";
  const store = getStore();
  const day = dayKey();
  const [top, runs, first] = await Promise.all([
    allTime ? store.topAllTime(50) : store.top(day, 50),
    store.runsToday(day),
    store.firstMoon(),
  ]);
  return (
    <main className="page">
      <div className="col wide">
        <p className="lb-kicker">moonrace<span>.lol</span> · {allTime ? "since launch day" : `${day} UTC`}</p>
        <h1>{allTime ? "All-time furthest" : "Today’s furthest"}</h1>
        <nav className="lb-tabs" aria-label="Leaderboard">
          <Link href="/leaderboard" className={allTime ? undefined : "on"} aria-current={allTime ? undefined : "page"}>Today</Link>
          <Link href="/leaderboard?board=all" className={allTime ? "on" : undefined} aria-current={allTime ? "page" : undefined}>All time</Link>
        </nav>
        <p>
          {allTime
            ? "Each pilot's best run ever. Ties at the Moon go to the faster flight."
            : `Everyone flies the same route today. Each pilot's best run counts. ${runs.toLocaleString("en-US")} ${runs === 1 ? "run" : "runs"} so far.`}
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
          <p className="lb-empty">{allTime ? "No pilots on the board yet. Claim a callsign and fly." : "No flights yet today. The podium is yours."}</p>
        ) : (
          <Leaderboard entries={top} dated={allTime} />
        )}
        <p className="lb-note">One entry per pilot. Claim a callsign on the home screen to put your name on yours.</p>
        <p className="lb-cta"><Link className="btn go" href="/">Launch</Link></p>
      </div>
    </main>
  );
}
