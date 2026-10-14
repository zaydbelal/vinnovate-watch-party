import { LOFI } from '@watch-party/shared';

/**
 * Lo-fi lobby music, synthesised live with Web Audio: soft electric-piano
 * chords, a round bass and a lazy swung beat, all through a warm low-pass.
 * Optional vinyl crackle (LOFI.crackle, off by default). No audio files, nothing to license, and it never repeats
 * exactly because the melody and hats are lightly randomised.
 *
 * Tweak tempo, volume and chords in LOFI (shared/src/config.ts).
 */
export class LofiMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackle: AudioBufferSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextBeatTime = 0;
  private beat = 0;

  /** Bumped by every start/stop; a start that finds it changed after awaiting gives up. */
  private generation = 0;
  private starting: Promise<void> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;

  get playing(): boolean {
    return this.timer != null;
  }

  /**
   * Must be called from a user gesture the first time (autoplay policy).
   * Safe to call repeatedly: concurrent calls share one start, so there is
   * only ever one scheduler and one set of nodes.
   */
  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    if (this.starting) return this.starting;
    const gen = ++this.generation;
    this.starting = this.doStart(gen).finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(gen: number): Promise<void> {
    const ctx = (this.ctx ??= new AudioContext());
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    // Resolves only after a user gesture; stop() may have been called meanwhile.
    await ctx.resume();
    if (gen !== this.generation || this.timer) return;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(LOFI.volume, ctx.currentTime + 2);
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2200;
    warmth.Q.value = 0.4;
    warmth.connect(master).connect(ctx.destination);
    this.master = master;
    this.bus = warmth;
    this.noise ??= this.makeNoise(ctx);
    if (LOFI.crackle > 0) this.startCrackle(ctx);
    this.nextBeatTime = ctx.currentTime + 0.1;
    this.beat = 0;
    // Look-ahead scheduler: queue notes slightly ahead so timing stays tight.
    this.timer = setInterval(() => this.schedule(), 100);
  }

  /** Fade out, then suspend the whole audio context so nothing can keep sounding. */
  stop(): void {
    this.generation++; // cancels a start still waiting for a gesture
    const { ctx, master, crackle } = this;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.crackle = null;
    this.master = null;
    if (!ctx) return;
    if (master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    }
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      try {
        crackle?.stop();
      } catch {
        /* already stopped */
      }
      master?.disconnect();
      if (!this.timer && ctx.state === 'running') void ctx.suspend();
    }, 700);
  }

  /** Release the audio device entirely (leaving the lobby). */
  dispose(): void {
    this.stop();
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    const ctx = this.ctx;
    this.ctx = null;
    this.noise = null;
    void ctx?.close();
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const beatLen = 60 / LOFI.bpm;
    while (this.nextBeatTime < ctx.currentTime + 0.4) {
      this.playBeat(this.beat, this.nextBeatTime, beatLen);
      this.nextBeatTime += beatLen;
      this.beat++;
    }
  }

  /** One quarter note: drums every beat, a new chord every bar (4 beats). */
  private playBeat(beat: number, t: number, len: number): void {
    const inBar = beat % 4;
    const chord = LOFI.progression[Math.floor(beat / 4) % LOFI.progression.length];
    const swing = len * 0.58; // swung off-beat 8th

    if (inBar === 0) {
      chord.forEach((semi, i) => this.keys(semi + 48, t + i * 0.025, len * 3.8, 0.07));
      this.bass(chord[0] + 36, t, len * 1.6);
    }
    if (inBar === 2) this.bass(chord[0] + 36, t + swing, len * 1.2);
    if (inBar === 0 || (inBar === 2 && Math.random() < 0.5)) this.kick(t);
    if (inBar === 2 && Math.random() < 0.6) this.kick(t + swing);
    if (inBar === 1 || inBar === 3) this.snare(t);
    if (LOFI.hats > 0) {
      this.hat(t, 0.02 * LOFI.hats);
      if (Math.random() < 0.8) this.hat(t + swing, 0.012 * LOFI.hats);
    }
    // Sparse pentatonic melody, an octave above the chord.
    if (Math.random() < 0.3) {
      const scale = [0, 2, 4, 7, 9];
      const note = 60 + scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
      this.keys(note, t + (Math.random() < 0.5 ? 0 : swing), len * 1.5, 0.045);
    }
  }

  private freq(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12);
  }

  /** Electric-piano-ish tone: sine + soft detuned triangle with a bell-like decay. */
  private keys(midi: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + 0.015);
    env.gain.exponentialRampToValueAtTime(vol * 0.35, t + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    env.connect(this.bus!);
    for (const [type, detune, level] of [
      ['sine', 0, 1],
      ['triangle', 7, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = this.freq(midi);
      osc.detune.value = detune;
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  private bass(midi: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = this.freq(midi);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.bus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    env.gain.setValueAtTime(0.32, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(env).connect(this.bus!);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private snare(t: number): void {
    this.noiseHit(t, 'bandpass', 1800, 0.07, 0.16);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 'highpass', 7000, vol, 0.05);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, vol: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(this.bus!);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /**
   * Looping vinyl texture: a few soft, rounded pops per second over silence
   * (no continuous hiss, which reads as static on most speakers).
   */
  private startCrackle(ctx: AudioContext): void {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const pops = 12; // per 4 s loop
    for (let p = 0; p < pops; p++) {
      const at = Math.floor(Math.random() * (len - 200));
      const amp = (0.15 + Math.random() * 0.25) * LOFI.crackle;
      // A short decaying click rather than a single-sample spike.
      for (let i = 0; i < 120; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 18);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500;
    src.connect(filter).connect(this.master!);
    src.start();
    this.crackle = src;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
