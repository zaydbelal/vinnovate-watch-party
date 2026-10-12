/**
 * Tunables shared by client and server. Change behaviour here rather than
 * hunting for magic numbers in the code.
 */
export const SYNC = {
  /** How often each client checks its drift against the server timeline. */
  driftCheckIntervalMs: 500,
  /** Rate correction starts when |drift| exceeds this... */
  driftToleranceMs: 100,
  /** ...and keeps going until |drift| falls below this (hysteresis avoids flapping). */
  driftTargetMs: 25,
  /** While paused, frames further apart than this are re-aligned with a seek. */
  pausedToleranceMs: 40,
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
  clockInitialSamples: 6,
  clockResyncIntervalMs: 15000,
} as const;

export const LIMITS = {
  maxMembersPerRoom: 50,
  maxNameLength: 32,
  maxChatLength: 500,
  chatHistory: 200,
  maxPlaylistItems: 100,
  maxPollOptions: 6,
  maxOpenPolls: 5,
  roomCodeLength: 6,
} as const;

export const REACTION_EMOJIS = ['😂', '😮', '😍', '🔥', '👏', '😢', '😱', '💀'] as const;
