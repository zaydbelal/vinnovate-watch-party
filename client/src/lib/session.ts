import {
  PRESENCE,
  SYNC,
  type Ack,
  type ClientToServerEvents,
  type NewMedia,
  type PlaybackAction,
  type PlaybackBroadcast,
  type MediaSource,
  type RoomSettings,
} from '@watch-party/shared';
import { ClockSync } from './clock';
import { getSessionId, saveSessionId } from './identity';
import { createSocket, type AppSocket } from './socket';
import { Store, initialState, type ClientState } from './store';
import { ScreenShareClient } from './screenShare';
import { VoiceChat } from './voice';

type AckResult = { ok: boolean; error?: string };

/**
 * One connection to one room. Owns the socket, clock sync and client state,
 * and exposes the actions UI components call. Joining and reconnecting use the
 * same path: every (re)connect re-joins with the saved session id and receives
 * a full snapshot, so late joins and network blips are handled identically.
 */
export class RoomSession {
  readonly store = new Store<ClientState>(initialState());
  readonly socket: AppSocket = createSocket();
  readonly clock = new ClockSync(this.socket);
  /** Subscribers for playback broadcasts (the sync engine). */
  private playbackListeners = new Set<(b: PlaybackBroadcast) => void>();
  private pendingLatency: number | null = null;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private noticeId = 0;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  readonly voice = new VoiceChat(
    this.socket,
    () => this.store.get().memberId,
    (voice) => this.store.set({ voice }),
  );
  readonly screen = new ScreenShareClient(
    this.socket,
    (screen) => this.store.set({ screen }),
    () => void this.stopScreenShare(),
  );

  constructor(
    readonly code: string,
    private name: string,
  ) {}

  start(): void {
    const s = this.socket;
    s.on('connect', () => void this.join());
    s.on('disconnect', (reason) => {
      // "io client disconnect" means we called stop(); anything else will auto-reconnect.
      if (reason !== 'io client disconnect') this.store.set({ status: 'reconnecting' });
    });
    s.on('room:patch', (patch) => {
      this.store.set((st) => (st.room ? { room: { ...st.room, ...patch } } : {}));
      if (patch.voice) this.voice.reconcile(patch.voice);
      if ('screenShare' in patch) this.screen.sync(patch.screenShare?.memberId ?? null, this.store.get().memberId);
    });
    s.on('screen:signal', ({ from, signal }) => void this.screen.handleSignal(from, signal).catch(() => {}));
    s.on('voice:signal', ({ from, signal }) => void this.voice.handleSignal(from, signal).catch(() => {}));
    s.on('playback:state', (b) => this.onPlayback(b));
    s.on('chat:message', (msg) =>
      this.store.set((st) => {
        if (!st.room || st.room.chat.some((m) => m.id === msg.id)) return {};
        return { room: { ...st.room, chat: [...st.room.chat, msg].slice(-200) } };
      }),
    );
    s.on('reaction', (r) => {
      this.store.set((st) => ({ reactions: [...st.reactions, r].slice(-40) }));
      setTimeout(() => this.store.set((st) => ({ reactions: st.reactions.filter((x) => x.id !== r.id) })), 3500);
    });
    s.on('notice', (n) => this.notify(n.level, n.text));
    s.connect();

    this.reportTimer = setInterval(() => this.report(), SYNC.reportIntervalMs);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    if (this.reportTimer) clearInterval(this.reportTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.voice.leave();
    this.screen.destroy();
    this.clock.stop();
    if (this.socket.connected) this.socket.emit('room:leave');
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private async join(): Promise<void> {
    this.store.set((st) => ({ status: st.room ? 'reconnecting' : 'connecting' }));
    const res = await new Promise<Parameters<Parameters<ClientToServerEvents['room:join']>[1]>[0]>((resolve) =>
      this.socket.emit('room:join', { code: this.code, name: this.name, sessionId: getSessionId(this.code) }, resolve),
    );
    if (!res.ok) {
      this.store.set({ status: 'error', error: res.error });
      return;
    }
    saveSessionId(this.code, res.sessionId);
    // Measure the clock offset before applying the snapshot so a late joiner
    // lands on the right position the first time.
    await this.clock.start();
    const current = this.store.get().room?.playback;
    const snapshot = res.snapshot;
    this.store.set({ status: 'joined', error: null, memberId: res.memberId, room: snapshot });
    if (!current || snapshot.playback.version !== current.version) {
      this.playbackListeners.forEach((l) => l({ state: snapshot.playback, origin: { memberId: null, action: 'auto', issuedAt: 0 } }));
    }
    // Pick up (or re-request) an ongoing screen share; a reconnect drops the old link.
    this.screen.sync(null, res.memberId);
    this.screen.sync(snapshot.screenShare?.memberId ?? null, res.memberId);
    // A reconnect drops server-side presence; restore what this client still has.
    const { away, voice } = this.store.get();
    if (away.manual || away.auto) this.socket.emit('presence:afk', { afk: true });
    if (voice.joined) {
      void this.call('voice:join', {}).then(() => this.voice.reconcile(this.store.get().room?.voice ?? []));
    }
  }

  /** Auto-AFK: a tab hidden for PRESENCE.hiddenAfkMs marks you away; coming back clears it. */
  private onVisibility = () => {
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    if (document.hidden) {
      this.hiddenTimer = setTimeout(() => this.setAway({ auto: true }), PRESENCE.hiddenAfkMs);
    } else if (this.store.get().away.auto) {
      this.setAway({ auto: false });
    }
  };

  private setAway(patch: Partial<ClientState['away']>): void {
    const before = this.store.get().away;
    const away = { ...before, ...patch };
    this.store.set({ away });
    const was = before.manual || before.auto;
    const now = away.manual || away.auto;
    if (was !== now) this.socket.emit('presence:afk', { afk: now });
  }

  private onPlayback(b: PlaybackBroadcast): void {
    const room = this.store.get().room;
    if (!room || b.state.version <= room.playback.version) return; // stale / out-of-order
    if (b.origin.issuedAt > 0) {
      const latency = Math.max(0, this.clock.serverNow() - b.origin.issuedAt);
      this.pendingLatency = latency;
      this.store.set((st) => ({ sync: { ...st.sync, lastControlLatencyMs: Math.round(latency) } }));
    }
    this.store.set({ room: { ...room, playback: b.state } });
    this.playbackListeners.forEach((l) => l(b));
  }

  onPlaybackState(listener: (b: PlaybackBroadcast) => void): () => void {
    this.playbackListeners.add(listener);
    return () => this.playbackListeners.delete(listener);
  }

  reportDrift(driftMs: number): void {
    this.store.set((st) => ({ sync: { ...st.sync, driftMs: Math.round(driftMs), offsetMs: Math.round(this.clock.offsetMs), rttMs: this.clock.rttMs } }));
  }

  private report(): void {
    if (!this.socket.connected || this.store.get().status !== 'joined') return;
    const { sync } = this.store.get();
    this.socket.emit('playback:report', {
      rttMs: this.clock.rttMs,
      driftMs: sync.driftMs,
      ...(this.pendingLatency != null ? { lastControlLatencyMs: Math.round(this.pendingLatency) } : {}),
    });
    this.pendingLatency = null;
  }

  notify(level: 'info' | 'error', text: string): void {
    const id = ++this.noticeId;
    this.store.set((st) => ({ notices: [...st.notices, { id, level, text }].slice(-4) }));
    setTimeout(() => this.store.set((st) => ({ notices: st.notices.filter((n) => n.id !== id) })), 4000);
  }

  // -------------------------------------------------------------------------
  // Derived helpers
  // -------------------------------------------------------------------------

  get isHost(): boolean {
    const { room, memberId } = this.store.get();
    return !!room && room.hostId === memberId;
  }

  get canControl(): boolean {
    const room = this.store.get().room;
    return !!room && (room.settings.controlMode === 'everyone' || this.isHost);
  }

  get canPause(): boolean {
    const room = this.store.get().room;
    return !!room && (room.settings.pausePolicy === 'anyone' || this.canControl);
  }

  // -------------------------------------------------------------------------
  // Actions (what UI components call)
  // -------------------------------------------------------------------------

  /** Emit with an ack; failed acks become an error toast. */
  private call<E extends keyof ClientToServerEvents>(event: E, payload: Parameters<ClientToServerEvents[E]>[0]): Promise<AckResult> {
    return new Promise((resolve) => {
      const ack: Ack = (res) => {
        if (!res.ok && res.error) this.notify('error', res.error);
        resolve(res);
      };
      (this.socket.emit as (e: string, p: unknown, a: Ack) => void)(event, payload, ack);
    });
  }

  command(action: PlaybackAction, extra: { position?: number; media?: NewMedia; rate?: number } = {}): Promise<AckResult> {
    const room = this.store.get().room;
    return this.call('playback:command', {
      action,
      ...extra,
      baseVersion: room?.playback.version ?? 0,
      issuedAt: this.clock.serverNow(),
    });
  }

  play = () => this.command('play');
  pause = () => this.command('pause');
  seek = (position: number) => this.command('seek', { position });
  load = (media: NewMedia) => this.command('load', { media });
  setRate = (rate: number) => this.command('rate', { rate });
  ended = (mediaId: string) => this.socket.emit('playback:ended', { mediaId });

  sendChat = (text: string) => this.call('chat:send', { text });
  react = (emoji: string, position: number) => this.socket.emit('reaction:send', { emoji, position });

  addToPlaylist = (media: NewMedia) => this.call('playlist:add', { media });
  removeFromPlaylist = (itemId: string) => this.call('playlist:remove', { itemId });
  vote = (itemId: string) => this.socket.emit('playlist:vote', { itemId });
  playItem = (itemId: string) => this.call('playlist:play', { itemId });

  createPoll = (question: string, options: string[], mediaItemIds?: (string | undefined)[]) =>
    this.call('poll:create', { question, options, mediaItemIds });
  votePoll = (pollId: string, optionId: string) => this.socket.emit('poll:vote', { pollId, optionId });
  closePoll = (pollId: string) => this.socket.emit('poll:close', { pollId });

  transferHost = (memberId: string) => this.call('host:transfer', { memberId });
  updateSettings = (patch: Partial<RoomSettings>) => this.call('settings:update', patch);

  requestPause = () => this.call('pause:request', {});
  votePause = (requestId: string, agree: boolean) => this.call('pause:vote', { requestId, agree });

  /** "Step away" button. */
  setStepAway = (away: boolean) => this.setAway({ manual: away, ...(away ? {} : { auto: false }) });
  reportBuffering = (mediaId: string, buffering: boolean) => this.socket.emit('buffer:state', { mediaId, buffering });

  createClip = (start: number, end: number) => this.call('clip:create', { start, end });
  removeClip = (clipId: string) => this.call('clip:remove', { clipId });

  startTrailerVote = (options: NewMedia[]) => this.call('trailers:start', { options });
  voteTrailer = (optionId: string) => this.socket.emit('trailers:vote', { optionId });
  closeTrailerVote = () => this.call('trailers:close', {});
  cancelTrailerVote = () => this.call('trailers:cancel', {});

  /** Open the lobby, optionally with a countdown; `active: false` starts the show. */
  setLobby = (active: boolean, countdownSec: number | null = null) => this.call('lobby:set', { active, countdownSec });

  joinVoice = async () => {
    try {
      await this.voice.join();
    } catch {
      this.notify('error', 'Microphone permission is needed for voice');
      return;
    }
    const res = await this.call('voice:join', {});
    if (!res.ok) return this.voice.leave();
    this.voice.reconcile(this.store.get().room?.voice ?? []);
  };
  leaveVoice = () => {
    this.voice.leave();
    this.socket.emit('voice:leave', {});
  };
  setVoiceMuted = (muted: boolean) => this.voice.setMuted(muted);

  setLockToHost = (lockToHost: boolean) => this.store.set({ lockToHost });

  setLobbyTrack = (track: { title: string; source: MediaSource } | null) => this.call('lobby:track', { track });

  /** Pick a screen/window/tab, then announce the share; viewers request the stream. */
  startScreenShare = async () => {
    try {
      await this.screen.capture();
    } catch {
      return; // cancelled the picker
    }
    const res = await this.call('screen:start', {});
    if (!res.ok) this.screen.stopSharing();
  };
  stopScreenShare = async () => {
    this.screen.stopSharing();
    await this.call('screen:stop', {});
  };
}
