"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { claimCallsign, newRecoveryCode, recoverPilot, type PilotInfo } from "@/lib/pilotClient";

interface Props {
  pilot: PilotInfo | null;
  /** "loading" until the pilot is known; "offline" if the server can't be reached. */
  status: "loading" | "ready" | "offline";
  /** Callsign shown before the pilot loads (or if it couldn't be claimed). */
  draft: string;
  /** Why a callsign couldn't be claimed (on load, or when it was saved on launch). */
  note: { name: string; error: string; suggestion?: string } | null;
  onPilot: (p: PilotInfo, switched: boolean) => void;
  /** Set to a function that saves an unsaved callsign; the parent calls it on Launch. */
  saveRef: MutableRefObject<(() => void) | null>;
  /** Called when a save started from Launch fails (this component may be gone by then). */
  onSaveFailed: (note: { name: string; error: string; suggestion?: string }) => void;
}

type Msg = { kind: "ok" | "err"; text: string; suggestion?: string } | null;

/** Title-screen callsign: claim it (first come, first served) and move it to other devices. */
export default function PilotControls({ pilot, status, draft: initialDraft, note, onPilot, saveRef, onSaveFailed }: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  // The name being saved right now, so blur + Claim + Launch don't send it three times.
  const inflight = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => setDraft(note?.name ?? initialDraft), [initialDraft, note]);
  useEffect(() => {
    if (note) setMsg({ kind: "err", text: `“${note.name}” is ${note.error.toLowerCase().replace(/\.$/, "")}.`, suggestion: note.suggestion });
  }, [note]);

  const saved = pilot?.callsign ?? "";
  const dirty = draft.trim() !== saved && draft.trim() !== "";
  const save = async (name = draft) => {
    const wanted = name.trim();
    if (!wanted || wanted === saved || inflight.current === wanted) return;
    if (status !== "ready") {
      if (status === "offline") setMsg({ kind: "err", text: "Can't save callsigns right now. Reload to try again." });
      return;
    }
    inflight.current = wanted;
    setBusy(true);
    const r = await claimCallsign(wanted);
    inflight.current = null;
    if (r.ok) onPilot(r.pilot, false);
    else if (!alive.current) onSaveFailed({ name: wanted, error: r.error, suggestion: r.suggestion });
    if (!alive.current) return;
    setBusy(false);
    if (r.ok) {
      setDraft(r.pilot.callsign ?? "");
      setMsg({ kind: "ok", text: "It's yours. Nobody else can fly under this callsign." });
    } else setMsg({ kind: "err", text: r.error, suggestion: r.suggestion });
  };
  // Launch saves a typed-but-unclaimed callsign, so the run is flown under it.
  saveRef.current = dirty ? () => void save() : null;

  return (
    <div className="pilot">
      <form
        className="callsign"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="callsign-input">Callsign</label>
        <input
          id="callsign-input"
          value={draft}
          maxLength={18}
          placeholder="Anonymous pilot"
          autoComplete="nickname"
          onChange={(e) => {
            setDraft(e.target.value);
            setMsg(null);
          }}
          onBlur={() => void save()}
        />
        {dirty && status === "ready" && (
          <button className="btn go slim" type="submit" disabled={busy}>{busy ? "Checking…" : "Claim"}</button>
        )}
      </form>
      <p className={`pilot-msg${msg ? ` ${msg.kind}` : ""}`} role="status">
        {msg ? (
          <>
            {msg.text}
            {msg.suggestion && (
              <> <button className="link" onClick={() => void save(msg.suggestion)}>Take {msg.suggestion}</button></>
            )}
          </>
        ) : status === "offline" ? (
          "Can't reach mission control's pilot records, so your callsign isn't used. Reload to try again."
        ) : saved && !dirty ? (
          <button className="link" onClick={() => setPanel(true)}>Fly as {saved} on another device</button>
        ) : !saved ? (
          <>Pick a callsign to get on the board. <button className="link" onClick={() => setPanel(true)}>Have a recovery code?</button></>
        ) : null}
      </p>
      {panel && <RecoveryPanel pilot={pilot} onClose={() => setPanel(false)} onPilot={(p) => { onPilot(p, true); setDraft(p.callsign ?? ""); setMsg({ kind: "ok", text: `Welcome back${p.callsign ? `, ${p.callsign}` : ""}.` }); setPanel(false); }} />}
    </div>
  );
}

function RecoveryPanel({ pilot, onClose, onPilot }: { pilot: PilotInfo | null; onClose: () => void; onPilot: (p: PilotInfo) => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const show = async () => {
    setBusy(true);
    setError("");
    try {
      setCode(await newRecoveryCode());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const use = async () => {
    if (!input.trim()) return;
    setBusy(true);
    setError("");
    const r = await recoverPilot(input);
    setBusy(false);
    if (r.ok) onPilot(r.pilot);
    else setError(r.error);
  };

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet recovery" role="dialog" aria-modal="true" aria-label="Your pilot" onClick={(e) => e.stopPropagation()}>
        <button className="obs-x" onClick={onClose} aria-label="Close">×</button>
        <h3>Your pilot</h3>
        {pilot?.callsign ? (
          <section>
            <p className="sheet-note">
              You fly as <strong>{pilot.callsign}</strong> on this device. To keep it on a phone or another browser, save your recovery code and enter it there.
            </p>
            {code ? (
              <>
                <div className="code-row">
                  <code className="recovery-code">{code}</code>
                  <button
                    className="btn ghost slim"
                    onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => {})}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="sheet-note small">Anyone with this code can fly as you, so keep it private. Showing a new code turns this one off.</p>
              </>
            ) : (
              <button className="btn go slim" onClick={() => void show()} disabled={busy}>{busy ? "One moment…" : "Show my recovery code"}</button>
            )}
          </section>
        ) : (
          <p className="sheet-note">Claim a callsign first, then you can carry it to other devices.</p>
        )}
        <section>
          <h4>Have a code from another device?</h4>
          <form
            className="code-row"
            onSubmit={(e) => {
              e.preventDefault();
              void use();
            }}
          >
            <input value={input} placeholder="MOON-XXXX-XXXX-XXXX" autoCapitalize="characters" spellCheck={false} onChange={(e) => setInput(e.target.value)} aria-label="Recovery code" />
            <button className="btn ghost slim" type="submit" disabled={busy || !input.trim()}>Use code</button>
          </form>
          {pilot?.callsign && <p className="sheet-note small">This device will switch to that pilot. Save your own code above first if you want to keep {pilot.callsign}.</p>}
        </section>
        {error && <p className="sheet-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
