/**
 * The wire protocol between client and server.
 *
 * This file is the single source of truth: both sides import these types, so
 * renaming an event or changing a payload is a compile error everywhere it
 * matters. To add a feature, add its state to `RoomSnapshot` (if it is
 * persistent) and its events to the two event maps below.
 */

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export type MediaKind = 'youtube' | 'html5' | 'external';

/**
 * DRM streaming services that cannot be embedded. Rooms follow them in
 * "companion mode": everyone plays the title in their own account and the
 * room keeps the shared clock (see client/src/players/external.ts).
 */
export type StreamingProvider = 'netflix' | 'prime' | 'hotstar' | 'zee5';

export interface MediaSource {
  kind: MediaKind;
  /** YouTube video id for `youtube`, a direct file URL for `html5`, the title page for `external`. */
  url: string;
  /** Set for `external` sources. */
  provider?: StreamingProvider;
}

export interface MediaItem {
  id: string;
  title: string;
  source: MediaSource;
  thumbnail?: string;
  durationSec?: number;
  /** Set when the item came from the movie catalog (used for recommendations). */
  catalogId?: string;
  addedBy: string;
  /** Member ids that up-voted this item. Highest votes plays next. */
  votes: string[];
}

export interface PlaybackState {
  media: MediaItem | null;
  playing: boolean;
  /** Position in seconds at the moment `updatedAt` (server clock, ms). */
  position: number;
  rate: number;
  updatedAt: number;
  /** Monotonic counter. Clients ignore states older than the one they have. */
  version: number;
  /** Who paused (or asked for the pause); they may resume without playback control. */
  pausedBy?: string | null;
}

export interface MemberStats {
  rttMs: number;
  driftMs: number;
  /** Last measured control propagation latency (command issued -> received). */
  lastControlLatencyMs?: number;
}

export interface Member {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  joinedAt: number;
  stats?: MemberStats;
  /** Stepped away (manually, or their tab has been hidden for a while). */
  afk: boolean;
  /** Their player is stalled waiting for data. */
  buffering: boolean;
}

export interface ChatMessage {
  id: string;
  memberId: string | null;
  name: string;
  text: string;
  ts: number;
  /** System messages ("Alice joined") are rendered differently. */
  system?: boolean;
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[];
  /** If the option refers to a playlist item, the winner can be queued. */
  mediaItemId?: string;
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  createdBy: string;
  createdAt: number;
  closed: boolean;
}

export type ControlMode = 'host' | 'everyone';

/**
 * Who may pause. `anyone`: every viewer can pause instantly.
 * `vote`: viewers who can't control playback ask, and the room pauses once
 * half of the active (present, not AFK) viewers agree.
 */
export type PausePolicy = 'anyone' | 'vote';

export interface RoomSettings {
  /** Who may play / seek / change speed / change the video. */
  controlMode: ControlMode;
  pausePolicy: PausePolicy;
  /** Pause the room while someone's player is buffering, resume when they catch up. */
  waitForBuffering: boolean;
  /** Who may share their screen. */
  screenShare: 'anyone' | 'host';
}

/** A song the host picked for the lobby, looped in sync for everyone. */
export interface LobbyTrack {
  title: string;
  /** `youtube` (played audio-only) or `html5` (a direct audio/video file). */
  source: MediaSource;
  /** Server-clock ms the loop started; position = elapsed % duration. */
  startedAt: number;
}

export interface ScreenShare {
  memberId: string;
  startedAt: number;
}

export interface PauseRequest {
  id: string;
  requestedBy: string;
  /** Member ids that agreed (the requester counts). */
  votes: string[];
  /** Votes needed right now: half of the active viewers, rounded up. */
  needed: number;
  expiresAt: number;
}

/** A shared moment: a 15–90 s range of a video anyone in the room can rewatch. */
export interface Clip {
  id: string;
  mediaId: string;
  mediaTitle: string;
  source: MediaSource;
  start: number;
  end: number;
  createdBy: string;
  createdAt: number;
}

export interface TrailerOption {
  id: string;
  title: string;
  source: MediaSource;
  thumbnail?: string;
  durationSec?: number;
  catalogId?: string;
  votes: string[];
}

/** Host-picked shortlist the room votes on before the show starts. */
export interface TrailerVote {
  id: string;
  options: TrailerOption[];
  open: boolean;
  winnerId: string | null;
}

/** The pre-show (or intermission) screen. */
export interface Lobby {
  active: boolean;
  /** Server-clock ms when the show starts; null means waiting for the host. */
  startsAt: number | null;
}

/** Set while the room is paused waiting for someone's player to buffer. */
export interface BufferHold {
  memberIds: string[];
  since: number;
}

/** Everything a client needs to render a room. Sent on join and reconnect. */
export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  members: Member[];
  playback: PlaybackState;
  playlist: MediaItem[];
  chat: ChatMessage[];
  polls: Poll[];
  settings: RoomSettings;
  /** Catalog ids watched in this room, newest last. Drives recommendations. */
  history: string[];
  pauseRequest: PauseRequest | null;
  clips: Clip[];
  trailerVote: TrailerVote | null;
  lobby: Lobby;
  bufferHold: BufferHold | null;
  /** Member ids currently in the voice channel. */
  voice: string[];
  /** Host-picked lobby song; null plays the generated lo-fi. */
  lobbyTrack: LobbyTrack | null;
  screenShare: ScreenShare | null;
}

/** Keys of `RoomSnapshot` that can be pushed as partial updates. */
export type RoomPatch = Partial<Omit<RoomSnapshot, 'code'>>;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type PlaybackAction = 'play' | 'pause' | 'seek' | 'load' | 'rate';

/** Why the server changed playback on its own. */
export type AutoAction = 'auto' | 'buffer' | 'vote' | 'lobby' | 'screen';

export interface PlaybackCommand {
  action: PlaybackAction;
  /** Target position (seconds) for seek; current position for play/pause. */
  position?: number;
  /** For `load`. */
  media?: NewMedia;
  /** For `rate`: one of PLAYBACK_RATES. */
  rate?: number;
  /** The playback version the client was looking at when it issued this. */
  baseVersion: number;
  /** Issue time expressed in *server* clock (client clock + offset), ms. */
  issuedAt: number;
}

export interface PlaybackBroadcast {
  state: PlaybackState;
  origin: {
    memberId: string | null;
    action: PlaybackAction | AutoAction;
    /** Server-clock time the command was issued by the client. */
    issuedAt: number;
  };
}

export interface JoinRequest {
  code: string;
  name: string;
  /** Present when reconnecting so the server can restore identity/host role. */
  sessionId?: string;
}

export type JoinResponse =
  | { ok: true; sessionId: string; memberId: string; snapshot: RoomSnapshot; serverTime: number }
  | { ok: false; error: string };

export type Ack = (res: { ok: boolean; error?: string }) => void;

/** What a client sends to add media; the server fills in id, addedBy and votes. */
export type NewMedia = Omit<MediaItem, 'id' | 'addedBy' | 'votes'>;

/** WebRTC signalling relayed between two voice participants. */
export type VoiceSignal =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'ice'; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

/** Screen-share signalling: viewers send `want` to ask the sharer for a stream. */
export type ScreenSignal = VoiceSignal | { type: 'want' };

export interface Reaction {
  id: string;
  memberId: string;
  emoji: string;
  /** Video position (seconds) the reaction refers to. */
  position: number;
}

// ---------------------------------------------------------------------------
// Event maps (used as socket.io generics on both sides)
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'room:join': (req: JoinRequest, ack: (res: JoinResponse) => void) => void;
  'room:leave': () => void;

  'clock:ping': (clientTime: number, ack: (serverTime: number) => void) => void;

  'playback:command': (cmd: PlaybackCommand, ack?: Ack) => void;
  'playback:ended': (payload: { mediaId: string }) => void;
  'playback:report': (stats: MemberStats) => void;

  'chat:send': (payload: { text: string }, ack?: Ack) => void;
  'reaction:send': (payload: { emoji: string; position: number }) => void;

  'playlist:add': (payload: { media: NewMedia }, ack?: Ack) => void;
  'playlist:remove': (payload: { itemId: string }, ack?: Ack) => void;
  'playlist:vote': (payload: { itemId: string }) => void;
  'playlist:play': (payload: { itemId: string }, ack?: Ack) => void;

  'poll:create': (payload: { question: string; options: string[]; mediaItemIds?: (string | undefined)[] }, ack?: Ack) => void;
  'poll:vote': (payload: { pollId: string; optionId: string }) => void;
  'poll:close': (payload: { pollId: string }) => void;

  'host:transfer': (payload: { memberId: string }, ack?: Ack) => void;
  'settings:update': (payload: Partial<RoomSettings>, ack?: Ack) => void;

  'pause:request': (payload: Record<string, never>, ack?: Ack) => void;
  'pause:vote': (payload: { requestId: string; agree: boolean }, ack?: Ack) => void;

  'presence:afk': (payload: { afk: boolean }) => void;
  'buffer:state': (payload: { mediaId: string; buffering: boolean }) => void;

  'clip:create': (payload: { start: number; end: number }, ack?: Ack) => void;
  'clip:remove': (payload: { clipId: string }, ack?: Ack) => void;

  'trailers:start': (payload: { options: NewMedia[] }, ack?: Ack) => void;
  'trailers:vote': (payload: { optionId: string }) => void;
  'trailers:close': (payload: Record<string, never>, ack?: Ack) => void;
  'trailers:cancel': (payload: Record<string, never>, ack?: Ack) => void;

  /** Open the lobby (optionally with a countdown in seconds) or close it to start the show. */
  'lobby:set': (payload: { active: boolean; countdownSec?: number | null }, ack?: Ack) => void;

  'voice:join': (payload: Record<string, never>, ack?: Ack) => void;
  'voice:leave': (payload: Record<string, never>) => void;
  'voice:signal': (payload: { to: string; signal: VoiceSignal }) => void;

  /** Host sets the lobby song (a YouTube or audio link), or null for the generated lo-fi. */
  'lobby:track': (payload: { track: { title: string; source: MediaSource } | null }, ack?: Ack) => void;

  'screen:start': (payload: Record<string, never>, ack?: Ack) => void;
  'screen:stop': (payload: Record<string, never>, ack?: Ack) => void;
  'screen:signal': (payload: { to: string; signal: ScreenSignal }) => void;
}

export interface ServerToClientEvents {
  /** Partial room state; clients shallow-merge it into their snapshot. */
  'room:patch': (patch: RoomPatch) => void;
  'playback:state': (payload: PlaybackBroadcast) => void;
  'chat:message': (msg: ChatMessage) => void;
  'reaction': (reaction: Reaction) => void;
  'notice': (payload: { level: 'info' | 'error'; text: string }) => void;
  'voice:signal': (payload: { from: string; signal: VoiceSignal }) => void;
  'screen:signal': (payload: { from: string; signal: ScreenSignal }) => void;
}
