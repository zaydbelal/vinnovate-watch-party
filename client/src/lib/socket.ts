import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@watch-party/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same origin by default (Vite proxies in dev); override with VITE_SERVER_URL. */
export function createSocket(): AppSocket {
  return io(import.meta.env.VITE_SERVER_URL ?? '/', {
    transports: ['websocket'], // skip long-polling: lower, steadier latency
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    autoConnect: false,
  });
}
