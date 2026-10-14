import { randomUUID } from 'node:crypto';
import {
  BUFFERING,
  CLIPS,
  LIMITS,
  LOBBY,
  PAUSE_VOTE,
  PLAYBACK_RATES,
  REACTION_EMOJIS,
  STREAMING_PROVIDERS,
  TRAILERS,
  VOICE,
  expectedPosition,
  formatTime,
  type AutoAction,
  type BufferHold,
  type ChatMessage,
  type Clip,
  type Lobby,
  type MediaItem,
  type MediaSource,
  type NewMedia,
  type Member,
  type MemberStats,
  type PlaybackAction,
  type PlaybackBroadcast,
  type PlaybackCommand,
  type PlaybackState,
  type PauseRequest,
  type Poll,
  type Reaction,
  type RoomPatch,
  type RoomSettings,
  type RoomSnapshot,
  type TrailerVote,
} from '@watch-party/shared';

/** Thrown for user-facing failures; the socket layer turns it into an ack error. */
export class RoomError extends Error {}

/** How a room talks to the outside world. socket.io in prod, a spy in tests. */
export interface RoomEmitter {
  patch(patch: RoomPatch): void;
  playback(payload: PlaybackBroadcast): void;
  chat(msg: ChatMessage): void;
  reaction(reaction: Reaction): void;
}

export interface MemberRecord extends Member {
  sessionId: string;
  socketId: string | null;
}

const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#e11d48', '#a855f7', '#14b8a6', '#eab308', '#ec4899', '#06b6d4', '#84cc16'];

/**
 * All state and rules for one room. Contains no networking or timers so it
 * can be unit-tested directly; RoomManager wires it to socket.io.
 */
export class Room {
  hostId: string | null = null;
  readonly members = new Map<string, MemberRecord>();
  playback: PlaybackState = { media: null, playing: false, position: 0, rate: 1, updatedAt: 0, version: 0 };
  playlist: MediaItem[] = [];
  chat: ChatMessage[] = [];
  polls: Poll[] = [];
  settings: RoomSettings = { controlMode: 'host', pausePolicy: 'anyone', waitForBuffering: true };
  history: string[] = [];
  pauseRequest: PauseRequest | null = null;
  clips: Clip[] = [];
  trailerVote: TrailerVote | null = null;
  lobby: Lobby = { active: LOBBY.openOnCreate, startsAt: null };
  bufferHold: BufferHold | null = null;
  voice: string[] = [];
  /** Recent control-propagation latencies reported by clients (ms), for /api/metrics. */
  readonly latencySamples: number[] = [];
  /** Set when member stats changed; RoomManager flushes them on an interval. */
  statsDirty = false;
  /** Playback version at which the current media was loaded (stale-command guard). */
  private mediaVersion = 0;
  private colorIndex = 0;
  /** Who paused last; they may resume even without playback control. */
  private pausedBy: string | null = null;
  /** memberId -> time their last buffer hold ended (see BUFFERING.cooldownMs). */
  private bufferCooldown = new Map<string, number>();

  constructor(
    readonly code: string,
    private readonly emit: RoomEmitter,
    private readonly now: () => number = Date.now,
  ) {}

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      hostId: this.hostId,
      members: this.publicMembers(),
      playback: this.playback,
      playlist: this.playlist,
      chat: this.chat,
      polls: this.polls,
      settings: this.settings,
      history: this.history,
      pauseRequest: this.pauseRequest,
      clips: this.clips,
      trailerVote: this.trailerVote,
      lobby: this.lobby,
      bufferHold: this.bufferHold,
      voice: this.voice,
    };
  }

  /** Time-based rules: countdown end, pause-request expiry, buffer-hold timeout. Called by RoomManager. */
  tick(): void {
    const now = this.now();
    if (this.lobby.active && this.lobby.startsAt != null && now >= this.lobby.startsAt) this.endLobby(this.lobby.startsAt);
    if (this.pauseRequest && now >= this.pauseRequest.expiresAt) {
      this.system('Pause request expired');
      this.pauseRequest = null;
      this.emit.patch({ pauseRequest: null });
    }
    if (this.bufferHold && now - this.bufferHold.since >= BUFFERING.maxHoldMs) {
      const names = this.bufferHold.memberIds.map((id) => this.nameOf(id)).join(', ');
      this.releaseBufferHold(true);
      this.system(`Resumed without ${names} (still buffering)`);
    }
  }

  // -------------------------------------------------------------------------
  // Members & host
  // -------------------------------------------------------------------------

  publicMembers(): Member[] {
    return [...this.members.values()].map(({ sessionId: _s, socketId: _k, ...m }) => m);
  }

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected) n++;
    return n;
  }

  findBySession(sessionId: string): MemberRecord | undefined {
    for (const m of this.members.values()) if (m.sessionId === sessionId) return m;
    return undefined;
  }

  addMember(name: string, socketId: string, maxMembers: number = LIMITS.maxMembersPerRoom): MemberRecord {
    if (this.connectedCount >= maxMembers) throw new RoomError(`Room is full (${maxMembers} people max)`);
    const member: MemberRecord = {
      id: randomUUID(),
      sessionId: randomUUID(),
      socketId,
      name: cleanName(name),
      color: COLORS[this.colorIndex++ % COLORS.length],
      connected: true,
      joinedAt: this.now(),
      afk: false,
      buffering: false,
    };
    this.members.set(member.id, member);
    if (!this.hostId) this.hostId = member.id;
    this.system(`${member.name} joined`);
    this.emit.patch({ members: this.publicMembers(), hostId: this.hostId });
    return member;
  }

  reconnect(member: MemberRecord, socketId: string, name?: string): void {
    member.socketId = socketId;
    member.connected = true;
    if (name) member.name = cleanName(name);
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = member.id;
    this.emit.patch({ members: this.publicMembers(), hostId: this.hostId });
  }

  disconnect(memberId: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    m.connected = false;
    m.socketId = null;
    this.dropTransient(memberId);
    this.emit.patch({ members: this.publicMembers() });
  }

  /** Forget voice / buffering / vote involvement of someone who is gone. */
  private dropTransient(memberId: string): void {
    const m = this.members.get(memberId);
    if (m) m.buffering = false;
    if (this.voice.includes(memberId)) this.leaveVoice(memberId);
    this.clearFromBufferHold(memberId);
    this.recheckPauseRequest();
  }

  /** Permanently remove a member (left, or reconnect grace expired). */
  removeMember(memberId: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    this.members.delete(memberId);
    this.dropTransient(memberId);
    this.system(`${m.name} left`);
    if (this.hostId === memberId) this.electHost();
    this.emit.patch({ members: this.publicMembers(), hostId: this.hostId });
  }

  /** Hand host to the longest-present connected member. */
  electHost(): void {
    const candidates = [...this.members.values()].filter((m) => m.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    const next = candidates[0] ?? null;
    this.hostId = next?.id ?? null;
    if (next) this.system(`${next.name} is now the host`);
    this.emit.patch({ hostId: this.hostId });
  }

  transferHost(byId: string, toId: string): void {
    if (this.hostId !== byId) throw new RoomError('Only the host can transfer host');
    const target = this.members.get(toId);
    if (!target || !target.connected) throw new RoomError('That person is not in the room');
    this.hostId = toId;
    this.system(`${target.name} is now the host`);
    this.emit.patch({ hostId: this.hostId });
  }

  updateSettings(byId: string, patch: Partial<RoomSettings>): void {
    if (this.hostId !== byId) throw new RoomError('Only the host can change settings');
    if (patch.controlMode !== undefined && patch.controlMode !== 'host' && patch.controlMode !== 'everyone') {
      throw new RoomError('Invalid control mode');
    }
    if (patch.pausePolicy !== undefined && patch.pausePolicy !== 'anyone' && patch.pausePolicy !== 'vote') {
      throw new RoomError('Invalid pause policy');
    }
    if (patch.waitForBuffering !== undefined && typeof patch.waitForBuffering !== 'boolean') throw new RoomError('Invalid setting');
    const before = this.settings;
    this.settings = { ...this.settings, ...pick(patch, ['controlMode', 'pausePolicy', 'waitForBuffering']) };
    if (before.controlMode !== this.settings.controlMode) {
      this.system(this.settings.controlMode === 'everyone' ? 'Everyone can now control playback' : 'Only the host can control playback');
    }
    if (before.pausePolicy !== this.settings.pausePolicy) {
      this.system(this.settings.pausePolicy === 'anyone' ? 'Anyone can pause' : 'Pausing now needs half the room to agree');
    }
    if (before.waitForBuffering !== this.settings.waitForBuffering) {
      this.system(this.settings.waitForBuffering ? 'The room will wait for anyone buffering' : 'The room will no longer wait for buffering');
      if (!this.settings.waitForBuffering) this.releaseBufferHold(true);
    }
    this.emit.patch({ settings: this.settings });
  }

  /** Broadcast member stats if they changed since the last flush. */
  flushStats(): void {
    if (!this.statsDirty) return;
    this.statsDirty = false;
    this.emit.patch({ members: this.publicMembers() });
  }

  canControl(memberId: string): boolean {
    return this.settings.controlMode === 'everyone' || this.hostId === memberId;
  }

  /** Pausing is open to anyone by default; in vote mode non-controllers must ask. */
  canPause(memberId: string): boolean {
    return this.settings.pausePolicy === 'anyone' || this.canControl(memberId);
  }

  /** Whoever paused (or asked for the pause) may resume, even without control. */
  canResume(memberId: string): boolean {
    return this.canControl(memberId) || (!this.playback.playing && this.pausedBy != null && this.pausedBy === memberId);
  }

  /** Present and not AFK: the people a pause vote counts. */
  activeMembers(): MemberRecord[] {
    return [...this.members.values()].filter((m) => m.connected && !m.afk);
  }

  updateStats(memberId: string, stats: MemberStats): void {
    const m = this.members.get(memberId);
    if (!m) return;
    m.stats = {
      rttMs: clampNum(stats.rttMs, 0, 60_000),
      driftMs: clampNum(stats.driftMs, -3_600_000, 3_600_000),
      lastControlLatencyMs: stats.lastControlLatencyMs == null ? m.stats?.lastControlLatencyMs : clampNum(stats.lastControlLatencyMs, 0, 60_000),
    };
    this.statsDirty = true;
    // Clients send a latency only once per received command, so each is a fresh sample.
    if (stats.lastControlLatencyMs != null) {
      this.latencySamples.push(m.stats.lastControlLatencyMs!);
      if (this.latencySamples.length > 1000) this.latencySamples.shift();
    }
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  /**
   * Apply a play/pause/seek/load command. Commands are serialised by the
   * single-threaded event loop; each accepted one bumps `version`.
   * Returns false when the command was a no-op (e.g. two people hit pause).
   */
  applyCommand(memberId: string, cmd: PlaybackCommand): boolean {
    const allowed =
      cmd.action === 'pause' ? this.canPause(memberId) : cmd.action === 'play' ? this.canResume(memberId) : this.canControl(memberId);
    if (!allowed) {
      throw new RoomError(cmd.action === 'pause' ? 'Ask the room to pause instead' : 'Only the host can control playback');
    }
    const now = this.now();
    const cur = this.playback;

    if (cmd.action !== 'load') {
      if (!cur.media) throw new RoomError('Nothing is playing yet');
      // A command aimed at a video that has since been replaced is stale.
      if (typeof cmd.baseVersion === 'number' && cmd.baseVersion < this.mediaVersion) return false;
    }

    // Pause/play at the moment the user clicked (bounded, so a bad client clock can't jump us).
    const issuedAt = Math.min(now, Math.max(now - 2000, Number(cmd.issuedAt) || now));
    let next: PlaybackState;

    switch (cmd.action) {
      case 'play':
        if (cur.playing) return false;
        // Pressing play on the lobby screen starts the show.
        if (this.lobby.active) {
          this.endLobby(now, memberId);
          return true;
        }
        next = { ...cur, playing: true, position: expectedPosition(cur, now) };
        break;
      case 'pause':
        if (!cur.playing) return false;
        next = { ...cur, playing: false, position: this.clampPosition(expectedPosition(cur, issuedAt)) };
        break;
      case 'rate': {
        const rate = Number(cmd.rate);
        if (!(PLAYBACK_RATES as readonly number[]).includes(rate)) throw new RoomError('Unsupported speed');
        if (rate === cur.rate) return false;
        next = { ...cur, position: this.clampPosition(expectedPosition(cur, now)), rate };
        this.system(`${this.nameOf(memberId)} set speed to ${rate}×`);
        break;
      }
      case 'seek': {
        const position = Number(cmd.position);
        if (!Number.isFinite(position)) throw new RoomError('Invalid seek position');
        next = { ...cur, position: this.clampPosition(position) };
        break;
      }
      case 'load': {
        if (!cmd.media) throw new RoomError('No media to load');
        this.loadMedia(this.makeItem(cmd.media, memberId), memberId, issuedAt);
        return true;
      }
      default:
        throw new RoomError('Unknown action');
    }

    if (cmd.action === 'play' || cmd.action === 'pause') {
      // A manual play/pause overrides automatic holds and pending requests.
      this.bufferHold = null;
      this.clearPauseRequest();
      this.pausedBy = cmd.action === 'pause' ? memberId : null;
      if (cmd.action === 'pause' && !this.canControl(memberId)) this.system(`${this.nameOf(memberId)} paused`);
      this.emit.patch({ bufferHold: null });
    }
    this.commit({ ...next, updatedAt: now }, memberId, cmd.action, issuedAt);
    return true;
  }

  /** Called when a client reports the video ended. Idempotent per media id. */
  mediaEnded(mediaId: string): boolean {
    if (this.playback.media?.id !== mediaId) return false;
    return this.playNext(null);
  }

  /** Play the most-voted queued item (ties: earliest added). */
  playNext(byId: string | null): boolean {
    if (this.playlist.length === 0) {
      if (!this.playback.playing) return false;
      this.commit({ ...this.playback, playing: false, position: expectedPosition(this.playback, this.now()), updatedAt: this.now() }, byId, 'auto', this.now());
      return true;
    }
    let best = 0;
    this.playlist.forEach((item, i) => {
      if (item.votes.length > this.playlist[best].votes.length) best = i;
    });
    const [item] = this.playlist.splice(best, 1);
    this.emit.patch({ playlist: this.playlist });
    this.loadMedia(item, byId, this.now());
    return true;
  }

  private loadMedia(item: MediaItem, byId: string | null, issuedAt: number): void {
    const now = this.now();
    this.mediaVersion = this.playback.version + 1;
    this.pausedBy = null;
    this.clearPauseRequest();
    this.releaseBufferHold(false);
    for (const m of this.members.values()) m.buffering = false;
    if (item.catalogId) {
      this.history = [...this.history.filter((id) => id !== item.catalogId), item.catalogId].slice(-50);
      this.emit.patch({ history: this.history });
    }
    // In the lobby the video loads paused so everyone can preload before showtime.
    const playing = !this.lobby.active;
    this.system(playing ? `Now playing: ${item.title}` : `Up next: ${item.title}`);
    this.commit({ media: item, playing, position: 0, rate: 1, updatedAt: now, version: 0 }, byId, byId ? 'load' : 'auto', issuedAt);
  }

  private commit(state: PlaybackState, memberId: string | null, action: PlaybackAction | AutoAction, issuedAt: number): void {
    if (state.playing) this.pausedBy = null;
    this.playback = { ...state, pausedBy: this.pausedBy, version: this.playback.version + 1 };
    this.emit.playback({ state: this.playback, origin: { memberId, action, issuedAt } });
  }

  private clampPosition(pos: number): number {
    const max = this.playback.media?.durationSec;
    return Math.max(0, max ? Math.min(pos, max) : pos);
  }

  // -------------------------------------------------------------------------
  // Playlist
  // -------------------------------------------------------------------------

  addToPlaylist(memberId: string, media: NewMedia): MediaItem {
    if (this.playlist.length >= LIMITS.maxPlaylistItems) throw new RoomError('Playlist is full');
    const item = this.makeItem(media, memberId);
    this.playlist.push(item);
    this.system(`${this.nameOf(memberId)} queued ${item.title}`);
    this.emit.patch({ playlist: this.playlist });
    return item;
  }

  removeFromPlaylist(memberId: string, itemId: string): void {
    const item = this.playlist.find((i) => i.id === itemId);
    if (!item) throw new RoomError('Item not found');
    if (item.addedBy !== memberId && this.hostId !== memberId) throw new RoomError('Only the host or whoever added it can remove this');
    this.playlist = this.playlist.filter((i) => i.id !== itemId);
    this.emit.patch({ playlist: this.playlist });
  }

  toggleVote(memberId: string, itemId: string): void {
    const item = this.playlist.find((i) => i.id === itemId);
    if (!item) return;
    item.votes = item.votes.includes(memberId) ? item.votes.filter((v) => v !== memberId) : [...item.votes, memberId];
    this.emit.patch({ playlist: this.playlist });
  }

  playFromPlaylist(memberId: string, itemId: string): void {
    if (!this.canControl(memberId)) throw new RoomError('Only the host can change the video');
    const idx = this.playlist.findIndex((i) => i.id === itemId);
    if (idx < 0) throw new RoomError('Item not found');
    const [item] = this.playlist.splice(idx, 1);
    this.emit.patch({ playlist: this.playlist });
    this.loadMedia(item, memberId, this.now());
  }

  private makeItem(media: NewMedia, memberId: string): MediaItem {
    return {
      id: randomUUID(),
      title: String(media?.title || 'Untitled').slice(0, 200),
      source: cleanSource(media?.source),
      thumbnail: media.thumbnail ? String(media.thumbnail).slice(0, 2000) : undefined,
      durationSec: Number.isFinite(media.durationSec) ? Number(media.durationSec) : undefined,
      catalogId: media.catalogId ? String(media.catalogId).slice(0, 100) : undefined,
      addedBy: memberId,
      votes: [],
    };
  }

  // -------------------------------------------------------------------------
  // Pause requests (vote mode)
  // -------------------------------------------------------------------------

  pauseVotesNeeded(): number {
    return Math.max(1, Math.ceil(this.activeMembers().length * PAUSE_VOTE.share));
  }

  /** Ask the room to pause. Joining an open request counts as agreeing. */
  requestPause(memberId: string): void {
    if (!this.playback.media || !this.playback.playing) throw new RoomError('Nothing is playing');
    if (this.pauseRequest) return this.votePause(memberId, this.pauseRequest.id, true);
    this.pauseRequest = {
      id: randomUUID(),
      requestedBy: memberId,
      votes: [memberId],
      needed: this.pauseVotesNeeded(),
      expiresAt: this.now() + PAUSE_VOTE.ttlMs,
    };
    this.system(`${this.nameOf(memberId)} asked to pause`);
    this.recheckPauseRequest();
  }

  votePause(memberId: string, requestId: string, agree: boolean): void {
    const req = this.pauseRequest;
    if (!req || req.id !== requestId) throw new RoomError('That request has ended');
    req.votes = agree ? [...new Set([...req.votes, memberId])] : req.votes.filter((v) => v !== memberId);
    this.recheckPauseRequest();
  }

  /** Re-count after a vote or a change in who is active; pause once enough agree. */
  private recheckPauseRequest(): void {
    const req = this.pauseRequest;
    if (!req) return;
    const active = new Set(this.activeMembers().map((m) => m.id));
    req.needed = this.pauseVotesNeeded();
    const count = req.votes.filter((v) => active.has(v)).length;
    if (count >= req.needed && this.playback.playing) {
      const now = this.now();
      this.pauseRequest = null;
      this.pausedBy = req.requestedBy;
      this.system(`Paused by vote (${count}/${active.size})`);
      this.emit.patch({ pauseRequest: null });
      this.commit({ ...this.playback, playing: false, position: this.clampPosition(expectedPosition(this.playback, now)), updatedAt: now }, null, 'vote', now);
      return;
    }
    this.emit.patch({ pauseRequest: req });
  }

  private clearPauseRequest(): void {
    if (!this.pauseRequest) return;
    this.pauseRequest = null;
    this.emit.patch({ pauseRequest: null });
  }

  // -------------------------------------------------------------------------
  // Presence (AFK) and auto-buffer catching
  // -------------------------------------------------------------------------

  setAfk(memberId: string, afk: boolean): void {
    const m = this.members.get(memberId);
    if (!m || m.afk === !!afk) return;
    m.afk = !!afk;
    this.system(m.afk ? `${m.name} stepped away` : `${m.name} is back`);
    if (m.afk) this.clearFromBufferHold(memberId);
    this.emit.patch({ members: this.publicMembers() });
    this.recheckPauseRequest();
  }

  /**
   * A client reports its player stalled (or recovered). With waitForBuffering
   * on, the first stall pauses the room; when every stalled viewer has caught
   * up, the room resumes from where it stopped.
   */
  setBuffering(memberId: string, mediaId: string, buffering: boolean): void {
    const m = this.members.get(memberId);
    if (!m || this.playback.media?.id !== mediaId || m.buffering === !!buffering) return;
    m.buffering = !!buffering;
    this.statsDirty = true;
    if (!buffering) return this.clearFromBufferHold(memberId);

    const cooldownUntil = (this.bufferCooldown.get(memberId) ?? 0) + BUFFERING.cooldownMs;
    if (!this.settings.waitForBuffering || m.afk || this.lobby.active || this.now() < cooldownUntil) return;
    if (this.bufferHold) {
      if (!this.bufferHold.memberIds.includes(memberId)) this.bufferHold.memberIds.push(memberId);
      this.emit.patch({ bufferHold: this.bufferHold });
      return;
    }
    if (!this.playback.playing) return;
    const now = this.now();
    this.bufferHold = { memberIds: [memberId], since: now };
    this.emit.patch({ bufferHold: this.bufferHold });
    this.commit({ ...this.playback, playing: false, position: this.clampPosition(expectedPosition(this.playback, now)), updatedAt: now }, null, 'buffer', now);
  }

  private clearFromBufferHold(memberId: string): void {
    const hold = this.bufferHold;
    if (!hold || !hold.memberIds.includes(memberId)) return;
    hold.memberIds = hold.memberIds.filter((id) => id !== memberId);
    this.bufferCooldown.set(memberId, this.now());
    if (hold.memberIds.length === 0) this.releaseBufferHold(true);
    else this.emit.patch({ bufferHold: hold });
  }

  private releaseBufferHold(resume: boolean): void {
    if (!this.bufferHold) return;
    for (const id of this.bufferHold.memberIds) this.bufferCooldown.set(id, this.now());
    this.bufferHold = null;
    this.emit.patch({ bufferHold: null });
    if (resume && this.playback.media && !this.playback.playing) {
      const now = this.now();
      this.commit({ ...this.playback, playing: true, updatedAt: now }, null, 'buffer', now);
    }
  }

  // -------------------------------------------------------------------------
  // Lobby (pre-show screen with countdown)
  // -------------------------------------------------------------------------

  setLobby(byId: string, active: boolean, countdownSec?: number | null): void {
    if (this.hostId !== byId) throw new RoomError('Only the host can run the lobby');
    if (!active) return this.endLobby(this.now(), byId);
    let startsAt: number | null = null;
    if (countdownSec != null) {
      const sec = Number(countdownSec);
      if (!Number.isFinite(sec) || sec < 1 || sec > LOBBY.maxCountdownSec) throw new RoomError('Invalid countdown');
      startsAt = this.now() + Math.round(sec * 1000);
    }
    const wasActive = this.lobby.active;
    this.lobby = { active: true, startsAt };
    if (!wasActive) this.system('Intermission');
    if (startsAt != null) this.system(`Show starts in ${formatTime(Number(countdownSec))}`);
    this.emit.patch({ lobby: this.lobby });
    if (this.playback.playing) {
      const now = this.now();
      this.releaseBufferHold(false);
      this.commit({ ...this.playback, playing: false, position: this.clampPosition(expectedPosition(this.playback, now)), updatedAt: now }, byId, 'lobby', now);
    }
  }

  /**
   * Leave the lobby and roll the video. `at` anchors the timeline: when a
   * countdown ends it is the scheduled start, so every client starts together
   * even if this tick ran a few ms late.
   */
  private endLobby(at: number, byId: string | null = null): void {
    if (!this.lobby.active) return;
    this.lobby = { active: false, startsAt: null };
    this.emit.patch({ lobby: this.lobby });
    if (!this.playback.media) return;
    this.system('Showtime');
    if (!this.playback.playing) {
      this.pausedBy = null;
      this.commit({ ...this.playback, playing: true, updatedAt: Math.min(at, this.now()) }, byId, 'lobby', this.now());
    }
  }

  // -------------------------------------------------------------------------
  // Trailer vote (host shortlists, the room picks)
  // -------------------------------------------------------------------------

  startTrailerVote(byId: string, options: NewMedia[]): TrailerVote {
    if (this.hostId !== byId) throw new RoomError('Only the host can start a trailer vote');
    const list = Array.isArray(options) ? options : [];
    if (list.length < TRAILERS.minOptions || list.length > TRAILERS.maxOptions) {
      throw new RoomError(`Pick ${TRAILERS.minOptions}-${TRAILERS.maxOptions} trailers`);
    }
    this.trailerVote = {
      id: randomUUID(),
      open: true,
      winnerId: null,
      options: list.map((m) => {
        const item = this.makeItem(m, byId);
        return { id: item.id, title: item.title, source: item.source, thumbnail: item.thumbnail, durationSec: item.durationSec, catalogId: item.catalogId, votes: [] };
      }),
    };
    this.system(`${this.nameOf(byId)} started a trailer vote`);
    this.emit.patch({ trailerVote: this.trailerVote });
    return this.trailerVote;
  }

  /** One vote per member; voting for your current pick again removes it. */
  voteTrailer(memberId: string, optionId: string): void {
    const tv = this.trailerVote;
    const option = tv?.options.find((o) => o.id === optionId);
    if (!tv || !tv.open || !option) return;
    const had = option.votes.includes(memberId);
    for (const o of tv.options) o.votes = o.votes.filter((v) => v !== memberId);
    if (!had) option.votes.push(memberId);
    this.emit.patch({ trailerVote: tv });
  }

  /** Close voting and load the winner (ties go to the earlier option). */
  closeTrailerVote(byId: string): void {
    const tv = this.trailerVote;
    if (this.hostId !== byId) throw new RoomError('Only the host can close the vote');
    if (!tv || !tv.open) throw new RoomError('No vote is open');
    let winner = tv.options[0];
    for (const o of tv.options) if (o.votes.length > winner.votes.length) winner = o;
    tv.open = false;
    tv.winnerId = winner.id;
    this.system(`The room picked ${winner.title} (${winner.votes.length} vote${winner.votes.length === 1 ? '' : 's'})`);
    this.emit.patch({ trailerVote: tv });
    const { votes: _v, id: _id, ...media } = winner;
    this.loadMedia(this.makeItem(media, byId), byId, this.now());
  }

  cancelTrailerVote(byId: string): void {
    if (this.hostId !== byId) throw new RoomError('Only the host can cancel the vote');
    this.trailerVote = null;
    this.emit.patch({ trailerVote: null });
  }

  // -------------------------------------------------------------------------
  // Clips
  // -------------------------------------------------------------------------

  createClip(memberId: string, start: number, end: number): Clip {
    const media = this.playback.media;
    if (!media) throw new RoomError('Nothing is playing');
    const e = this.clampPosition(Number(end));
    const s = Math.max(0, Number(start));
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new RoomError('Invalid clip range');
    if (e - s > CLIPS.maxSec + 0.5) throw new RoomError(`Clips can be at most ${CLIPS.maxSec} s`);
    const clip: Clip = {
      id: randomUUID(),
      mediaId: media.id,
      mediaTitle: media.title,
      source: media.source,
      start: s,
      end: e,
      createdBy: memberId,
      createdAt: this.now(),
    };
    this.clips = [...this.clips, clip].slice(-CLIPS.maxPerRoom);
    this.system(`${this.nameOf(memberId)} clipped ${formatTime(s)}–${formatTime(e)} of ${media.title}`);
    this.emit.patch({ clips: this.clips });
    return clip;
  }

  removeClip(memberId: string, clipId: string): void {
    const clip = this.clips.find((c) => c.id === clipId);
    if (!clip) throw new RoomError('Clip not found');
    if (clip.createdBy !== memberId && this.hostId !== memberId) throw new RoomError('Only the host or whoever made it can remove this');
    this.clips = this.clips.filter((c) => c.id !== clipId);
    this.emit.patch({ clips: this.clips });
  }

  // -------------------------------------------------------------------------
  // Voice channel membership (signalling itself is relayed by the socket layer)
  // -------------------------------------------------------------------------

  joinVoice(memberId: string): void {
    if (this.voice.includes(memberId)) return;
    if (this.voice.length >= VOICE.maxParticipants) throw new RoomError(`Voice is full (${VOICE.maxParticipants} max)`);
    this.voice = [...this.voice, memberId];
    this.emit.patch({ voice: this.voice });
  }

  leaveVoice(memberId: string): void {
    if (!this.voice.includes(memberId)) return;
    this.voice = this.voice.filter((id) => id !== memberId);
    this.emit.patch({ voice: this.voice });
  }

  // -------------------------------------------------------------------------
  // Chat & reactions
  // -------------------------------------------------------------------------

  addChat(memberId: string, text: string): ChatMessage {
    const clean = String(text ?? '').trim().slice(0, LIMITS.maxChatLength);
    if (!clean) throw new RoomError('Empty message');
    return this.pushChat({ id: randomUUID(), memberId, name: this.nameOf(memberId), text: clean, ts: this.now() });
  }

  system(text: string): ChatMessage {
    return this.pushChat({ id: randomUUID(), memberId: null, name: 'system', text, ts: this.now(), system: true });
  }

  private pushChat(msg: ChatMessage): ChatMessage {
    this.chat.push(msg);
    if (this.chat.length > LIMITS.chatHistory) this.chat.splice(0, this.chat.length - LIMITS.chatHistory);
    this.emit.chat(msg);
    return msg;
  }

  react(memberId: string, emoji: string, position: number): void {
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) throw new RoomError('Unsupported reaction');
    this.emit.reaction({ id: randomUUID(), memberId, emoji, position: Number(position) || 0 });
  }

  // -------------------------------------------------------------------------
  // Polls
  // -------------------------------------------------------------------------

  createPoll(memberId: string, question: string, options: string[], mediaItemIds: (string | undefined)[] = []): Poll {
    const q = String(question ?? '').trim().slice(0, 200);
    const opts = (Array.isArray(options) ? options : []).map((o) => String(o ?? '').trim().slice(0, 100)).filter(Boolean);
    if (!q) throw new RoomError('Poll needs a question');
    if (opts.length < 2 || opts.length > LIMITS.maxPollOptions) throw new RoomError(`Poll needs 2-${LIMITS.maxPollOptions} options`);
    if (this.polls.filter((p) => !p.closed).length >= LIMITS.maxOpenPolls) throw new RoomError('Too many open polls');
    const poll: Poll = {
      id: randomUUID(),
      question: q,
      options: opts.map((text, i) => ({ id: randomUUID(), text, votes: [], mediaItemId: mediaItemIds[i] || undefined })),
      createdBy: memberId,
      createdAt: this.now(),
      closed: false,
    };
    this.polls = [...this.polls.slice(-19), poll];
    this.system(`${this.nameOf(memberId)} started a poll: ${q}`);
    this.emit.patch({ polls: this.polls });
    return poll;
  }

  /** One vote per member per poll; voting again for the same option removes it. */
  votePoll(memberId: string, pollId: string, optionId: string): void {
    const poll = this.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed) return;
    const option = poll.options.find((o) => o.id === optionId);
    if (!option) return;
    const had = option.votes.includes(memberId);
    for (const o of poll.options) o.votes = o.votes.filter((v) => v !== memberId);
    if (!had) option.votes.push(memberId);
    this.emit.patch({ polls: this.polls });
  }

  closePoll(memberId: string, pollId: string): void {
    const poll = this.polls.find((p) => p.id === pollId);
    if (!poll || poll.closed) return;
    if (poll.createdBy !== memberId && this.hostId !== memberId) throw new RoomError('Only the host or poll creator can close it');
    poll.closed = true;
    const winner = [...poll.options].sort((a, b) => b.votes.length - a.votes.length)[0];
    if (winner && winner.votes.length > 0) {
      this.system(`Poll "${poll.question}" → ${winner.text}`);
      // A winning playlist item jumps the queue.
      const item = winner.mediaItemId && this.playlist.find((i) => i.id === winner.mediaItemId);
      if (item) {
        item.votes = [...new Set([...item.votes, ...winner.votes])];
        this.playlist = [item, ...this.playlist.filter((i) => i !== item)];
        this.emit.patch({ playlist: this.playlist });
      }
    }
    this.emit.patch({ polls: this.polls });
  }

  private nameOf(memberId: string): string {
    return this.members.get(memberId)?.name ?? 'Someone';
  }
}

function cleanSource(source: MediaSource | undefined): MediaSource {
  const kind = source?.kind;
  const url = String(source?.url ?? '').slice(0, 2000);
  if ((kind !== 'youtube' && kind !== 'html5' && kind !== 'external') || !url) throw new RoomError('Invalid media source');
  if (kind !== 'external') return { kind, url };
  const provider = source?.provider;
  if (!provider || !(provider in STREAMING_PROVIDERS)) throw new RoomError('Unsupported streaming service');
  if (!/^https?:\/\//i.test(url)) throw new RoomError('Invalid media source');
  return { kind, url, provider };
}

function cleanName(name: string): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, LIMITS.maxNameLength) || 'Guest';
}

function clampNum(n: unknown, min: number, max: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0;
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
