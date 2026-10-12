import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@watch-party/shared';
import type { ServerConfig } from './config';
import type { RoomManager } from './rooms/RoomManager';
import type { MemberRecord, Room } from './rooms/Room';

/** Per-socket data, set by the room feature once the socket has joined. */
export interface SocketData {
  roomCode?: string;
  memberId?: string;
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface FeatureContext {
  io: AppServer;
  rooms: RoomManager;
  config: ServerConfig;
}

/**
 * A feature registers its socket handlers for every new connection.
 * See features/index.ts for the list and docs/EXTENDING.md for a walkthrough.
 */
export interface Feature {
  name: string;
  register(socket: AppSocket, ctx: FeatureContext): void;
}

export interface MemberContext {
  room: Room;
  member: MemberRecord;
  socket: AppSocket;
}
