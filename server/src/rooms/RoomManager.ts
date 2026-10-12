import { LIMITS, SYNC } from '@watch-party/shared';
import type { ServerConfig } from '../config';
import type { AppServer } from '../types';
import { Room, type MemberRecord } from './Room';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/**
 * Owns all rooms and the timers around them (reconnect grace, empty-room
 * cleanup). Rooms themselves stay timer-free and testable.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private readonly emptyTimers = new Map<string, NodeJS.Timeout>();

  private readonly statsTimer: NodeJS.Timeout;

  constructor(
    private readonly io: AppServer,
    private readonly config: ServerConfig,
  ) {
    // Sync-health stats are batched rather than broadcast on every report.
    this.statsTimer = setInterval(() => this.rooms.forEach((r) => r.flushStats()), SYNC.reportIntervalMs);
    this.statsTimer.unref();
  }

  get size(): number {
    return this.rooms.size;
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeCode(code));
  }

  create(): Room {
    let code: string;
    do code = randomCode(); while (this.rooms.has(code));
    const io = this.io;
    const room = new Room(code, {
      patch: (patch) => io.to(code).emit('room:patch', patch),
      playback: (payload) => io.to(code).emit('playback:state', payload),
      chat: (msg) => io.to(code).emit('chat:message', msg),
      reaction: (r) => io.to(code).emit('reaction', r),
    });
    this.rooms.set(code, room);
    this.scheduleEmptyCheck(room);
    return room;
  }

  /** Member's socket went away: keep their seat for the grace period. */
  onDisconnect(room: Room, member: MemberRecord): void {
    room.disconnect(member.id);
    this.clearGrace(member.id);
    this.graceTimers.set(
      member.id,
      setTimeout(() => {
        this.graceTimers.delete(member.id);
        if (!member.connected) {
          room.removeMember(member.id);
          this.scheduleEmptyCheck(room);
        }
      }, this.config.reconnectGraceMs),
    );
    // Host vanished: hand over immediately so the room isn't stuck,
    // but they can get it back by reconnecting while nobody else claimed it.
    if (room.hostId === member.id && room.connectedCount > 0) {
      room.electHost();
    }
    this.scheduleEmptyCheck(room);
  }

  onLeave(room: Room, member: MemberRecord): void {
    this.clearGrace(member.id);
    room.removeMember(member.id);
    this.scheduleEmptyCheck(room);
  }

  onReconnect(member: MemberRecord): void {
    this.clearGrace(member.id);
  }

  private clearGrace(memberId: string): void {
    const t = this.graceTimers.get(memberId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(memberId);
  }

  private scheduleEmptyCheck(room: Room): void {
    const existing = this.emptyTimers.get(room.code);
    if (existing) clearTimeout(existing);
    if (room.connectedCount > 0) {
      this.emptyTimers.delete(room.code);
      return;
    }
    this.emptyTimers.set(
      room.code,
      setTimeout(() => {
        this.emptyTimers.delete(room.code);
        if (room.connectedCount === 0) {
          for (const id of room.members.keys()) this.clearGrace(id);
          this.rooms.delete(room.code);
        }
      }, this.config.emptyRoomTtlMs),
    );
  }

  /** Call when someone joins so a pending deletion is cancelled. */
  touch(room: Room): void {
    this.scheduleEmptyCheck(room);
  }
}

function randomCode(): string {
  let s = '';
  for (let i = 0; i < LIMITS.roomCodeLength; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function normalizeCode(code: string): string {
  return String(code ?? '').trim().toUpperCase();
}
