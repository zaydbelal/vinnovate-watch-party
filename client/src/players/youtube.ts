import type { MediaSource } from '@watch-party/shared';
import { AutoplayBlockedError, type PlayerAdapter } from './types';

// Minimal typing for the parts of the YouTube IFrame API we use.
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
  /** Undocumented but long-standing IFrame API calls for the captions module. */
  loadModule?(name: string): void;
  unloadModule?(name: string): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 } as const;

let apiPromise: Promise<YTNamespace> | null = null;
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Could not load YouTube'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * YouTube embed. Native controls are hidden (playback goes through the room),
 * and YouTube only supports coarse playback rates, so drift is fixed by seeking.
 */
export class YouTubePlayer implements PlayerAdapter {
  readonly fineRate = false;
  private player: YTPlayer | null = null;
  private mount: HTMLDivElement;
  private endedCb: (() => void) | null = null;
  private stateWaiters: ((state: number) => void)[] = [];
  private captionsOn = false;

  constructor(container: HTMLElement) {
    this.mount = document.createElement('div');
    this.mount.className = 'player-media';
    container.appendChild(this.mount);
  }

  async load(source: MediaSource): Promise<void> {
    const YT = await loadApi();
    this.player?.destroy();
    const target = document.createElement('div');
    this.mount.replaceChildren(target);
    await new Promise<void>((resolve, reject) => {
      this.player = new YT.Player(target, {
        videoId: source.url,
        width: '100%',
        height: '100%',
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, cc_load_policy: 0 },
        events: {
          onReady: () => resolve(),
          onError: (e: { data: number }) => reject(new Error(`YouTube error ${e.data}`)),
          // The captions module (re)loads on its own after playback starts; re-apply our choice.
          onApiChange: () => this.applyCaptions(),
          onStateChange: (e: { data: number }) => {
            if (e.data === STATE.PLAYING) this.applyCaptions();
            if (e.data === STATE.ENDED) this.endedCb?.();
            this.stateWaiters.forEach((w) => w(e.data));
          },
        },
      });
    });
  }

  /** YouTube has no play() promise, so we wait for PLAYING and assume a block otherwise. */
  play(): Promise<void> {
    const p = this.player;
    if (!p) return Promise.resolve();
    if (p.getPlayerState() === STATE.PLAYING) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = (state: number) => {
        if (state === STATE.PLAYING) finish(true);
      };
      const timer = setTimeout(() => finish(p.getPlayerState() === STATE.PLAYING || p.getPlayerState() === STATE.BUFFERING), 3000);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.stateWaiters = this.stateWaiters.filter((w) => w !== waiter);
        if (ok) resolve();
        else reject(new AutoplayBlockedError());
      };
      this.stateWaiters.push(waiter);
      p.playVideo();
    });
  }

  pause(): void {
    this.player?.pauseVideo();
  }
  seek(seconds: number): void {
    this.player?.seekTo(Math.max(0, seconds), true);
  }
  getTime(): number {
    return this.player?.getCurrentTime() ?? 0;
  }
  getDuration(): number {
    return this.player?.getDuration() ?? 0;
  }
  isPaused(): boolean {
    const s = this.player?.getPlayerState();
    return s !== STATE.PLAYING && s !== STATE.BUFFERING;
  }
  isBuffering(): boolean {
    return this.player?.getPlayerState() === STATE.BUFFERING;
  }
  /**
   * YouTube's own captions. Its controls are hidden (playback goes through the
   * room), so the CC menu toggles them here. Off unless the viewer turns them on,
   * even if their YouTube account has "always show captions".
   */
  setCaptions(on: boolean): void {
    this.captionsOn = on;
    this.applyCaptions();
  }
  private applyCaptions(): void {
    const p = this.player;
    if (!p) return;
    try {
      if (this.captionsOn) p.loadModule?.('captions');
      else p.unloadModule?.('captions');
    } catch {
      /* player not ready yet; onApiChange re-applies */
    }
  }
  setRate(rate: number): void {
    if (this.player && this.player.getPlaybackRate() !== rate) this.player.setPlaybackRate(rate);
  }
  setVolume(volume: number): void {
    this.player?.setVolume(Math.round(volume * 100));
  }
  setMuted(muted: boolean): void {
    if (muted) this.player?.mute();
    else this.player?.unMute();
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  destroy(): void {
    this.player?.destroy();
    this.mount.remove();
  }
}
