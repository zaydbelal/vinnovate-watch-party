import type { Feature } from '../types';
import { onMember } from './helpers';

/**
 * Screen share. Video flows peer-to-peer over WebRTC from the sharer to each
 * viewer; the server tracks who is sharing and relays signalling, only
 * between the sharer and someone else in the room.
 */
export const screenFeature: Feature = {
  name: 'screen',
  register(socket, ctx) {
    onMember(socket, ctx, 'screen:start', ({ room, member }) => room.startScreenShare(member.id));
    onMember(socket, ctx, 'screen:stop', ({ room, member }) => room.stopScreenShare(member.id));
    onMember(socket, ctx, 'screen:signal', ({ room, member }, { to, signal }) => {
      const sharer = room.screenShare?.memberId;
      if (!sharer || (member.id !== sharer && to !== sharer)) return;
      const target = room.members.get(to);
      if (!target?.socketId || !signal || typeof signal !== 'object') return;
      if (JSON.stringify(signal).length > 20_000) return;
      ctx.io.to(target.socketId).emit('screen:signal', { from: member.id, signal });
    });
  },
};
