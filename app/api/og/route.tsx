import { ImageResponse } from "next/og";
import { formatKm, formatPct } from "@/game/constants";
import { parseShare } from "@/lib/share";

/** Share card: 1200x630 image shown when a result link is posted anywhere. */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const s = parseShare(sp);
  const reached = s.pct >= 100;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "radial-gradient(circle at 78% 30%, #1a2344 0%, #050915 55%, #02040b 100%)",
          color: "#eef2ff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ position: "absolute", right: 110, top: 60, width: 200, height: 200, borderRadius: 200, background: "radial-gradient(circle at 35% 35%, #ffffff, #c7c3ba 55%, #5d5a55)", display: "flex" }} />
        <div style={{ position: "absolute", right: -220, bottom: -560, width: 760, height: 760, borderRadius: 760, background: "radial-gradient(circle at 50% 30%, #6fc3ff 0%, #2a78d6 35%, #0b2c63 70%)", boxShadow: "0 0 80px 20px rgba(90,170,255,.35)", display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", padding: "70px 80px", position: "relative" }}>
          <div style={{ fontSize: 34, letterSpacing: 2, opacity: 0.85, display: "flex" }}>
            moonrace<span style={{ color: "#ffb347" }}>.lol</span>
          </div>
          <div style={{ fontSize: 180, fontWeight: 300, lineHeight: 1, marginTop: 30, display: "flex" }}>{formatPct(s.pct)}</div>
          <div style={{ fontSize: 40, marginTop: 10, display: "flex" }}>{reached ? "Reached the Moon" : "of the way to the Moon"}</div>
          <div style={{ fontSize: 28, color: "#b4c2e0", marginTop: 14, display: "flex" }}>
            {`${formatKm(s.km)} km${s.closeCalls ? `  ·  ${s.closeCalls} close calls` : ""}`}
          </div>
          {s.quote ? (
            <div style={{ fontSize: 30, marginTop: 34, maxWidth: 720, display: "flex" }}>
              <span style={{ color: "#ffb347", marginRight: 12 }}>{s.speaker || "Houston"}</span>
              {`“${s.quote}”`}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
