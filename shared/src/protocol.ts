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

export type MediaKind = 'youtube' | 'html5';

export interface MediaSource {
  kind: MediaKind;
  /** YouTube video id for `youtube`, a direct file URL for `html5`. */
  url: string;
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

export interface RoomSettings {
  /** Who may play / pause / seek / change the video. */
  controlMode: ControlMode;
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
}

/** Keys of `RoomSnapshot` that can be pushed as partial updates. */
export type RoomPatch = Partial<Omit<RoomSnapshot, 'code'>>;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export type PlaybackAction = 'play' | 'pause' | 'seek' | 'load';

export interface PlaybackCommand {
  action: PlaybackAction;
  /** Target position (seconds) for seek; current position for play/pause. */
  position?: number;
  /** For `load`. */
  media?: Omit<MediaItem, 'id' | 'addedBy' | 'votes'>;
  /** The playback version the client was looking at when it issued this. */
  baseVersion: number;
  /** Issue time expressed in *server* clock (client clock + offset), ms. */
  issuedAt: number;
}

export interface PlaybackBroadcast {
  state: PlaybackState;
  origin: {
    memberId: string | null;
    action: PlaybackAction | 'auto';
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

  'playlist:add': (payload: { media: Omit<MediaItem, 'id' | 'addedBy' | 'votes'> }, ack?: Ack) => void;
  'playlist:remove': (payload: { itemId: string }, ack?: Ack) => void;
  'playlist:vote': (payload: { itemId: string }) => void;
  'playlist:play': (payload: { itemId: string }, ack?: Ack) => void;

  'poll:create': (payload: { question: string; options: string[]; mediaItemIds?: (string | undefined)[] }, ack?: Ack) => void;
  'poll:vote': (payload: { pollId: string; optionId: string }) => void;
  'poll:close': (payload: { pollId: string }) => void;

  'host:transfer': (payload: { memberId: string }, ack?: Ack) => void;
  'settings:update': (payload: Partial<RoomSettings>, ack?: Ack) => void;
}

export interface ServerToClientEvents {
  /** Partial room state; clients shallow-merge it into their snapshot. */
  'room:patch': (patch: RoomPatch) => void;
  'playback:state': (payload: PlaybackBroadcast) => void;
  'chat:message': (msg: ChatMessage) => void;
  'reaction': (reaction: Reaction) => void;
  'notice': (payload: { level: 'info' | 'error'; text: string }) => void;
}
