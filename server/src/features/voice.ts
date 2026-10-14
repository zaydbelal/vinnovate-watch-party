import type { Feature } from '../types';
import { onMember } from './helpers';

/**
 * Voice chat. Audio flows peer-to-peer over WebRTC; the server only tracks
 * who is in the channel and relays offers/answers/ICE candidates between them.
 */
export const voiceFeature: Feature = {
  name: 'voice',
  register(socket, ctx) {
    onMember(socket, ctx, 'voice:join', ({ room, member }) => room.joinVoice(member.id));
    onMember(socket, ctx, 'voice:leave', ({ room, member }) => room.leaveVoice(member.id));
    onMember(socket, ctx, 'voice:signal', ({ room, member }, { to, signal }) => {
      // Only relay between two people who are both in this room's voice channel.
      if (!room.voice.includes(member.id) || !room.voice.includes(to)) return;
      const target = room.members.get(to);
      if (!target?.socketId || !signal || typeof signal !== 'object') return;
      if (JSON.stringify(signal).length > 20_000) return;
      ctx.io.to(target.socketId).emit('voice:signal', { from: member.id, signal });
    });
  },
};
