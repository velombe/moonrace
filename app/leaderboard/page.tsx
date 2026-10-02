import Link from "next/link";
import { formatKm, formatPct } from "@/game/constants";
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
      <div className="col">
        <h1>Today&apos;s furthest</h1>
        <p>
          Everyone flies the same route today ({day}, UTC). {runs.toLocaleString("en-US")} {runs === 1 ? "run" : "runs"} so far.{" "}
          {first ? `First to reach the Moon: ${first.name}.` : "Nobody has reached the Moon yet."}
        </p>
        {top.length === 0 ? (
          <p>No flights yet today. The board is yours.</p>
        ) : (
          <table className="board">
            <thead>
              <tr><th>#</th><th>Pilot</th><th className="r">Distance</th><th className="r">Of the way</th></tr>
            </thead>
            <tbody>
              {top.map((e, i) => (
                <tr key={e.runId}>
                  <td>{i + 1}</td>
                  <td>{e.name}</td>
                  <td className="r">{formatKm(e.km)} km</td>
                  <td className="r n">{formatPct(e.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ marginTop: 32 }}><Link className="btn go" href="/">Launch</Link></p>
      </div>
    </main>
  );
}
