import type { Ack, ClientToServerEvents } from '@watch-party/shared';
import { RoomError } from '../rooms/Room';
import type { AppSocket, FeatureContext, MemberContext } from '../types';

type Args<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>;

interface HandlerOptions {
  /** Consume a token from the socket's rate-limit bucket. */
  rateLimited?: boolean;
}

/**
 * Register a handler for an event that requires the socket to be in a room.
 * Resolves room + member, rate-limits, and turns thrown RoomErrors into an
 * `{ ok: false, error }` ack (or a notice when the client sent no ack).
 * The handler's return value is ignored; a successful run acks `{ ok: true }`.
 */
export function onMember<E extends keyof ClientToServerEvents>(
  socket: AppSocket,
  ctx: FeatureContext,
  event: E,
  handler: (mc: MemberContext, ...args: Args<E>) => void,
  options: HandlerOptions = {},
): void {
  const bucket = options.rateLimited ? tokenBucket(ctx.config.rateLimit.capacity, ctx.config.rateLimit.refillPerSec) : null;
  // socket.io's typings can't express a generic event name here; the public
  // signature above keeps call sites fully typed.
  (socket.on as (ev: string, fn: (...a: unknown[]) => void) => void)(event, (...args: unknown[]) => {
    const ack = typeof args[args.length - 1] === 'function' ? (args[args.length - 1] as Ack) : undefined;
    const fail = (error: string) => (ack ? ack({ ok: false, error }) : socket.emit('notice', { level: 'error', text: error }));
    const { roomCode, memberId } = socket.data;
    const room = roomCode ? ctx.rooms.get(roomCode) : undefined;
    const member = memberId ? room?.members.get(memberId) : undefined;
    if (!room || !member) return fail('You are not in a room');
    if (bucket && !bucket()) return fail('Slow down a little');
    try {
      handler({ room, member, socket }, ...(args as Args<E>));
      ack?.({ ok: true });
    } catch (err) {
      if (err instanceof RoomError) return fail(err.message);
      console.error(`[${event}]`, err);
      fail('Something went wrong');
    }
  });
}

/** Returns a function that consumes one token and reports whether one was available. */
export function tokenBucket(capacity: number, refillPerSec: number, now: () => number = Date.now): () => boolean {
  let tokens = capacity;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
