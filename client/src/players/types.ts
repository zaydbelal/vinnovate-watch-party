import type { MediaSource } from '@watch-party/shared';

/**
 * Everything the sync engine needs from a video player. To support a new
 * provider, implement this and register it in players/index.ts.
 */
export interface PlayerAdapter {
  /** True if small playbackRate nudges (e.g. 1.03x) work for drift correction. */
  readonly fineRate: boolean;
  /** Resolves once the media can be played and seeked. */
  load(source: MediaSource): Promise<void>;
  /** Rejects if the browser blocked playback (autoplay policy). */
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  /** Position of the frame on screen right now (seconds). */
  getTime(): number;
  getDuration(): number;
  isPaused(): boolean;
  /** True while playback is stalled waiting for data (drives auto-buffer catching). */
  isBuffering(): boolean;
  /** Duration of one frame in ms if known (used to pick frame-accurate tolerances). */
  frameDurationMs?(): number | null;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  onEnded(cb: () => void): void;
  destroy(): void;
}

export class AutoplayBlockedError extends Error {
  constructor() {
    super('Playback needs a click');
  }
}
