import { END_REASON_TEXT, formatKm, formatPct, type EndReason } from "@/game/constants";
import type { RunEntry } from "@/lib/store";

const MEDALS = [
  { name: "Gold", hi: "#fff1c4", mid: "#f2c35a", lo: "#9c6a1c", ring: "#ffe39a" },
  { name: "Silver", hi: "#ffffff", mid: "#c9d0dc", lo: "#6f7888", ring: "#eef2ff" },
  { name: "Bronze", hi: "#ffd9bd", mid: "#d08a57", lo: "#7a4322", ring: "#f3b98d" },
];
const PLACE = ["1st", "2nd", "3rd"];

/** Mission-patch style medal with the rank in the middle. */
export function RankBadge({ rank, size = 56 }: { rank: 1 | 2 | 3; size?: number }) {
  const m = MEDALS[rank - 1], id = `medal-${rank}`;
  return (
    <svg className="badge" width={size} height={size * 1.25} viewBox="0 0 64 80" role="img" aria-label={`${PLACE[rank - 1]} place`}>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="75%">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".55" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </radialGradient>
      </defs>
      {/* ribbon tails */}
      <path d="M20 50 L12 78 L22 72 L28 79 L32 54 Z" fill="#1b2a52" />
      <path d="M44 50 L52 78 L42 72 L36 79 L32 54 Z" fill="#24376a" />
      <circle cx="32" cy="30" r="27" fill={`url(#${id})`} />
      <circle cx="32" cy="30" r="21.5" fill="none" stroke={m.ring} strokeOpacity=".7" strokeWidth="1" strokeDasharray="1.2 2.6" />
      <circle cx="32" cy="30" r="27" fill="none" stroke="#000" strokeOpacity=".25" strokeWidth="1.2" />
      <text x="32" y="40.5" textAnchor="middle" fontFamily="Saira Condensed, Arial Narrow, sans-serif" fontWeight="800" fontSize="30" fill="#1a1407" fillOpacity=".82">{rank}</text>
    </svg>
  );
}

function reasonText(reason: string) {
  return END_REASON_TEXT[reason as EndReason] ?? "";
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** "Reached the Moon in 2:05", or the crash reason. */
function outcome(e: RunEntry) {
  return e.reason === "moon" && e.durationMs ? `Reached the Moon in ${clock(e.durationMs)}` : reasonText(e.reason);
}

const shortDate = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function details(e: RunEntry, dated: boolean) {
  const parts = [outcome(e)];
  if (e.closeCalls) parts.push(`${e.closeCalls} close call${e.closeCalls === 1 ? "" : "s"}`);
  if (dated) parts.push(shortDate(e.at));
  return parts.filter(Boolean).join(" · ");
}

/** Thin Earth → Moon track with the pilot's marker, like the in-game HUD. */
function Track({ pct }: { pct: number }) {
  return (
    <span className="lb-track" aria-hidden="true">
      <b style={{ width: `${Math.min(100, pct)}%` }} />
      <i style={{ left: `${Math.min(100, pct)}%` }} />
    </span>
  );
}

/** A board: a podium for the top three, then everyone else. `dated` shows when each run was flown (all-time). */
export default function Leaderboard({ entries, dated = false }: { entries: RunEntry[]; dated?: boolean }) {
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);
  return (
    <>
      <ol className="podium">
        {podium.map((e, i) => {
          const rank = (i + 1) as 1 | 2 | 3;
          const moon = e.reason === "moon";
          return (
            <li key={e.runId} className={`podium-card p${rank}${moon ? " moon" : ""}`}>
              <RankBadge rank={rank} size={rank === 1 ? 64 : 52} />
              <div className="podium-name">{e.name}</div>
              <div className="podium-pct num">{formatPct(e.pct)}</div>
              <div className="podium-km">{formatKm(e.km)} km</div>
              <Track pct={e.pct} />
              <div className="podium-meta">
                <span>{outcome(e)}</span>
                {e.closeCalls > 0 && <span>{e.closeCalls} close call{e.closeCalls === 1 ? "" : "s"}</span>}
                {dated && <span>{shortDate(e.at)}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <ol className="lb-list" start={4}>
          {rest.map((e, i) => (
            <li key={e.runId} className={e.reason === "moon" ? "moon" : undefined}>
              <span className="lb-rank num">{i + 4}</span>
              <span className="lb-who">
                <span className="lb-name">{e.name}</span>
                <span className="lb-meta">{details(e, dated)}</span>
                <Track pct={e.pct} />
              </span>
              <span className="lb-score">
                <span className="num">{formatPct(e.pct)}</span>
                <small>{formatKm(e.km)} km</small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
