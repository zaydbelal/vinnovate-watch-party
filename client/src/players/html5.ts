import type { MediaSource } from '@watch-party/shared';
import { AutoplayBlockedError, type PlayerAdapter } from './types';

interface FrameSample {
  /** Media time of the presented frame (s). */
  mediaTime: number;
  /** performance.now() when that frame hit the screen. */
  presentedAt: number;
}

/**
 * Plain <video> element: direct MP4/WebM URLs. Supports fine rate control.
 *
 * Frame accuracy: `currentTime` runs ahead of what is actually on screen by
 * the decode/compositor pipeline. Where the browser supports
 * requestVideoFrameCallback we instead track the media time of each presented
 * frame and extrapolate from it, so drift is measured against the frame the
 * viewer sees.
 */
export class Html5Player implements PlayerAdapter {
  readonly fineRate = true;
  private readonly video: HTMLVideoElement;
  private endedCb: (() => void) | null = null;
  private frame: FrameSample | null = null;
  private frameMs: number | null = null;
  private frameCbId = 0;
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.className = 'player-media';
    this.video.addEventListener('ended', () => this.endedCb?.());
    // Any jump invalidates the last presented frame.
    this.video.addEventListener('seeking', () => (this.frame = null));
    container.appendChild(this.video);
    this.watchFrames();
  }

  private watchFrames(): void {
    const v = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; expectedDisplayTime: number }) => void) => number;
    };
    if (!v.requestVideoFrameCallback) return;
    const onFrame = (_now: number, meta: { mediaTime: number; expectedDisplayTime: number }) => {
      if (this.destroyed) return;
      const prev = this.frame;
      this.frame = { mediaTime: meta.mediaTime, presentedAt: meta.expectedDisplayTime };
      // Estimate frame duration from consecutive frames at normal speed.
      if (prev && !this.video.paused) {
        const d = ((meta.mediaTime - prev.mediaTime) * 1000) / (this.video.playbackRate || 1);
        if (d > 5 && d < 100) this.frameMs = this.frameMs == null ? d : this.frameMs * 0.9 + d * 0.1;
      }
      this.frameCbId = v.requestVideoFrameCallback!(onFrame);
    };
    this.frameCbId = v.requestVideoFrameCallback(onFrame);
  }

  load(source: MediaSource): Promise<void> {
    this.frame = null;
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
    this.frame = null;
    this.video.currentTime = Math.max(0, seconds);
  }
  getTime(): number {
    const v = this.video;
    const f = this.frame;
    if (!f || v.seeking) return v.currentTime;
    if (v.paused) return f.mediaTime;
    const since = performance.now() - f.presentedAt;
    // Only trust a recent sample; otherwise (tab throttled, stalled) fall back.
    if (since < -50 || since > 250) return v.currentTime;
    return f.mediaTime + (since / 1000) * v.playbackRate;
  }
  getDuration(): number {
    return Number.isFinite(this.video.duration) ? this.video.duration : 0;
  }
  isPaused(): boolean {
    return this.video.paused;
  }
  isBuffering(): boolean {
    const v = this.video;
    // HAVE_FUTURE_DATA (3): enough to keep playing from here.
    return !!v.src && !v.ended && v.readyState < 3;
  }
  frameDurationMs(): number | null {
    return this.frameMs;
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
    this.destroyed = true;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
    v.cancelVideoFrameCallback?.(this.frameCbId);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.video.remove();
  }
}
