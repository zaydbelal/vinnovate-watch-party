import type { Feature } from '../types';
import { RoomError } from '../rooms/Room';

/** Joining (first time, late, or reconnecting), leaving and disconnects. */
export const roomFeature: Feature = {
  name: 'room',
  register(socket, ctx) {
    socket.on('room:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      const room = ctx.rooms.get(req?.code);
      if (!room) return ack({ ok: false, error: 'Room not found. Check the code or create a new room.' });

      try {
        // Reconnect: same session id restores the same member (and host role).
        let member = req.sessionId ? room.findBySession(req.sessionId) : undefined;
        if (member) {
          if (member.socketId && member.socketId !== socket.id) {
            ctx.io.sockets.sockets.get(member.socketId)?.disconnect(true);
          }
          room.reconnect(member, socket.id, req.name);
          ctx.rooms.onReconnect(member);
        } else {
          member = room.addMember(req.name, socket.id, ctx.config.maxMembersPerRoom);
        }

        // A socket can only be in one room at a time.
        if (socket.data.roomCode && socket.data.roomCode !== room.code) socket.leave(socket.data.roomCode);
        socket.data.roomCode = room.code;
        socket.data.memberId = member.id;
        socket.join(room.code);
        ctx.rooms.touch(room);

        // The snapshot carries the full playback state, so late joiners and
        // reconnecting clients compute the live position immediately.
        ack({ ok: true, sessionId: member.sessionId, memberId: member.id, snapshot: room.snapshot(), serverTime: Date.now() });
      } catch (err) {
        ack({ ok: false, error: err instanceof RoomError ? err.message : 'Could not join room' });
      }
    });

    socket.on('room:leave', () => {
      const { room, member } = resolve();
      if (!room || !member) return;
      socket.leave(room.code);
      socket.data = {};
      ctx.rooms.onLeave(room, member);
    });

    socket.on('disconnect', () => {
      const { room, member } = resolve();
      // Ignore if this member has already reconnected on a newer socket.
      if (!room || !member || member.socketId !== socket.id) return;
      ctx.rooms.onDisconnect(room, member);
    });

    function resolve() {
      const room = socket.data.roomCode ? ctx.rooms.get(socket.data.roomCode) : undefined;
      const member = socket.data.memberId ? room?.members.get(socket.data.memberId) : undefined;
      return { room, member };
    }
  },
};
