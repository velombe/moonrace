import type { AudioEngine } from "./audio/AudioEngine";
import type { Voice } from "./audio/Voice";

import { LINES } from "./lines";

export interface Quote {
  speaker: string;
  text: string;
}

export interface ChatterView {
  root: HTMLElement;
  speaker: HTMLElement;
  text: HTMLElement;
}

interface Active {
  id: string;
  speaker: string;
  text: string;
  priority: number;
  shown: number;
  chars: number;
  typeRate: number;
  hold: number;
  typed: boolean;
  speaking: boolean;
  voiceTimeout: number;
}

/** Radio chatter: picks lines, types subtitles, plays Quindar tones and the voice. */
export class Chatter {
  private active: Active | null = null;
  private cooldown = 0;
  private recent: Record<string, number> = {};

  constructor(private view: ChatterView, private audio: AudioEngine, private voice: Voice) {}

  get speaking() {
    return !!this.active?.speaking;
  }

  /**
   * Priority: 0 minor, 1 reactions, 2 story beats, 3 endings (always interrupts).
   * Returns the chosen line, or null if it was skipped.
   */
  say(key: string, priority: number, chance?: number): Quote | null {
    if (chance !== undefined && Math.random() > chance) return null;
    if (this.active && priority <= this.active.priority) return null;
    if (!this.active && priority < 2 && this.cooldown > 0) return null;
    const pool = LINES[key];
    if (!pool) return null;
    let i: number;
    do i = Math.floor(Math.random() * pool.length);
    while (pool.length > 1 && i === this.recent[key]);
    this.recent[key] = i;
    const raw = pool[i];
    const [speaker, text] = Array.isArray(raw) ? raw : ["Houston", raw];
    const id = `${key}_${i + 1}`;
    const duration = this.voice.speak(id, speaker, text, () => {
      if (this.active && this.active.id === id) {
        this.active.speaking = false;
        this.audio.quindarOut();
      }
    });
    const voiced = duration > 0;
    this.active = {
      id, speaker, text, priority,
      shown: 0, chars: 0,
      typeRate: voiced ? Math.max(18, text.length / Math.max(0.5, duration - 0.3)) : 42,
      hold: voiced ? 0.9 : 1.9 + text.length * 0.032,
      typed: false,
      speaking: voiced,
      voiceTimeout: voiced ? duration + 3 : 0,
    };
    this.view.speaker.textContent = speaker;
    this.view.text.textContent = "";
    this.view.root.classList.add("on");
    this.audio.quindarIn(voiced ? duration : text.length / 42);
    return { speaker, text };
  }

  update(dt: number) {
    const a = this.active;
    if (!a) {
      if (this.cooldown > 0) this.cooldown -= dt;
      return;
    }
    if (!a.typed) {
      a.shown += dt * a.typeRate;
      const n = Math.min(a.text.length, Math.floor(a.shown));
      if (n !== a.chars) {
        a.chars = n;
        this.view.text.textContent = a.text.slice(0, n);
      }
      if (n >= a.text.length) {
        a.typed = true;
        if (!a.speaking && a.voiceTimeout === 0) this.audio.quindarOut();
      }
    } else if (a.speaking) {
      a.voiceTimeout -= dt;
      if (a.voiceTimeout <= 0) a.speaking = false;
    } else {
      a.hold -= dt;
      if (a.hold <= 0) this.hide(3.5);
    }
  }

  /** Hide subtitles. With `stopVoice`, also cut the voice off. */
  clear(stopVoice: boolean) {
    if (stopVoice) this.voice.stop();
    this.hide(0);
  }

  private hide(cooldown: number) {
    this.active = null;
    this.cooldown = cooldown;
    this.view.root.classList.remove("on");
  }
}
