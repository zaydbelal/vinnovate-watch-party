import { randomUUID } from 'node:crypto';
import {
  LIMITS,
  REACTION_EMOJIS,
  expectedPosition,
  type ChatMessage,
  type MediaItem,
  type Member,
  type MemberStats,
  type PlaybackBroadcast,
  type PlaybackCommand,
  type PlaybackState,
  type Poll,
  type Reaction,
  type RoomPatch,
  type RoomSettings,
  type RoomSnapshot,
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

type NewMedia = Omit<MediaItem, 'id' | 'addedBy' | 'votes'>;

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
  settings: RoomSettings = { controlMode: 'host' };
  history: string[] = [];
  /** Recent control-propagation latencies reported by clients (ms), for /api/metrics. */
  readonly latencySamples: number[] = [];
  /** Set when member stats changed; RoomManager flushes them on an interval. */
  statsDirty = false;
  /** Playback version at which the current media was loaded (stale-command guard). */
  private mediaVersion = 0;
  private colorIndex = 0;

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
    };
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
    this.emit.patch({ members: this.publicMembers() });
  }

  /** Permanently remove a member (left, or reconnect grace expired). */
  removeMember(memberId: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    this.members.delete(memberId);
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
    if (patch.controlMode && patch.controlMode !== 'host' && patch.controlMode !== 'everyone') {
      throw new RoomError('Invalid control mode');
    }
    this.settings = { ...this.settings, ...pick(patch, ['controlMode']) };
    this.system(this.settings.controlMode === 'everyone' ? 'Everyone can now control playback' : 'Only the host can control playback');
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
    if (!this.canControl(memberId)) throw new RoomError('Only the host can control playback');
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
        next = { ...cur, playing: true, position: expectedPosition(cur, now) };
        break;
      case 'pause':
        if (!cur.playing) return false;
        next = { ...cur, playing: false, position: this.clampPosition(expectedPosition(cur, issuedAt)) };
        break;
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
    if (item.catalogId) {
      this.history = [...this.history.filter((id) => id !== item.catalogId), item.catalogId].slice(-50);
      this.emit.patch({ history: this.history });
    }
    this.system(`Now playing: ${item.title}`);
    this.commit({ media: item, playing: true, position: 0, rate: 1, updatedAt: now, version: 0 }, byId, byId ? 'load' : 'auto', issuedAt);
  }

  private commit(state: PlaybackState, memberId: string | null, action: PlaybackBroadcast['origin']['action'], issuedAt: number): void {
    this.playback = { ...state, version: this.playback.version + 1 };
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
    const kind = media?.source?.kind;
    const url = String(media?.source?.url ?? '').slice(0, 2000);
    if ((kind !== 'youtube' && kind !== 'html5') || !url) throw new RoomError('Invalid media source');
    return {
      id: randomUUID(),
      title: String(media.title || 'Untitled').slice(0, 200),
      source: { kind, url },
      thumbnail: media.thumbnail ? String(media.thumbnail).slice(0, 2000) : undefined,
      durationSec: Number.isFinite(media.durationSec) ? Number(media.durationSec) : undefined,
      catalogId: media.catalogId ? String(media.catalogId).slice(0, 100) : undefined,
      addedBy: memberId,
      votes: [],
    };
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
