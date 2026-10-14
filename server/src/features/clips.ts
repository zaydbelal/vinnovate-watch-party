import type { Feature } from '../types';
import { onMember } from './helpers';

export const clipsFeature: Feature = {
  name: 'clips',
  register(socket, ctx) {
    onMember(socket, ctx, 'clip:create', ({ room, member }, { start, end }) => room.createClip(member.id, start, end), { rateLimited: true });
    onMember(socket, ctx, 'clip:remove', ({ room, member }, { clipId }) => room.removeClip(member.id, clipId));
  },
};
