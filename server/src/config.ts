import { LIMITS, VOICE, type RTCIceServerLike } from '@watch-party/shared';

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
  /**
   * STUN/TURN servers handed to browsers for voice and screen share.
   * Across the internet some networks need a TURN relay. Set either
   * ICE_SERVERS (a JSON array of RTCIceServer objects) or TURN_URL plus
   * TURN_USERNAME / TURN_CREDENTIAL. Defaults to public STUN only.
   */
  iceServers: iceServersFromEnv(),
  /** Token bucket per socket for chatty events (chat, reactions). */
  rateLimit: { capacity: 10, refillPerSec: 4 },
};

export type ServerConfig = typeof config;

function iceServersFromEnv(): RTCIceServerLike[] {
  if (process.env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.ICE_SERVERS);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      console.warn('ICE_SERVERS is not valid JSON; using defaults');
    }
  }
  const servers: RTCIceServerLike[] = [...VOICE.iceServers];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}
