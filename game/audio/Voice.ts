import type { AudioEngine } from "./AudioEngine";

/**
 * Mission control voice.
 * 1. If /voice/<lineId>.mp3 is listed in /voice/manifest.json, the recording is played
 *    through a radio filter (band-limited, lightly saturated).
 * 2. Otherwise it falls back to the browser's speech synthesis as a placeholder.
 */
export class Voice {
  enabled = true;
  private clips = new Map<string, AudioBuffer>();
  private available = new Set<string>();
  private loading: Promise<void> | null = null;
  private current: AudioBufferSourceNode | null = null;
  private token = 0;
  private primed = false;
  private speechVoices: { main: SpeechSynthesisVoice | null; alt: SpeechSynthesisVoice | null } = { main: null, alt: null };
  readonly canSpeak: boolean;

  constructor(private audio: AudioEngine) {
    this.canSpeak = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
    try {
      this.enabled = localStorage.getItem("moonrace-voice") !== "0";
    } catch {}
    if (this.canSpeak) {
      this.pickSpeechVoices();
      speechSynthesis.onvoiceschanged = () => this.pickSpeechVoices();
    }
  }

  get supported() {
    return this.canSpeak || this.available.size > 0;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem("moonrace-voice", on ? "1" : "0");
    } catch {}
    if (!on) this.stop();
  }

  /** Call from a user gesture. Loads recorded clips in the background. */
  prepare() {
    if (this.canSpeak && !this.primed) {
      this.primed = true;
      try {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        speechSynthesis.speak(u);
      } catch {}
    }
    if (!this.loading) this.loading = this.loadClips();
  }

  private async loadClips() {
    try {
      const res = await fetch("/voice/manifest.json", { cache: "force-cache" });
      if (!res.ok) return;
      const data = (await res.json()) as { lines?: string[] };
      (data.lines ?? []).forEach((id) => this.available.add(id));
      const ctx = this.audio.ctx;
      if (!ctx) return;
      await Promise.all(
        [...this.available].map(async (id) => {
          try {
            const r = await fetch(`/voice/${id}.mp3`);
            if (!r.ok) return;
            this.clips.set(id, await ctx.decodeAudioData(await r.arrayBuffer()));
          } catch {}
        }),
      );
    } catch {}
  }

  stop() {
    this.token++;
    try {
      this.current?.stop();
    } catch {}
    this.current = null;
    if (this.canSpeak) speechSynthesis.cancel();
  }

  /**
   * Speaks a line. Returns the expected duration in seconds, or 0 if nothing will play.
   * `onEnd` fires when the voice finishes (not called if interrupted).
   */
  speak(lineId: string, speaker: string, text: string, onEnd: () => void): number {
    if (!this.enabled || this.audio.muted) return 0;
    this.stop();
    const token = this.token;
    const clip = this.clips.get(lineId);
    const ctx = this.audio.ctx;
    if (clip && ctx) {
      const src = ctx.createBufferSource();
      src.buffer = clip;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 320;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 3400;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const x = (i / 1023) * 2 - 1;
        curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
      }
      shaper.curve = curve;
      const g = ctx.createGain();
      g.gain.value = 1.1;
      src.connect(hp).connect(lp).connect(shaper).connect(g).connect(this.audio.master);
      src.onended = () => {
        if (token === this.token) onEnd();
      };
      src.start(ctx.currentTime + 0.28);
      this.current = src;
      return clip.duration + 0.28;
    }
    if (!this.canSpeak) return 0;
    const u = new SpeechSynthesisUtterance(
      text.replace(/\bISS\b/g, "I.S.S.").replace("14C", "fourteen C").replace(/100%/g, "100 percent"),
    );
    const v = speaker === "Houston" ? this.speechVoices.main : this.speechVoices.alt;
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = "en-US";
    u.rate = speaker === "GPS satellite" ? 0.9 : 1.06;
    u.pitch = speaker === "GPS satellite" ? 0.35 : speaker === "Houston" ? 0.9 : 1.12;
    u.onend = u.onerror = () => {
      if (token === this.token) onEnd();
    };
    setTimeout(() => {
      if (token === this.token) speechSynthesis.speak(u);
    }, 280);
    return text.length / 14 + 0.3;
  }

  private pickSpeechVoices() {
    const vs = speechSynthesis.getVoices().filter((x) => /^en/i.test(x.lang));
    if (!vs.length) return;
    const pref = ["Google US English", "Microsoft Guy", "Microsoft Davis", "Microsoft Christopher", "Daniel", "Alex", "Aaron", "Microsoft David", "Microsoft Mark", "Google UK English Male", "Fred"];
    let main: SpeechSynthesisVoice | null = null;
    for (const n of pref) {
      const v = vs.find((x) => x.name.includes(n));
      if (v) {
        main = v;
        break;
      }
    }
    main = main ?? vs.find((x) => /en-US/i.test(x.lang)) ?? vs[0];
    const alt =
      vs.find((x) => x !== main && /female|samantha|zira|karen|moira|victoria|aria|jenny|tessa|google uk english female/i.test(x.name)) ??
      vs.find((x) => x !== main) ??
      main;
    this.speechVoices = { main, alt };
  }
}
