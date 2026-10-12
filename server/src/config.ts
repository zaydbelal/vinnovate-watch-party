import { LIMITS } from '@watch-party/shared';

/** Server settings. Override with environment variables. */
export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** Comma-separated list, or "*" (default) for dev convenience. */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** How long a disconnected member keeps their seat (and host role). */
  reconnectGraceMs: Number(process.env.RECONNECT_GRACE_MS ?? 30_000),
  /** Empty rooms are deleted after this long. */
  emptyRoomTtlMs: Number(process.env.EMPTY_ROOM_TTL_MS ?? 10 * 60_000),
  maxMembersPerRoom: Number(process.env.MAX_MEMBERS ?? LIMITS.maxMembersPerRoom),
  /** Token bucket per socket for chatty events (chat, reactions). */
  rateLimit: { capacity: 10, refillPerSec: 4 },
};

export type ServerConfig = typeof config;
