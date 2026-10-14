import { STREAMING_PROVIDERS, formatTime, streamingDeepLink, type MediaSource } from '@watch-party/shared';
import type { PlayerAdapter } from './types';

/**
 * Companion mode for DRM services (Netflix, Prime Video, JioHotstar, ZEE5).
 *
 * Those services can't be embedded or controlled from another site, so this
 * adapter is a virtual player: a clock the sync engine drives exactly like a
 * real video (play, pause, seek, speed). Each viewer plays the title in their
 * own account and lines it up with the big shared timecode; pause/resume cues
 * come from the room as usual.
 */
export class ExternalPlayer implements PlayerAdapter {
  readonly fineRate = true;
  private readonly root: HTMLDivElement;
  private readonly timeEl: HTMLDivElement;
  private readonly stateEl: HTMLDivElement;
  private readonly link: HTMLAnchorElement;
  private source: MediaSource | null = null;
  private base = 0;
  private startedAt: number | null = null;
  private rate = 1;
  private timer: ReturnType<typeof setInterval>;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'player-media external-player';
    this.root.innerHTML = `
      <div class="external-provider"></div>
      <div class="external-time"></div>
      <div class="external-state"></div>
      <a class="btn" target="_blank" rel="noopener noreferrer">Open</a>
      <p class="external-help">Start the title in your own account, then match this timecode.
      The room tells you when to pause and resume.</p>`;
    this.timeEl = this.root.querySelector('.external-time')!;
    this.stateEl = this.root.querySelector('.external-state')!;
    this.link = this.root.querySelector('a')!;
    // The link sits under the click shield, so lift it above.
    this.link.style.position = 'relative';
    this.link.style.zIndex = '3';
    container.appendChild(this.root);
    this.timer = setInterval(() => this.render(), 200);
  }

  async load(source: MediaSource): Promise<void> {
    this.source = source;
    this.base = 0;
    this.startedAt = null;
    const name = source.provider ? STREAMING_PROVIDERS[source.provider].name : 'the service';
    this.root.querySelector('.external-provider')!.textContent = `Watching on ${name}`;
    this.link.textContent = `Open in ${name}`;
    this.render();
  }

  private render(): void {
    const t = this.getTime();
    this.timeEl.textContent = formatTime(t);
    this.stateEl.textContent = this.startedAt == null ? 'Paused' : this.rate === 1 ? 'Playing' : `Playing at ${this.rate}×`;
    if (this.source) this.link.href = streamingDeepLink(this.source, t);
  }

  async play(): Promise<void> {
    if (this.startedAt == null) this.startedAt = performance.now();
  }
  pause(): void {
    this.base = this.getTime();
    this.startedAt = null;
  }
  seek(seconds: number): void {
    this.base = Math.max(0, seconds);
    if (this.startedAt != null) this.startedAt = performance.now();
  }
  getTime(): number {
    return this.startedAt == null ? this.base : this.base + ((performance.now() - this.startedAt) / 1000) * this.rate;
  }
  getDuration(): number {
    return 0;
  }
  isPaused(): boolean {
    return this.startedAt == null;
  }
  isBuffering(): boolean {
    return false;
  }
  setRate(rate: number): void {
    // Re-anchor so changing speed never jumps the clock.
    if (this.startedAt != null) {
      this.base = this.getTime();
      this.startedAt = performance.now();
    }
    this.rate = rate;
  }
  setVolume(): void {}
  setMuted(): void {}
  onEnded(): void {}
  destroy(): void {
    clearInterval(this.timer);
    this.root.remove();
  }
}
