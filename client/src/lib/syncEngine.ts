import { SYNC, expectedPosition, type MediaItem, type PlaybackState } from '@watch-party/shared';
import { AutoplayBlockedError, playerFactories, type PlayerAdapter } from '../players';

export interface SyncEngineHooks {
  /** Current server-clock time in ms. */
  serverNow(): number;
  onDrift(driftMs: number): void;
  onNeedsInteraction(needed: boolean): void;
  onEnded(mediaId: string): void;
  onError(message: string): void;
  onLoading(loading: boolean): void;
}

/**
 * Keeps a local player locked to the room's shared timeline.
 *
 * The server only sends state changes (play/pause/seek/load). Between them,
 * every client computes `expectedPosition(state, serverNow)` itself and
 * corrects its player toward it:
 *   - |drift| > hardSeek              -> seek
 *   - |drift| > tolerance             -> nudge playbackRate (smooth, no jump)
 *                                        until |drift| < target (hysteresis)
 *   - otherwise                       -> play at the room rate
 * Players without fine rate control (YouTube) seek past a lower threshold.
 */
export class SyncEngine {
  private player: PlayerAdapter | null = null;
  private playerKind: MediaItem['source']['kind'] | null = null;
  private state: PlaybackState | null = null;
  private loadedMediaId: string | null = null;
  private loadToken = 0;
  private settleUntil = 0;
  private blocked = false;
  private playPending = false;
  /** True while a rate correction is in progress (see SYNC.driftTargetMs). */
  private correcting = false;
  private volume = 1;
  private muted = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly container: HTMLElement,
    private readonly hooks: SyncEngineHooks,
  ) {
    this.timer = setInterval(() => this.tick(), SYNC.driftCheckIntervalMs);
  }

  destroy(): void {
    clearInterval(this.timer);
    this.loadToken++;
    this.player?.destroy();
    this.player = null;
  }

  /** Feed a new authoritative state from the server. */
  async setState(state: PlaybackState): Promise<void> {
    this.state = state;
    if (!state.media) return;
    if (state.media.id !== this.loadedMediaId) {
      await this.loadMedia(state.media);
      if (this.state !== state) return; // a newer state arrived while loading
    }
    this.apply();
  }

  /** Current local playback time (for the UI). */
  currentTime(): number {
    return this.player && this.loadedMediaId ? this.player.getTime() : 0;
  }

  duration(): number {
    return this.player?.getDuration() || this.state?.media?.durationSec || 0;
  }

  /** Called from a click handler after the browser blocked autoplay. */
  async userGesture(): Promise<void> {
    this.blocked = false;
    this.hooks.onNeedsInteraction(false);
    this.apply();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.player?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.player?.setMuted(muted);
  }

  private async loadMedia(media: MediaItem): Promise<void> {
    const token = ++this.loadToken;
    this.hooks.onLoading(true);
    try {
      if (!this.player || this.playerKind !== media.source.kind) {
        this.player?.destroy();
        this.player = playerFactories[media.source.kind](this.container);
        this.playerKind = media.source.kind;
      }
      const player = this.player;
      this.loadedMediaId = null;
      await player.load(media.source);
      if (token !== this.loadToken) return;
      player.setVolume(this.volume);
      player.setMuted(this.muted);
      player.onEnded(() => this.hooks.onEnded(media.id));
      this.loadedMediaId = media.id;
    } catch (err) {
      if (token === this.loadToken) this.hooks.onError((err as Error).message || 'Could not load video');
    } finally {
      if (token === this.loadToken) this.hooks.onLoading(false);
    }
  }

  /** Snap the player to the state right now (used after every state change). */
  private apply(): void {
    const { player, state } = this;
    if (!player || !state?.media || state.media.id !== this.loadedMediaId) return;
    const target = expectedPosition(state, this.hooks.serverNow());
    const tolerance = state.playing ? SYNC.driftToleranceMs : SYNC.pausedToleranceMs;
    if (Math.abs(player.getTime() - target) * 1000 > tolerance) this.seek(target);
    player.setRate(state.rate);
    if (state.playing) this.tryPlay();
    else player.pause();
  }

  private tick(): void {
    const { player, state } = this;
    if (!player || !state?.media || state.media.id !== this.loadedMediaId) return;
    if (!state.playing) {
      if (!player.isPaused()) player.pause();
      if (performance.now() >= this.settleUntil && Math.abs(player.getTime() - state.position) * 1000 > SYNC.pausedToleranceMs) this.seek(state.position);
      this.hooks.onDrift((player.getTime() - state.position) * 1000);
      return;
    }
    if (this.blocked) return;
    if (player.isPaused()) {
      this.tryPlay();
      return;
    }
    if (performance.now() < this.settleUntil) return;

    const expected = expectedPosition(state, this.hooks.serverNow());
    const duration = player.getDuration();
    if (duration && expected >= duration) return; // waiting for "ended"
    const driftMs = (player.getTime() - expected) * 1000;
    const abs = Math.abs(driftMs);
    this.hooks.onDrift(driftMs);

    if (abs > SYNC.hardSeekThresholdMs || (!player.fineRate && abs > SYNC.coarseSeekThresholdMs)) {
      this.correcting = false;
      this.seek(expected);
      return;
    }
    if (abs > SYNC.driftToleranceMs) this.correcting = true;
    else if (abs < SYNC.driftTargetMs) this.correcting = false;

    if (player.fineRate && this.correcting) {
      // Ahead -> slow down, behind -> speed up; close the gap over the window.
      const adjust = Math.max(-SYNC.maxRateAdjust, Math.min(SYNC.maxRateAdjust, -driftMs / 1000 / SYNC.rateCorrectionWindowSec));
      player.setRate(state.rate * (1 + adjust));
    } else {
      player.setRate(state.rate);
    }
  }

  private seek(position: number): void {
    this.player?.seek(position);
    this.settleUntil = performance.now() + SYNC.seekSettleMs;
  }

  private tryPlay(): void {
    if (!this.player || this.playPending) return;
    this.playPending = true;
    this.player
      .play()
      .catch((err) => {
        if (err instanceof AutoplayBlockedError) {
          this.blocked = true;
          this.hooks.onNeedsInteraction(true);
        }
      })
      .finally(() => (this.playPending = false));
  }
}
