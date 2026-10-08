"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Game, type GameState, type HudRefs, type RunResult, type TestFlight } from "@/game/Game";
import { END_REASON_TEXT, MILESTONES, MOON_KM, formatKm, formatPct } from "@/game/constants";
import { LANDMARKS } from "@/game/moonAtlas";
import { dayKey, daySeed } from "@/lib/daily";
import { ensurePilot, pilotHeaders, type PilotInfo } from "@/lib/pilotClient";
import { deflectorSummary, shareQuery } from "@/lib/share";
import { LocalSiteStore, type Planting, type SiteStore } from "@/lib/site";
import ChipStrip from "./ChipStrip";
import Medal, { medalFor } from "./Medal";
import PilotControls from "./PilotControls";
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
  | { status: "done"; rank: number; total: number; firstToMoon: boolean; allTime: { rank: number; total: number; improved: boolean } | null }
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

/** Small stroked icon for the result chips. */
function Icon({ d }: { d: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
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
    combo: useRef<HTMLDivElement>(null), comboCount: useRef<HTMLElement>(null), comboBar: useRef<HTMLElement>(null),
    flash: useRef<HTMLDivElement>(null),
  };
  const floatRefs = useRef<HTMLElement[]>([]);
  const dangerRefs = useRef<HTMLElement[]>([]);
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
  const [pilot, setPilot] = useState<PilotInfo | null>(null);
  const [pilotStatus, setPilotStatus] = useState<"loading" | "ready" | "offline">("loading");
  const [pilotNote, setPilotNote] = useState<{ name: string; error: string; suggestion?: string } | null>(null);
  const saveCallsignRef = useRef<(() => void) | null>(null);
  const [best, setBest] = useState(0);
  // The best before this run, to tell a new best (the game-over handler is created once, so read a ref).
  const bestRef = useRef(0);
  const [prevBest, setPrevBest] = useState(0);
  useEffect(() => {
    bestRef.current = best;
  }, [best]);
  /** "server": the pilot's recorded best (matches the all-time board). "device": offline fallback from this browser. */
  const [bestSource, setBestSourceState] = useState<"server" | "device">("device");
  // Mirrored in a ref: the game-over handler is created once and reads it later.
  const bestSourceRef = useRef<"server" | "device">("device");
  const setBestSource = (s: "server" | "device") => {
    bestSourceRef.current = s;
    setBestSourceState(s);
  };
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
      const res = await fetch("/api/run/start", { method: "POST", headers: pilotHeaders() });
      if (res.ok) ticketRef.current = (await res.json()) as RunTicket;
    } catch {
      ticketRef.current = null;
    }
  }, []);

  const handleGameOver = useCallback(
    async (res: RunResult) => {
      setPrevBest(bestRef.current);
      setResult(res);
      setShareLabel("Share result");
      if (res.test) {
        activeTokenRef.current = null;
        setSubmit({ status: "error", message: "Test flight. Not added to today's board." });
        return;
      }
      // The device copy is only an offline fallback; rejected runs never count.
      const keepOnDevice = () => {
        if (res.pct > (parseFloat(readLocal("moonrace-best", "0")) || 0)) writeLocal("moonrace-best", String(res.pct));
      };
      const token = activeTokenRef.current;
      activeTokenRef.current = null;
      if (!token) {
        keepOnDevice();
        if (bestSourceRef.current === "device") setBest((b) => Math.max(b, res.pct));
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
          }),
        });
        const data = await r.json();
        if (!r.ok) setSubmit({ status: "error", message: data.error ?? "Couldn't reach the leaderboard." });
        else {
          setSubmit({ status: "done", rank: data.rank, total: data.total, firstToMoon: data.firstToMoon, allTime: data.allTime ?? null });
          keepOnDevice();
          // A new personal best on the server is the new "Your best".
          if (data.allTime?.improved) {
            setBest(res.pct);
            setBestSource("server");
          }
        }
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
    // Until the pilot loads (or if the server can't be reached), show this device's record.
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
        combo: r.combo.current!, comboCount: r.comboCount.current!, comboBar: r.comboBar.current!,
        floats: floatRefs.current, flash: r.flash.current!, dangers: dangerRefs.current,
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
    // Who's flying: load (or create) this device's pilot, then get a run ticket signed for them.
    void ensurePilot(readLocal("moonrace-callsign")).then((r) => {
      if (r) {
        setPilot(r.pilot);
        setPilotStatus("ready");
        setBest(r.pilot.best?.pct ?? 0);
        setBestSource("server");
        setPilotNote(r.claim ? { name: readLocal("moonrace-callsign"), ...r.claim } : null);
        if (r.pilot.callsign) {
          setCallsign(r.pilot.callsign);
          writeLocal("moonrace-callsign", r.pilot.callsign);
        }
      } else setPilotStatus("offline");
      void prefetchTicket();
    });
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
    // A callsign typed but not yet claimed is claimed now. It doesn't hold up the launch:
    // the run's name is read on the server when it finishes, long after this lands.
    saveCallsignRef.current?.();
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
          <div className="line">
            {MILESTONES.filter((m) => m.km >= 30000).map((m) => (
              <span key={m.km} className="tick" style={{ left: `${(m.km / MOON_KM) * 100}%` }} />
            ))}
            <b ref={r.fill} /><i className="marker" ref={r.marker} />
          </div>
          <span className="dot moon" aria-hidden="true" />
        </div>
        <div className="km num"><span ref={r.km}>0</span><small>km</small></div>
        <div className="pct"><b ref={r.pct}>0%</b> of the way to the Moon</div>
      </div>
      <div className="met hud-part">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>
        <span className="num" ref={r.clock}>T+00:00</span>
      </div>
      <div className="combo hud-part" ref={r.combo} aria-hidden="true">
        <b className="num" ref={r.comboCount}>×2</b>
        <span>combo</span>
        <i><i ref={r.comboBar} /></i>
      </div>
      <div className="floats" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} ref={(el) => { if (el) floatRefs.current[i] = el; }} />
        ))}
      </div>
      <div className="dangers" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <i key={i} ref={(el) => { if (el) dangerRefs.current[i] = el; }} />
        ))}
      </div>
      <div className="steer-hint" aria-hidden="true">
        <svg className="hand" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L4.4 14.6a1.5 1.5 0 0 1 2.3-1.9L9 15" /></svg>
        <span className="desk">Move the mouse to steer · fly close for fuel</span>
        <span className="touch">Drag anywhere to steer · fly close for fuel</span>
      </div>
      <div className="flash" ref={r.flash} aria-hidden="true" />
      <div className="fuelbox hud-part">
        <div className="deflector" aria-label="Deflector charge">
          <small>Deflector</small>
          <span className="pips">
            {[0, 1, 2].map((i) => (
              <i key={i} ref={(el) => { if (el) pipRefs.current[i] = el; }} />
            ))}
          </span>
        </div>
        <div className="fuel-head">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3h9a1 1 0 0 1 1 1v6h1.5A2.5 2.5 0 0 1 19 12.5V18a1 1 0 0 0 2 0v-7.6l-2.3-2.3 1.4-1.4L23 9.6V18a3 3 0 0 1-6 0v-5.5a.5.5 0 0 0-.5-.5H15v9H4V4a1 1 0 0 1 1-1Zm1 2v5h7V5H6Z" /></svg>
          <small>Fuel</small>
          <div className="num" ref={r.fuelPct}>100%</div>
        </div>
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
              <ChipStrip label="Landmarks" selected={landmark}>
                {LANDMARKS.map((l) => (
                  <button key={l.id} className={`chip${landmark === l.id ? " on" : ""}`} onClick={() => pickLandmark(l.id)}>{l.name}</button>
                ))}
              </ChipStrip>
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
        <div className="screen home">
          <div className="home-main">
            <p className="home-kicker"><i aria-hidden="true" />Today&apos;s route · the same for every pilot</p>
            <h1 className="wordmark">moonrace<span>.lol</span></h1>
            <p className="lede">384,400 km to the Moon. Weather balloons, satellites and asteroids in the way, fuel along the route. Fly close to things. Not into them.</p>
            <div className="home-card">
            <PilotControls
              pilot={pilot}
              status={pilotStatus}
              draft={callsign}
              note={pilotNote}
              saveRef={saveCallsignRef}
              onSaveFailed={(n) => setPilotNote(n)}
              onPilot={(p, switched) => {
                setPilot(p);
                setPilotNote(null);
                setBest(p.best?.pct ?? 0);
                setBestSource("server");
                setCallsign(p.callsign ?? "");
                writeLocal("moonrace-callsign", p.callsign ?? "");
                // A different pilot needs a run ticket signed for them.
                if (switched) {
                  ticketRef.current = null;
                  void prefetchTicket();
                }
              }}
            />
            {test && <p className="test-badge">Test flight: starts at {test.startPct}% with no collisions. Not submitted.</p>}
            <div className="home-actions">
              <button className="btn go launch" onClick={launch}>
                {test ? "Launch test flight" : "Launch"}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
              <button className="btn ghost" onClick={openObservatory} disabled={obsLoading}>
                {obsLoading ? "Pointing the telescope…" : "Look at the Moon"}
              </button>
              {testSurface && <button className="btn ghost" onClick={() => gameRef.current?.landTest()}>Go to landing site</button>}
            </div>
            </div>
            <ul className="home-stats" aria-label="Today">
              <li>
                <small>Today&apos;s furthest</small>
                <strong className="num">{leader ? formatPct(leader.pct) : "—"}</strong>
                <span>{leader ? leader.name : "Nobody has flown yet"}</span>
              </li>
              <li>
                <small>First to the Moon</small>
                <strong className={stats?.firstMoon ? "name" : "num"}>{stats?.firstMoon ? stats.firstMoon.name : "—"}</strong>
                <span>{stats?.firstMoon ? "Forever on the record" : "Still up for grabs"}</span>
              </li>
              <li>
                <small>Your best</small>
                <strong className="num">{best > 0 ? formatPct(best) : "—"}</strong>
                <span>
                  {best > 0
                    ? bestSource === "device" ? "on this device" : "of the way"
                    : pilot && !pilot.callsign ? "Claim a callsign to keep it" : "No flights yet"}
                </span>
              </li>
              <li>
                <small>Runs today</small>
                <strong className="num">{stats ? stats.runs.toLocaleString("en-US") : "—"}</strong>
                <Link href="/leaderboard">See the leaderboard</Link>
              </li>
            </ul>
            <Link className="home-board" href="/leaderboard">Today&apos;s leaderboard →</Link>
            <p className="home-help desk">
              <span><kbd>Mouse</kbd> <kbd>←</kbd><kbd>→</kbd> steer</span>
              <span><kbd>C</kbd> cabin view</span>
              <span><kbd>Click</kbd> <kbd>Space</kbd> deflector, in space</span>
            </p>
            <p className="home-help touch">
              <span><kbd>Drag</kbd> steer</span>
              <span><kbd>Small screen</kbd> cabin view</span>
              <span><kbd>◎</kbd> deflector, in space</span>
            </p>
          </div>
        </div>
      )}

      {result && (phase === "over" || (phase === "surface" && showReport)) && (() => {
        const medal = medalFor(result.km, result.reason === "moon");
        const newBest = !result.test && result.pct > prevBest;
        return (
        <div className={`screen over${phase === "surface" ? " report" : ""}`}>
          <div className={`result-card${newBest ? " has-ribbon" : ""}`} role="dialog" aria-label="Flight result">
            {phase === "surface" && <button className="obs-x" onClick={() => setShowReport(false)} aria-label="Close mission report">×</button>}
            {newBest && <div className="ribbon">{prevBest > 0 ? "New best!" : "First flight!"}</div>}
            <div className="result-head">
              <Medal tier={medal.tier} />
              <div>
                <p className={`result-rank-title ${medal.tier}`}>{medal.title}</p>
                <p className="big num">{formatPct(result.pct)}</p>
                <p className="sub">{result.reason === "moon" ? "You reached the Moon" : "of the way to the Moon"}</p>
              </div>
            </div>
            <p className="result-why">
              <span className={`status ${result.reason === "moon" ? "landed" : result.reason === "fuel" ? "fuel" : "crashed"}`}>
                {result.reason === "moon" ? "Landed" : result.reason === "fuel" ? "Out of fuel" : "Crashed"}
              </span>
              {result.reason === "moon" ? `384,400 km in ${Math.round(result.durationMs / 1000)} seconds` : `${END_REASON_TEXT[result.reason]} at ${formatKm(result.km)} km`}
            </p>
            {result.quote && (
              <p className="quote"><span className="who">{result.quote.speaker}</span>“{result.quote.text}”</p>
            )}
            <ul className="chips">
              <li><Icon d="M3 17l6-6 4 4 8-8M15 7h6v6" />{formatKm(result.km)} km</li>
              <li className={result.closeCalls ? "hot" : undefined}><Icon d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />{result.closeCalls} close call{result.closeCalls === 1 ? "" : "s"}</li>
              {result.bestStreak > 1 && <li className="hot"><Icon d="M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z" />×{result.bestStreak} streak</li>}
              {result.lastMilestone && <li><Icon d="M5 21V4h11l-2 4 2 4H5" />{result.lastMilestone}</li>}
              {result.shots > 0 && <li className={result.satellites ? "bad" : undefined}><Icon d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />{deflectorLine(result)}</li>}
            </ul>
            <p className="rank">
              {submit.status === "sending" && "Adding you to today's board…"}
              {submit.status === "done" && (
                <>
                  {submit.firstToMoon && <><strong>First person ever to reach the Moon.</strong> </>}
                  <strong>#{submit.rank}</strong> of {submit.total} today
                  {submit.allTime?.improved && (
                    <span className="pb"> · New personal best, <strong>#{submit.allTime.rank}</strong> all time</span>
                  )}
                  {!pilot?.callsign && <span className="pb"> · Claim a callsign to put your name on it</span>}
                </>
              )}
              {submit.status === "error" && <span className="why">{submit.message}</span>}
            </p>
            <div className="result-actions">
              {phase === "surface"
                ? <button className="btn go fly" onClick={() => setShowReport(false)} autoFocus>Back to the surface</button>
                : <button className="btn go fly" onClick={launch} autoFocus>Fly again</button>}
              {!result.test && <button className="btn ghost" onClick={share}>{shareLabel}</button>}
            </div>
            <p className="result-foot">
              {best > 0 && <span>Your best: <strong>{formatPct(best)}</strong></span>}
              <Link href="/leaderboard">Leaderboard</Link>
            </p>
          </div>
        </div>
        );
      })()}

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
