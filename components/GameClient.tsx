"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Game, type GameState, type HudRefs, type RunResult, type TestFlight } from "@/game/Game";
import { END_REASON_TEXT, formatKm, formatPct } from "@/game/constants";
import { LANDMARKS } from "@/game/moonAtlas";
import { dayKey, daySeed } from "@/lib/daily";
import { deflectorSummary, shareQuery } from "@/lib/share";
import { LocalSiteStore, type Planting, type SiteStore } from "@/lib/site";
import SurfaceUI from "./SurfaceUI";

type Phase = "loading" | GameState;

interface RunTicket {
  token: string;
  seed: number;
}

interface Stats {
  runs: number;
  top: { name: string; pct: number; km: number }[];
  firstMoon: { name: string } | null;
}

type Submit =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; rank: number; total: number; firstToMoon: boolean }
  | { status: "error"; message: string };

/**
 * Test flights (`?test=moon` or `?test=<percent>`) start near the Moon with no
 * collisions and are never submitted. Always on in dev; in production only
 * with NEXT_PUBLIC_TEST_FLIGHTS=1.
 */
function readTestFlight(): TestFlight | null {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_TEST_FLIGHTS !== "1") return null;
  const v = new URLSearchParams(location.search).get("test");
  if (!v) return null;
  const pct = v === "moon" ? 85 : parseFloat(v);
  return Number.isFinite(pct) ? { startPct: Math.min(99.5, Math.max(0, pct)) } : null;
}

/** `?test=surface` offers a jump straight to the landing site (same gating as test flights). */
function readTestSurface(): boolean {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_TEST_FLIGHTS !== "1") return false;
  return new URLSearchParams(location.search).get("test") === "surface";
}

/** End-screen line for the deflector: what it took out, or a dry note if every shot missed. */
function deflectorLine(r: RunResult) {
  const sum = deflectorSummary(r);
  if (sum) return r.junk ? `${sum} · ${r.junk} junk cleared` : sum;
  return r.junk ? `${r.junk} junk cleared` : `${r.shots} deflector shot${r.shots === 1 ? "" : "s"}, all missed`;
}

function readLocal(key: string, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export default function GameClient() {
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const r = {
    km: useRef<HTMLDivElement>(null), pct: useRef<HTMLDivElement>(null), marker: useRef<HTMLElement>(null), fill: useRef<HTMLElement>(null),
    clock: useRef<HTMLDivElement>(null), fuelPct: useRef<HTMLDivElement>(null), fuelBar: useRef<HTMLElement>(null),
    toast: useRef<HTMLDivElement>(null), toastTitle: useRef<HTMLElement>(null), toastDetail: useRef<HTMLSpanElement>(null),
    count: useRef<HTMLDivElement>(null), nm: useRef<HTMLDivElement>(null), nmTitle: useRef<HTMLElement>(null), nmDetail: useRef<HTMLSpanElement>(null),
    edgeL: useRef<HTMLDivElement>(null), edgeR: useRef<HTMLDivElement>(null),
    chat: useRef<HTMLDivElement>(null), chatWho: useRef<HTMLElement>(null), chatText: useRef<HTMLSpanElement>(null),
    fade: useRef<HTMLDivElement>(null), pip: useRef<HTMLButtonElement>(null), pipLabel: useRef<HTMLSpanElement>(null),
    moonAlt: useRef<HTMLSpanElement>(null),
    reticle: useRef<HTMLDivElement>(null), reticleLabel: useRef<HTMLSpanElement>(null),
  };
  const pipRefs = useRef<HTMLElement[]>([]);
  const markRefs = useRef<HTMLElement[]>([]);
  const siteLabelRefs = useRef<HTMLElement[]>([]);
  // Device-local for now; swap in a cloud SiteStore without touching the UI.
  const storeRef = useRef<SiteStore>(new LocalSiteStore());
  const flareRefs = useRef<HTMLElement[]>([]);
  const gameRef = useRef<Game | null>(null);
  const ticketRef = useRef<RunTicket | null>(null);
  const activeTokenRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("loading");
  const [result, setResult] = useState<RunResult | null>(null);
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });
  const [stats, setStats] = useState<Stats | null>(null);
  const [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [callsign, setCallsign] = useState("");
  const [best, setBest] = useState(0);
  const [shareLabel, setShareLabel] = useState("Share result");
  const [test, setTest] = useState<TestFlight | null>(null);
  const [obsLoading, setObsLoading] = useState(false);
  const [landmark, setLandmark] = useState<string | null>(null);
  const [lowSun, setLowSun] = useState(true);
  const [testSurface, setTestSurface] = useState(false);
  const [plantings, setPlantings] = useState<Planting[]>([]);
  const [planted, setPlanted] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [mine, setMine] = useState<string[]>([]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.ok) setStats((await res.json()) as Stats);
    } catch {}
  }, []);

  const prefetchTicket = useCallback(async () => {
    try {
      const res = await fetch("/api/run/start", { method: "POST" });
      if (res.ok) ticketRef.current = (await res.json()) as RunTicket;
    } catch {
      ticketRef.current = null;
    }
  }, []);

  const handleGameOver = useCallback(
    async (res: RunResult) => {
      setResult(res);
      setShareLabel("Share result");
      if (res.test) {
        activeTokenRef.current = null;
        setSubmit({ status: "error", message: "Test flight. Not added to today's board." });
        return;
      }
      const prevBest = parseFloat(readLocal("moonrace-best", "0")) || 0;
      if (res.pct > prevBest) {
        writeLocal("moonrace-best", String(res.pct));
        setBest(res.pct);
      }
      const token = activeTokenRef.current;
      activeTokenRef.current = null;
      if (!token) {
        setSubmit({ status: "error", message: "Offline run. Not added to today's board." });
        return;
      }
      setSubmit({ status: "sending" });
      try {
        const r = await fetch("/api/run/finish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            km: res.km,
            durationMs: res.durationMs,
            closeCalls: res.closeCalls,
            shots: res.shots,
            asteroids: res.asteroids,
            satellites: res.satellites,
            reason: res.reason,
            name: readLocal("moonrace-callsign"),
          }),
        });
        const data = await r.json();
        if (!r.ok) setSubmit({ status: "error", message: data.error ?? "Couldn't reach the leaderboard." });
        else setSubmit({ status: "done", rank: data.rank, total: data.total, firstToMoon: data.firstToMoon });
      } catch {
        setSubmit({ status: "error", message: "Couldn't reach the leaderboard." });
      }
      void loadStats();
    },
    [loadStats],
  );

  // Create the game once the HUD elements exist.
  useEffect(() => {
    setCallsign(readLocal("moonrace-callsign"));
    setTest(readTestFlight());
    setTestSurface(readTestSurface());
    void storeRef.current.list().then(setPlantings);
    setBest(parseFloat(readLocal("moonrace-best", "0")) || 0);
    let game: Game | null = null;
    const timer = setTimeout(() => {
      if (!hostRef.current || !stageRef.current) return;
      const hud: HudRefs = {
        root: stageRef.current,
        km: r.km.current!, pct: r.pct.current!, marker: r.marker.current!, fill: r.fill.current!,
        clock: r.clock.current!, fuelPct: r.fuelPct.current!, fuelBar: r.fuelBar.current!,
        toast: r.toast.current!, toastTitle: r.toastTitle.current!, toastDetail: r.toastDetail.current!,
        count: r.count.current!, nearMiss: r.nm.current!, nearMissTitle: r.nmTitle.current!, nearMissDetail: r.nmDetail.current!,
        edgeLeft: r.edgeL.current!, edgeRight: r.edgeR.current!, flares: flareRefs.current,
        chatter: { root: r.chat.current!, speaker: r.chatWho.current!, text: r.chatText.current! },
        fade: r.fade.current!, pip: r.pip.current!, pipLabel: r.pipLabel.current!,
        moonMarks: markRefs.current, moonAlt: r.moonAlt.current!,
        siteLabels: siteLabelRefs.current,
        reticle: r.reticle.current!, reticleLabel: r.reticleLabel.current!, deflectorPips: pipRefs.current,
      };
      game = new Game(hostRef.current, hud, {
        onStateChange: (s) => setPhase(s),
        onFocusPlanting: (id) => setFocused(id),
        onGameOver: (res) => void handleGameOver(res),
      });
      gameRef.current = game;
      setMuted(game.audio.muted);
      setVoiceOn(game.voice.enabled);
      setVoiceSupported(game.voice.supported);
      setPhase("title");
    }, 30);
    void prefetchTicket();
    void loadStats();
    return () => {
      clearTimeout(timer);
      game?.destroy();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const launch = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    setResult(null);
    setSubmit({ status: "idle" });
    if (test) {
      activeTokenRef.current = null;
      game.start(daySeed(dayKey()), test);
      return;
    }
    const ticket = ticketRef.current;
    ticketRef.current = null;
    activeTokenRef.current = ticket?.token ?? null;
    game.start(ticket?.seed ?? daySeed(dayKey()));
    void prefetchTicket();
  }, [prefetchTicket, test]);

  const openObservatory = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    setObsLoading(true);
    setLandmark(null);
    // Let "Pointing the telescope" paint before the first visit builds the detailed Moon.
    setTimeout(() => {
      game.observe();
      setObsLoading(false);
    }, 40);
  }, []);

  const pickLandmark = useCallback((id: string) => {
    setLandmark(id);
    gameRef.current?.focusLandmark(id);
  }, []);

  useEffect(() => {
    if (phase !== "observe") setLandmark(null);
    if (phase === "landing") {
      setPlanted(false);
      setShowReport(false);
      setMine([]);
    }
    if (phase !== "surface") setFocused(null);
  }, [phase]);

  // The landing site shows every planting we know about.
  useEffect(() => {
    gameRef.current?.setPlantings(plantings);
  }, [plantings, phase]);

  const toggleMute = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.setMuted(!g.audio.muted);
    setMuted(g.audio.muted);
  }, []);

  const toggleVoice = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    g.setVoice(!g.voice.enabled);
    setVoiceOn(g.voice.enabled);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "m" || e.key === "M") toggleMute();
      if ((e.key === "v" || e.key === "V") && voiceSupported) toggleVoice();
      if ((e.key === " " || e.key === "Enter") && (phase === "title" || phase === "over") && tag !== "BUTTON" && tag !== "A") {
        e.preventDefault();
        launch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, launch, toggleMute, toggleVoice, voiceSupported]);

  const share = useCallback(async () => {
    if (!result) return;
    const url = `${location.origin}/share?${shareQuery({
      pct: result.pct,
      km: result.km,
      closeCalls: result.closeCalls,
      asteroids: result.asteroids,
      satellites: result.satellites,
      quote: result.quote?.text,
      speaker: result.quote?.speaker,
    })}`;
    const text =
      result.reason === "moon"
        ? "I reached the Moon on moonrace.lol 🚀🌕"
        : `I made it ${formatPct(result.pct)} of the way to the Moon 🚀`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "moonrace.lol", text, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShareLabel("Link copied");
    } catch {
      setShareLabel("Copy failed");
    }
  }, [result]);

  const leader = stats?.top[0];
  const spot = LANDMARKS.find((l) => l.id === landmark) ?? null;

  return (
    <div className="stage" ref={stageRef}>
      <div className="canvas-host" ref={hostRef} aria-label="Race to the Moon game" />
      <div className="flares" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} ref={(el) => { if (el) flareRefs.current[i] = el; }} />
        ))}
      </div>
      <div className="vignette" aria-hidden="true" />

      <div className="hud hud-part">
        <div className="track">
          <span className="dot earth" aria-hidden="true" />
          <div className="line"><b ref={r.fill} /><i className="marker" ref={r.marker} /></div>
          <span className="dot moon" aria-hidden="true" />
        </div>
        <div className="km num" ref={r.km}>0 km</div>
        <div className="pct" ref={r.pct}>0% of the way to the Moon</div>
      </div>
      <div className="met hud-part"><small>Mission time</small><div className="num" ref={r.clock}>T+00:00</div></div>
      <div className="fuelbox hud-part">
        <div className="deflector" aria-label="Deflector charge">
          <small>Deflector</small>
          <span className="pips">
            {[0, 1, 2].map((i) => (
              <i key={i} ref={(el) => { if (el) pipRefs.current[i] = el; }} />
            ))}
          </span>
        </div>
        <small>Fuel</small>
        <div className="num" ref={r.fuelPct}>100%</div>
        <div className="fuel"><i ref={r.fuelBar} /></div>
      </div>

      <div className="edge left" ref={r.edgeL} aria-hidden="true" />
      <div className="edge right" ref={r.edgeR} aria-hidden="true" />
      <div className="nm" ref={r.nm} aria-live="polite"><strong ref={r.nmTitle} /><span ref={r.nmDetail} /></div>
      <div className="chat" ref={r.chat} aria-live="polite"><b ref={r.chatWho} /><span ref={r.chatText} /></div>
      <div className="toast" ref={r.toast} role="status"><strong ref={r.toastTitle} /><span ref={r.toastDetail} /></div>
      <div className="count num" ref={r.count} />
      <div className="reticle" ref={r.reticle} aria-hidden="true"><span ref={r.reticleLabel} /></div>
      <button
        className="fire hud-part"
        aria-label="Fire deflector"
        onPointerDown={(e) => {
          e.preventDefault();
          gameRef.current?.fire();
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>

      <button className="pip" ref={r.pip} aria-label="Swap camera view (C)" title="Swap camera (C)">
        <span className="pip-tag"><i className="pip-dot" aria-hidden="true" /><span ref={r.pipLabel}>Cabin cam</span></span>
        <svg className="pip-swap" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9h13l-4-4M20 15H7l4 4" />
        </svg>
        <span className="pip-lost" aria-hidden="true"><span>Signal lost</span></span>
      </button>
      <div className="skip" aria-hidden="true">Tap or press Space to skip the launch</div>

      <div className="obs" aria-hidden={phase !== "observe"}>
        {LANDMARKS.map((l, i) => (
          <button
            key={l.id}
            className={`mk${l.kind === "Apollo landing site" ? " apollo" : ""}${l.id === "moonrace" ? " home" : ""}${landmark === l.id ? " on" : ""}`}
            ref={(el) => { if (el) markRefs.current[i] = el; }}
            onClick={() => pickLandmark(l.id)}
            tabIndex={phase === "observe" ? 0 : -1}
          >
            <i aria-hidden="true" /><span>{l.name}</span>
          </button>
        ))}
        <header className="obs-top">
          <button className="btn ghost slim" onClick={() => gameRef.current?.leaveObservatory()} tabIndex={phase === "observe" ? 0 : -1}>Back</button>
          <div className="obs-title">
            <h2>Lunar observatory</h2>
            <p>Looking from <span className="num" ref={r.moonAlt}>0 km</span> up. To land, you&apos;ll have to fly there.</p>
          </div>
        </header>
        {phase === "observe" && (
          <>
            {spot && (
              <article className="obs-card" aria-live="polite">
                <button className="obs-x" onClick={() => setLandmark(null)} aria-label="Close">×</button>
                <small>{spot.kind}</small>
                <h3>{spot.name}</h3>
                <p>{spot.detail}</p>
                <p className="obs-quip">{spot.quip}</p>
              </article>
            )}
            <div className="obs-bottom">
              <nav className="obs-list" aria-label="Landmarks">
                {LANDMARKS.map((l) => (
                  <button key={l.id} className={`chip${landmark === l.id ? " on" : ""}`} onClick={() => pickLandmark(l.id)}>{l.name}</button>
                ))}
              </nav>
              <div className="obs-tools">
                <button
                  className="btn ghost slim"
                  onClick={() => { gameRef.current?.setMoonSun(!lowSun); setLowSun(!lowSun); }}
                  aria-pressed={lowSun}
                >
                  {lowSun ? "Low sun" : "Full Moon"}
                </button>
                <span className="obs-help">Drag to turn · scroll or pinch to zoom</span>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="whiteout" ref={r.fade} aria-hidden="true" />

      <button className={`icon-btn${muted ? " off" : ""}`} style={{ top: "calc(14px + env(safe-area-inset-top, 0px))" }} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute sound" : "Mute sound"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9h4l5-4v14l-5-4H4z" />
          {muted ? <path d="M17 9.5l5 5M22 9.5l-5 5" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
        </svg>
      </button>
      {voiceSupported && (
        <button className={`icon-btn${voiceOn ? "" : " off"}`} style={{ top: "calc(66px + env(safe-area-inset-top, 0px))" }} onClick={toggleVoice} aria-pressed={!voiceOn} aria-label={voiceOn ? "Turn off mission control voice" : "Turn on mission control voice"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            {!voiceOn && <path d="M4 4l16 16" />}
          </svg>
        </button>
      )}

      {phase === "title" && (
        <div className="screen">
          <div className="col">
            <h1 className="wordmark">moonrace<span>.lol</span></h1>
            <p className="lede">384,400 km between you and the Moon. Weather balloons, satellites, and asteroids in the way. Fuel along the route.</p>
            <p className="help">Steer with your mouse, drag with a finger, or use the arrow keys.<br />Press C or tap the small screen to ride in the cabin.</p>
            <label className="callsign">
              Callsign
              <input
                value={callsign}
                maxLength={18}
                placeholder="Anonymous pilot"
                onChange={(e) => {
                  setCallsign(e.target.value);
                  writeLocal("moonrace-callsign", e.target.value);
                }}
              />
            </label>
            {test && <p className="test-badge">Test flight: starts at {test.startPct}% with no collisions. Not submitted.</p>}
            <div className="row tight">
              <button className="btn go" onClick={launch}>{test ? "Launch test flight" : "Launch"}</button>
              {testSurface && <button className="btn ghost" onClick={() => gameRef.current?.landTest()}>Go to landing site</button>}
              <button className="btn ghost" onClick={openObservatory} disabled={obsLoading}>
                {obsLoading ? "Pointing the telescope…" : "Look at the Moon"}
              </button>
            </div>
            <p className="today">
              {stats?.firstMoon ? (
                <>First to reach the Moon: <strong>{stats.firstMoon.name}</strong>. </>
              ) : (
                <>Nobody has reached the Moon yet. </>
              )}
              {leader ? (
                <>Today&apos;s furthest: <strong>{formatPct(leader.pct)}</strong> by {leader.name}.</>
              ) : (
                <>Nobody has flown today.</>
              )}
            </p>
            {best > 0 && <p className="today">Your best: {formatPct(best)} of the way</p>}
            <Link className="small-link" href="/leaderboard">Today&apos;s leaderboard</Link>
          </div>
        </div>
      )}

      {result && (phase === "over" || (phase === "surface" && showReport)) && (
        <div className={`screen${phase === "surface" ? " report" : ""}`}>
          <div className="col">
            {phase === "surface" && <button className="obs-x" onClick={() => setShowReport(false)} aria-label="Close mission report">×</button>}
            <p className="big num">{formatPct(result.pct)}</p>
            <p className="sub">{result.reason === "moon" ? "You reached the Moon" : "of the way to the Moon"}</p>
            {result.quote && (
              <p className="quote"><span className="who">{result.quote.speaker}</span>“{result.quote.text}”</p>
            )}
            <p className="why">
              {result.reason === "moon" ? `384,400 km in ${Math.round(result.durationMs / 1000)} seconds.` : `${END_REASON_TEXT[result.reason]} at ${formatKm(result.km)} km`}
            </p>
            {result.lastMilestone && <p className="why">Last milestone: {result.lastMilestone}</p>}
            <p className="why">
              {result.closeCalls
                ? `${result.closeCalls} close call${result.closeCalls === 1 ? "" : "s"}${result.bestStreak > 1 ? `, best streak ×${result.bestStreak}` : ""}`
                : "No close calls. Playing it safe."}
            </p>
            {result.shots > 0 && <p className="why">{deflectorLine(result)}</p>}
            <p className="rank">
              {submit.status === "sending" && "Adding you to today's board…"}
              {submit.status === "done" && (
                <>
                  {submit.firstToMoon && <><strong>First person ever to reach the Moon.</strong> </>}
                  <strong>#{submit.rank}</strong> of {submit.total} today
                </>
              )}
              {submit.status === "error" && <span className="why">{submit.message}</span>}
            </p>
            <div className="row">
              {phase === "surface"
                ? <button className="btn go" onClick={() => setShowReport(false)} autoFocus>Back to the surface</button>
                : <button className="btn go" onClick={launch} autoFocus>Launch again</button>}
              {!result.test && <button className="btn ghost" onClick={share}>{shareLabel}</button>}
            </div>
            {best > 0 && <p className="today">Your best: {formatPct(best)} of the way</p>}
            <Link className="small-link" href="/leaderboard">Today&apos;s leaderboard</Link>
          </div>
        </div>
      )}

      {(phase === "landing" || phase === "surface") && (
        <SurfaceUI
          phase={phase}
          game={gameRef.current}
          store={storeRef.current}
          plantings={plantings}
          onPlanted={(p) => {
            setPlanted(true);
            setMine((ids) => [...ids, p.id]);
            setFocused(null);
            setPlantings((list) => [...list, p]);
          }}
          focused={focused}
          mine={mine}
          onFocus={(id) => {
            if (gameRef.current?.focusPlanting(id)) setFocused(id);
          }}
          labelRefs={siteLabelRefs}
          callsign={callsign}
          canPlant={!planted || !!test || testSurface}
          onReport={result ? () => setShowReport(true) : null}
          onLaunch={launch}
        />
      )}

      {phase === "loading" && <div className="loading">Preparing the launch pad</div>}
    </div>
  );
}
