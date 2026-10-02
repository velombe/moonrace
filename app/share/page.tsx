import type { Metadata } from "next";
import Link from "next/link";
import { formatKm, formatPct } from "@/game/constants";
import { deflectorSummary, parseShare, shareQuery } from "@/lib/share";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const s = parseShare(await searchParams);
  const title = s.pct >= 100 ? "Someone reached the Moon on moonrace.lol" : `${formatPct(s.pct)} of the way to the Moon`;
  const image = `/api/og?${shareQuery(s)}`;
  return {
    title,
    description: "Can you get further? 384,400 km, one rocket, no refunds.",
    openGraph: { title, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default async function SharePage({ searchParams }: Props) {
  const s = parseShare(await searchParams);
  return (
    <main className="page">
      <div className="col">
        <h1>{formatPct(s.pct)}</h1>
        <p style={{ fontSize: 20, color: "var(--ink)" }}>{s.pct >= 100 ? "They reached the Moon." : "of the way to the Moon"}</p>
        <p>
          {formatKm(s.km)} km{s.closeCalls ? `, ${s.closeCalls} close calls` : ""}{deflectorSummary(s) ? `, ${deflectorSummary(s).replace(/ · /g, ", ")}` : ""}.
          {s.quote ? ` ${s.speaker || "Houston"}: “${s.quote}”` : ""}
        </p>
        <p style={{ marginTop: 32 }}><Link className="btn go" href="/">Try to beat it</Link></p>
      </div>
    </main>
  );
}
