"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { Game } from "@/game/Game";
import { SPOTS, type SpotId } from "@/game/surface/LandingSite";
import { drawPanel, loadImage, plantingAssets } from "@/game/surface/plantings";
import { COUNTRIES } from "@/lib/countries";
import { cleanPlantingName, shrinkLogo, type Planting, type SiteStore } from "@/lib/site";

const COUNTRY_NAME = new Map(COUNTRIES);

interface Props {
  phase: string;
  game: Game | null;
  store: SiteStore;
  plantings: Planting[];
  onPlanted: (p: Planting) => void;
  /** Name labels the game positions over each planting (same order as `plantings`). */
  labelRefs: MutableRefObject<HTMLElement[]>;
  callsign: string;
  canPlant: boolean;
  onReport: (() => void) | null;
  onLaunch: () => void;
}

type Kind = "flag" | "panel";

/** Everything on screen while standing at the landing site. */
export default function SurfaceUI({ phase, game, store, plantings, onPlanted, labelRefs, callsign, canPlant, onReport, onLaunch }: Props) {
  const [spot, setSpot] = useState<SpotId>("lander");
  const [sheet, setSheet] = useState<Kind | null>(null);
  const [name, setName] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const walking = phase === "surface";

  const open = (k: Kind) => {
    setSheet(k);
    setName(callsign);
    setCountry(null);
    setLogo(null);
    setQuery("");
    setError("");
  };

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  // Live plaque preview, drawn with the same code as the 3D panel.
  useEffect(() => {
    if (sheet !== "panel" || !preview.current) return;
    let alive = true;
    const c = preview.current, ctx = c.getContext("2d")!;
    void Promise.all([logo ? loadImage(logo) : null, country ? loadImage(plantingAssets.flagUrl(country)) : null]).then(([l, f]) => {
      if (alive) drawPanel(ctx, c.width, c.height, { name: cleanPlantingName(name || callsign), logo: l, flag: f, date: new Date() });
    });
    return () => {
      alive = false;
    };
  }, [sheet, name, logo, country, callsign]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? COUNTRIES.filter(([code, n]) => n.toLowerCase().includes(q) || code === q) : COUNTRIES;
  }, [query]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      setLogo(await shrinkLogo(file));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirm = async () => {
    if (!sheet || busy) return;
    setBusy(true);
    setError("");
    try {
      const p = await store.add({ kind: sheet, name: name || callsign, country, logo: sheet === "panel" ? logo : null });
      game?.plant(p);
      onPlanted(p);
      setSheet(null);
      setSpot("flags");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="site-labels" aria-hidden="true">
        {plantings.map((p, i) => (
          <span key={p.id} className="site-label" ref={(el) => { if (el) labelRefs.current[i] = el; }}>
            {p.country && <img src={plantingAssets.flagUrl(p.country)} alt="" />}
            {p.name}
          </span>
        ))}
      </div>

      {phase === "landing" && <p className="landing-hint">Tap or press Space to skip the landing</p>}

      {walking && (
        <>
          <div className="site-title" role="status">
            <h2>You&apos;re on the Moon.</h2>
            <p>Mare Marginis, the Sea of the Edge · 13° N, 80° E</p>
          </div>

          <div className="site-bar">
            <nav className="site-spots" aria-label="Walk to">
              {SPOTS.map((s) => (
                <button key={s.id} className={`chip${spot === s.id ? " on" : ""}`} onClick={() => { setSpot(s.id); game?.walkTo(s.id); }}>{s.name}</button>
              ))}
            </nav>
            <div className="site-actions">
              <button className="btn go slim" onClick={() => open("flag")} disabled={!canPlant}>{canPlant ? "Plant a flag" : "Planted"}</button>
              <button className="btn ghost slim" onClick={() => open("panel")} disabled={!canPlant}>Place a panel</button>
              {onReport && <button className="btn ghost slim" onClick={onReport}>Mission report</button>}
              <button className="btn ghost slim" onClick={onLaunch}>Launch again</button>
            </div>
            <p className="site-help">Drag to look around · {plantings.length ? `${plantings.length} planted here so far` : "Nobody has planted anything here yet"}</p>
          </div>
        </>
      )}

      {sheet && (
        <div className="sheet-wrap" onClick={() => setSheet(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={sheet === "flag" ? "Plant a flag" : "Place a panel"} onClick={(e) => e.stopPropagation()}>
            <button className="obs-x" onClick={() => setSheet(null)} aria-label="Close">×</button>
            <h3>{sheet === "flag" ? "Plant a flag" : "Place a panel"}</h3>
            <p className="sheet-note">
              {sheet === "flag"
                ? "Goes up in the flag field next to the lander. Everyone who lands here will see it."
                : "A standard aluminium panel with your name, and a logo if you like. Everyone who lands here will see it."}
            </p>

            <label className="field">
              {sheet === "flag" ? "Name on the pole" : "Name on the panel"}
              <input value={name} maxLength={32} placeholder="Your name or team" onChange={(e) => setName(e.target.value)} />
            </label>

            {sheet === "panel" && (
              <>
                <div className="logo-row">
                  <label className="btn ghost slim file">
                    {logo ? "Change logo" : "Upload a logo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => void upload(e.target.files?.[0])} />
                  </label>
                  {logo && <button className="btn ghost slim" onClick={() => setLogo(null)}>Remove logo</button>}
                </div>
                <canvas ref={preview} className="panel-preview" width={1024} height={640} aria-label="Panel preview" />
              </>
            )}

            <div className="field">
              <span>{sheet === "flag" ? "Flag" : "Flag in the corner (optional)"}</span>
              <input value={query} placeholder="Search countries" onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="flag-grid" role="listbox" aria-label="Countries">
              {!query && (
                <button role="option" aria-selected={country === null} className={`flag-opt${country === null ? " on" : ""}`} onClick={() => setCountry(null)}>
                  <span className="flag-none" aria-hidden="true" />
                  {sheet === "flag" ? "moonrace.lol flag" : "No flag"}
                </button>
              )}
              {matches.map(([code, n]) => (
                <button key={code} role="option" aria-selected={country === code} className={`flag-opt${country === code ? " on" : ""}`} onClick={() => setCountry(code)}>
                  <img src={plantingAssets.flagUrl(code)} alt="" loading="lazy" />
                  {n}
                </button>
              ))}
            </div>

            {error && <p className="sheet-error" role="alert">{error}</p>}
            <div className="sheet-foot">
              <span className="sheet-pick">{country ? COUNTRY_NAME.get(country) : sheet === "flag" ? "moonrace.lol flag" : "No flag"}</span>
              <button className="btn go" onClick={() => void confirm()} disabled={busy}>
                {busy ? "Saving…" : sheet === "flag" ? "Plant flag" : "Place panel"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
