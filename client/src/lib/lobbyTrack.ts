import { LOBBY_TRACK, type LobbyTrack } from '@watch-party/shared';
import { playerFactories, type PlayerAdapter } from '../players';

/**
 * Plays the host's lobby song in sync for everyone. The song loops on the
 * shared clock: position = (serverNow - startedAt) % duration, so every
 * listener hears the same bar no matter when they arrived. Reuses the video
 * player adapters, so YouTube links play audio-only and files play directly.
 */
export class LobbyTrackPlayer {
  private player: PlayerAdapter | null = null;
  private key: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private loadToken = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly serverNow: () => number,
  ) {}

  async play(track: LobbyTrack): Promise<void> {
    const key = `${track.source.kind}:${track.source.url}:${track.startedAt}`;
    if (key === this.key && this.player) return this.align(track);
    this.stop();
    this.key = key;
    const token = ++this.loadToken;
    const player = playerFactories[track.source.kind](this.container);
    this.player = player;
    try {
      await player.load(track.source);
    } catch {
      return; // bad link: stay silent rather than fall back mid-lobby
    }
    if (token !== this.loadToken) return;
    player.setVolume(LOBBY_TRACK.volume);
    player.onEnded(() => this.align(track));
    this.align(track);
    this.timer = setInterval(() => this.align(track), LOBBY_TRACK.checkIntervalMs);
  }

  /** Snap to the shared loop position and make sure it's playing. Also call after a click (autoplay). */
  align(track: LobbyTrack): void {
    const p = this.player;
    const duration = p?.getDuration();
    if (!p || !duration) return;
    const target = (((this.serverNow() - track.startedAt) / 1000) % duration + duration) % duration;
    if (Math.abs(p.getTime() - target) * 1000 > LOBBY_TRACK.driftToleranceMs) p.seek(target);
    if (p.isPaused()) void p.play().catch(() => {});
  }

  stop(): void {
    this.loadToken++;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.player?.destroy();
    this.player = null;
    this.key = null;
  }
}
