import type { MediaSource } from '@watch-party/shared';
import { AutoplayBlockedError, type PlayerAdapter } from './types';

/** Plain <video> element: direct MP4/WebM URLs. Supports fine rate control. */
export class Html5Player implements PlayerAdapter {
  readonly fineRate = true;
  private readonly video: HTMLVideoElement;
  private endedCb: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.className = 'player-media';
    this.video.addEventListener('ended', () => this.endedCb?.());
    container.appendChild(this.video);
  }

  load(source: MediaSource): Promise<void> {
    return new Promise((resolve, reject) => {
      const v = this.video;
      const done = () => {
        v.removeEventListener('loadedmetadata', done);
        v.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        v.removeEventListener('loadedmetadata', done);
        v.removeEventListener('error', fail);
        reject(new Error('Could not load video'));
      };
      v.addEventListener('loadedmetadata', done);
      v.addEventListener('error', fail);
      v.src = source.url;
      v.load();
    });
  }

  async play(): Promise<void> {
    try {
      await this.video.play();
    } catch (err) {
      if ((err as DOMException)?.name === 'NotAllowedError') throw new AutoplayBlockedError();
      // AbortError: a pause/load interrupted play; harmless.
    }
  }

  pause(): void {
    this.video.pause();
  }
  seek(seconds: number): void {
    this.video.currentTime = Math.max(0, seconds);
  }
  getTime(): number {
    return this.video.currentTime;
  }
  getDuration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }
  isPaused(): boolean {
    return this.video.paused;
  }
  setRate(rate: number): void {
    if (Math.abs(this.video.playbackRate - rate) > 0.001) this.video.playbackRate = rate;
  }
  setVolume(volume: number): void {
    this.video.volume = volume;
  }
  setMuted(muted: boolean): void {
    this.video.muted = muted;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  destroy(): void {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}
