import type { Feature } from '../types';
import { onMember } from './helpers';

export const chatFeature: Feature = {
  name: 'chat',
  register(socket, ctx) {
    onMember(socket, ctx, 'chat:send', ({ room, member }, { text }) => room.addChat(member.id, text), { rateLimited: true });
  },
};
