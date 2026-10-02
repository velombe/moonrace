/**
 * Procedural sound: engine, wind, space ambience and all effects are synthesized
 * with the Web Audio API, so there are no sound files to load.
 */
export interface AudioFrame {
  state: "title" | "count" | "play" | "ending" | "over" | "observe" | "landing" | "surface";
  speed: number;
  space: number; // 0 in atmosphere, 1 in space
  thrust: number;
  engineDead: boolean;
  ducked: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  private lowpass!: BiquadFilterNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private engOsc!: OscillatorNode;
  private rasp!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private pad!: GainNode;
  noise!: AudioBuffer;
  private brown!: AudioBuffer;
  muted = false;
  private nextBreath = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem("moonrace-muted") === "1";
    } catch {}
  }

  /** Must be called from a user gesture (click/tap/keypress). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = this.gain(this.muted ? 0 : 0.85);
    this.lowpass = this.filter("lowpass", 20000, 0.5);
    this.master.connect(this.lowpass).connect(comp).connect(ctx.destination);
    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);

    this.engGain = this.gain(0);
    this.engGain.connect(this.master);
    this.engFilter = this.filter("lowpass", 300, 0.7);
    this.loop(this.brown).connect(this.engFilter).connect(this.engGain);
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = "sawtooth";
    this.engOsc.frequency.value = 38;
    this.engOsc.connect(this.filter("lowpass", 140)).connect(this.gain(0.35)).connect(this.engGain);
    this.engOsc.start();
    this.rasp = this.gain(0);
    this.loop(this.noise).connect(this.filter("bandpass", 1100, 0.6)).connect(this.rasp).connect(this.engGain);

    this.wind = this.gain(0);
    this.windFilter = this.filter("bandpass", 500, 0.5);
    this.loop(this.noise).connect(this.windFilter).connect(this.wind).connect(this.master);

    this.pad = this.gain(0);
    this.pad.connect(this.filter("lowpass", 1400)).connect(this.master);
    [110, 110.6, 164.8, 246.9, 329.6, 493.9].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? "triangle" : "sine";
      o.frequency.value = f;
      const g = this.gain(0.07 - 0.008 * i);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + 0.03 * i;
      lfo.connect(this.gain(0.04)).connect(g.gain);
      o.connect(g).connect(this.pad);
      o.start();
      lfo.start();
    });
    if (ctx.state === "suspended") void ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem("moonrace-muted", m ? "1" : "0");
    } catch {}
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  suspend(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  update(f: AudioFrame) {
    const ctx = this.ctx;
    if (!ctx) return;
    const T = ctx.currentTime;
    const landing = f.state === "landing";
    const playing = f.state === "play" || f.state === "count" || landing;
    const dead = f.state === "ending" || f.state === "over";
    const duck = f.ducked ? 0.5 : 1;
    // On the Moon the descent engine is only felt through the hull.
    const eng = landing ? 0.3 * f.thrust : playing ? (f.state === "count" ? 0.15 + 0.35 * f.thrust : 0.55) * (1 - 0.6 * f.space) : 0;
    this.engGain.gain.setTargetAtTime(eng * duck, T, dead ? (f.engineDead ? 0.5 : 0.05) : 0.2);
    this.engFilter.frequency.setTargetAtTime((220 + f.speed * 6) * (1 - 0.72 * f.space), T, 0.3);
    this.engOsc.frequency.setTargetAtTime(32 + f.speed * 0.12, T, 0.3);
    this.rasp.gain.setTargetAtTime(playing ? 0.2 * (1 - f.space) * Math.min(1, f.thrust) : 0, T, 0.3);
    const wind = f.state === "play" ? (f.speed / 140) * 0.4 * (1 - f.space) : f.state === "title" ? 0.03 : 0;
    this.wind.gain.setTargetAtTime(duck * wind, T, 0.4);
    this.windFilter.frequency.setTargetAtTime(350 + f.speed * 7, T, 0.3);
    this.pad.gain.setTargetAtTime(f.state === "title" ? 0 : (f.state === "surface" ? 0.5 : 0.9) * f.space, T, 1.5);
    // No sound in a vacuum: on the surface you hear your own breathing in the suit.
    if (f.state === "surface" && T >= this.nextBreath) {
      this.nextBreath = T + 4 + Math.random() * 0.8;
      this.burst(1.3, 380, 900, 0.035, 0, "bandpass", 0.8);
      this.burst(1.7, 800, 320, 0.03, 0, "bandpass", 0.8, 1.6);
    }
  }

  // ---- effects ----
  beep() { this.tone(660, 0.14, "sine", 0.22); }
  /** Footpads hitting regolith, felt through the structure. */
  touchdown() {
    this.tone(48, 0.9, "sine", 0.6, 0, 30);
    this.burst(0.5, 400, 120, 0.3, 0, "lowpass", 0.7);
    this.radioBlip();
  }
  /** Pole pushed into the ground. */
  plant() {
    this.tone(90, 0.25, "sine", 0.35, 0, 50);
    this.burst(0.2, 900, 300, 0.12, 0, "lowpass", 0.8);
  }
  /** Engines lighting on the pad: a crackling roar that builds under the countdown. */
  ignition() {
    this.burst(2.6, 90, 1300, 0.5, 0, "lowpass", 0.6);
    this.burst(1.6, 2600, 700, 0.12, 0, "bandpass", 0.8, 0.15);
    this.tone(40, 2.8, "sawtooth", 0.12, 0, 58);
  }
  liftoff() {
    this.tone(1320, 0.35, "sine", 0.18);
    this.burst(2.8, 150, 1600, 0.55, 0, "lowpass", 0.5);
    this.tone(70, 1.6, "sine", 0.5, 0, 35);
  }
  whoosh(pan: number, closeness: number, space: boolean) {
    this.burst(0.5, space ? 250 : 420, space ? 700 : 2200, (space ? 0.18 : 0.45) * closeness, pan, "bandpass", 1.2);
  }
  pickup() {
    this.tone(880, 0.12, "sine", 0.22);
    this.tone(1318.5, 0.18, "sine", 0.2, 0.07);
    this.tone(1760, 0.3, "triangle", 0.1, 0.14);
  }
  alarm() {
    this.tone(1046, 0.08, "square", 0.05);
    this.tone(1046, 0.08, "square", 0.05, 0.15);
  }
  radioBlip() {
    this.burst(0.12, 2600, 2400, 0.05, 0, "bandpass", 2);
    this.tone(1200, 0.06, "sine", 0.1, 0.1);
    this.tone(1600, 0.09, "sine", 0.1, 0.18);
  }
  karman() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setTargetAtTime(this.muted ? 0 : 0.2, ctx.currentTime, 0.25);
    g.setTargetAtTime(this.muted ? 0 : 0.85, ctx.currentTime + 1.4, 1.2);
    this.tone(220, 4, "sine", 0.08, 0.3);
    this.tone(329.6, 4.5, "sine", 0.06, 0.6);
  }
  explode() {
    this.burst(2, 2800, 60, 1, 0, "lowpass", 0.7);
    this.tone(95, 1.4, "sine", 0.9, 0, 28);
    this.burst(0.6, 5000, 900, 0.25, 0, "highpass", 0.5, 0.05);
  }
  sputter() {
    for (let i = 0; i < 4; i++) this.burst(0.12, 700, 300, 0.35 - 0.07 * i, 0, "lowpass", 0.8, i * 0.28);
    this.tone(55, 0.5, "square", 0.08, 0.2, 30);
  }
  nearMiss(streak: number, razor: boolean) {
    const f = 660 * Math.pow(2, (Math.min(streak - 1, 7) * 2) / 12);
    this.tone(f, 0.2, "triangle", 0.2);
    this.tone(f * 1.5, 0.28, "sine", 0.13, 0.06);
    if (razor) this.burst(0.35, 6000, 9000, 0.12, 0, "highpass", 0.4, 0.02);
  }
  slowmo() {
    const ctx = this.ctx;
    if (!ctx) return;
    const T = ctx.currentTime, fq = this.lowpass.frequency;
    fq.cancelScheduledValues(T);
    fq.setValueAtTime(650, T);
    fq.setTargetAtTime(20000, T + 0.55, 0.22);
    this.tone(130, 0.9, "sine", 0.35, 0, 55);
  }
  quindarIn(staticSeconds: number) {
    this.tone(2525, 0.25, "sine", 0.045);
    this.burst(Math.max(0.3, staticSeconds), 1700, 2300, 0.018, 0, "bandpass", 1.5, 0.25);
  }
  quindarOut() { this.tone(2475, 0.25, "sine", 0.045); }
  moon() { [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, 3.2, "triangle", 0.1, i * 0.12)); }

  // ---- helpers ----
  private gain(v: number) {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }
  private filter(type: BiquadFilterType, f: number, q?: number) {
    const b = this.ctx!.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q !== undefined) b.Q.value = q;
    return b;
  }
  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }
  private makeNoise(brown: boolean) {
    const ctx = this.ctx!;
    const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return b;
  }
  private envelope(node: AudioNode, vol: number, attack: number, dur: number, t0: number) {
    const g = this.gain(0);
    node.connect(g);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    return g;
  }
  tone(f: number, dur: number, type: OscillatorType, vol: number, delay = 0, glide?: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    this.envelope(o, vol, 0.006, dur, t0).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  burst(dur: number, f0: number, f1: number, vol: number, pan: number, type: BiquadFilterType, q = 0.8, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.filter(type, f0, q);
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    s.connect(f);
    let out: AudioNode = this.envelope(f, vol, Math.min(0.08, dur * 0.3), dur, t0);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      out = p;
    }
    out.connect(this.master);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }
}
