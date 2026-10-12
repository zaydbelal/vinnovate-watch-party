import type { Feature } from '../types';
import { onMember } from './helpers';

export const pollsFeature: Feature = {
  name: 'polls',
  register(socket, ctx) {
    onMember(socket, ctx, 'poll:create', ({ room, member }, { question, options, mediaItemIds }) => room.createPoll(member.id, question, options, mediaItemIds), {
      rateLimited: true,
    });
    onMember(socket, ctx, 'poll:vote', ({ room, member }, { pollId, optionId }) => room.votePoll(member.id, pollId, optionId));
    onMember(socket, ctx, 'poll:close', ({ room, member }, { pollId }) => room.closePoll(member.id, pollId));
  },
};
