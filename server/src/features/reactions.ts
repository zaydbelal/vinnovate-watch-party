import type { Feature } from '../types';
import { onMember } from './helpers';

export const reactionsFeature: Feature = {
  name: 'reactions',
  register(socket, ctx) {
    onMember(socket, ctx, 'reaction:send', ({ room, member }, { emoji, position }) => room.react(member.id, emoji, position), {
      rateLimited: true,
    });
  },
};
