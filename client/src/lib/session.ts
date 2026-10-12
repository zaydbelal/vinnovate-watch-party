import {
  SYNC,
  type Ack,
  type ClientToServerEvents,
  type MediaItem,
  type PlaybackAction,
  type PlaybackBroadcast,
  type RoomSettings,
} from '@watch-party/shared';
import { ClockSync } from './clock';
import { getSessionId, saveSessionId } from './identity';
import { createSocket, type AppSocket } from './socket';
import { Store, initialState, type ClientState } from './store';

type NewMedia = Omit<MediaItem, 'id' | 'addedBy' | 'votes'>;
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
    s.on('room:patch', (patch) => this.store.set((st) => (st.room ? { room: { ...st.room, ...patch } } : {})));
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
  }

  stop(): void {
    if (this.reportTimer) clearInterval(this.reportTimer);
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

  command(action: PlaybackAction, extra: { position?: number; media?: NewMedia } = {}): Promise<AckResult> {
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
}
