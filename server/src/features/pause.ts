import type { Feature } from '../types';
import { onMember } from './helpers';

/** Pause requests: in vote mode the room pauses once half the active viewers agree. */
export const pauseFeature: Feature = {
  name: 'pause',
  register(socket, ctx) {
    onMember(socket, ctx, 'pause:request', ({ room, member }) => room.requestPause(member.id), { rateLimited: true });
    onMember(socket, ctx, 'pause:vote', ({ room, member }, { requestId, agree }) => room.votePause(member.id, requestId, !!agree));
  },
};
