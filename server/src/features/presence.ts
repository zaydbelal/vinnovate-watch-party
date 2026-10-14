import type { Feature } from '../types';
import { onMember } from './helpers';

/** AFK status and buffering reports (auto-buffer catching). */
export const presenceFeature: Feature = {
  name: 'presence',
  register(socket, ctx) {
    onMember(socket, ctx, 'presence:afk', ({ room, member }, { afk }) => room.setAfk(member.id, !!afk), { rateLimited: true });
    onMember(socket, ctx, 'buffer:state', ({ room, member }, { mediaId, buffering }) => room.setBuffering(member.id, String(mediaId), !!buffering));
  },
};
