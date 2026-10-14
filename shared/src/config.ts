/**
 * Tunables shared by client and server. Change behaviour here rather than
 * hunting for magic numbers in the code.
 */
export const SYNC = {
  /** How often each client checks its drift against the server timeline. */
  driftCheckIntervalMs: 250,
  /** Rate correction starts when |drift| exceeds this (about one frame at 24 fps)... */
  driftToleranceMs: 42,
  /** ...and keeps going until |drift| falls below this (hysteresis avoids flapping). */
  driftTargetMs: 12,
  /**
   * While paused, players further apart than this are re-aligned with a seek.
   * Half a frame at 30 fps, so every paused screen shows the same frame.
   */
  pausedToleranceMs: 16,
  /** Drift readings are median-filtered over this many samples to ignore jitter. */
  driftSmoothingSamples: 3,
  /** Max lead added to hard seeks while playing (learned from how long seeks take). */
  maxSeekLeadMs: 600,
  /** Above this, the client hard-seeks instead of nudging playback rate. */
  hardSeekThresholdMs: 1000,
  /** Players without fine rate control (YouTube) seek once drift exceeds this. */
  coarseSeekThresholdMs: 350,
  /** Max deviation from 1x used for soft correction (0.08 => 0.92x-1.08x). */
  maxRateAdjust: 0.08,
  /** Drift is closed over roughly this many seconds when rate-correcting. */
  rateCorrectionWindowSec: 2,
  /** After a seek, ignore drift for this long while the player buffers. */
  seekSettleMs: 800,
  /** How often clients report their sync stats (drift / rtt) to the server. */
  reportIntervalMs: 2000,
  /** Clock sync: samples taken on connect and the periodic resync interval. */
  clockInitialSamples: 8,
  clockResyncIntervalMs: 10000,
} as const;

/** Speeds offered in the speed menu (YouTube supports exactly these). */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** Auto-buffer catching: pause the room while someone stalls. */
export const BUFFERING = {
  /** A stall must last this long before it is reported (ignores blips). */
  reportAfterMs: 1000,
  /** Resume without the stalled viewer after this long; they catch up by seeking. */
  maxHoldMs: 12_000,
  /** After a hold ends, the same viewer can't trigger another for this long. */
  cooldownMs: 10_000,
} as const;

export const PAUSE_VOTE = {
  /** A pause request lapses if not enough people agree within this time. */
  ttlMs: 30_000,
  /** Share of active viewers that must agree (0.5 = half, rounded up). */
  share: 0.5,
} as const;

export const PRESENCE = {
  /** A viewer whose tab stays hidden this long is marked AFK automatically. */
  hiddenAfkMs: 30_000,
} as const;

export const CLIPS = {
  /** Clip lengths offered (seconds). Anything between min and max is accepted. */
  lengths: [15, 30, 60, 90],
  defaultLength: 30,
  minSec: 15,
  maxSec: 90,
  maxPerRoom: 30,
} as const;

export const LOBBY = {
  /** Countdown presets shown to the host (seconds). */
  countdownPresets: [60, 180, 300, 600],
  maxCountdownSec: 3600,
  /** New rooms open on the lobby screen. */
  openOnCreate: true,
} as const;

/** Lo-fi lobby music. Generated live with Web Audio, so no audio files to ship. */
export const LOFI = {
  bpm: 74,
  volume: 0.22,
  /** Vinyl crackle level, 0 (off) to 1. Sparse soft pops only, no hiss. */
  crackle: 0,
  /** Hi-hat level, 0 (off) to 1. */
  hats: 0.5,
  /** Chords as semitones above C3 (Fmaj7, Em7, Dm7, Cmaj7). */
  progression: [
    [5, 9, 12, 16],
    [4, 7, 11, 14],
    [2, 5, 9, 12],
    [0, 4, 7, 11],
  ],
} as const;

/** Lobby song queue (pasted links), played in sync. */
export const LOBBY_TRACK = {
  /** Most songs waiting in the queue at once. */
  maxQueue: 50,
  volume: 0.6,
  /** Re-align a listener whose song drifts further than this from the room. */
  driftToleranceMs: 300,
  checkIntervalMs: 2000,
} as const;

export const SCREEN_SHARE = {
  /** Capture constraints: higher means sharper but heavier on the sharer's upload. */
  maxHeight: 720,
  frameRate: 30,
  /** Bitrate cap per viewer (bits/s). Each viewer gets their own stream from the sharer. */
  maxBitrate: 2_500_000,
  /** Ask for tab/system audio (Chrome/Edge; whole-screen audio is Windows-only). */
  audio: true,
  /** Default for new rooms: 'anyone' or 'host'. */
  defaultWho: 'anyone' as 'anyone' | 'host',
} as const;

/** Personal subtitles (each viewer loads their own .srt/.vtt; never shared). */
export const SUBTITLES = {
  /** Text sizes offered, as a fraction of the video's height. */
  sizes: { S: 0.035, M: 0.05, L: 0.07 } as Record<'S' | 'M' | 'L', number>,
  defaultSize: 'M' as 'S' | 'M' | 'L',
  /** Each timing nudge moves subtitles by this many seconds. */
  offsetStepSec: 0.5,
  /** Larger files are refused (a feature film's .srt is ~100 KB). */
  maxFileBytes: 2_000_000,
} as const;

export const TRAILERS = {
  minOptions: 2,
  maxOptions: 3,
  /** Seconds of each option shown in the preview. */
  previewSec: 60,
} as const;

export const VOICE = {
  /** STUN/TURN servers for voice chat. LAN calls work without any; add TURN for strict NATs. */
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] as RTCIceServerLike[],
  /** Mesh voice: each participant connects to every other, so keep this modest. */
  maxParticipants: 12,
  /** Level (0-1) above which a participant is shown as speaking. */
  speakingThreshold: 0.04,
} as const;

/** Structural copy of RTCIceServer so this file needs no DOM types. */
export interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const LIMITS = {
  maxMembersPerRoom: 50,
  maxNameLength: 32,
  maxChatLength: 500,
  chatHistory: 200,
  maxPlaylistItems: 100,
  maxPollOptions: 6,
  maxOpenPolls: 5,
  roomCodeLength: 6,
  /** Server tick for countdowns, pause-request expiry and buffer holds. */
  roomTickMs: 250,
} as const;

export const REACTION_EMOJIS = ['😂', '😮', '😍', '🔥', '👏', '😢', '😱', '💀'] as const;
