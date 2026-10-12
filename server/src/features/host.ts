import type { Feature } from '../types';
import { onMember } from './helpers';

/** Host transfer and room settings (who can control playback). */
export const hostFeature: Feature = {
  name: 'host',
  register(socket, ctx) {
    onMember(socket, ctx, 'host:transfer', ({ room, member }, { memberId }) => room.transferHost(member.id, memberId));
    onMember(socket, ctx, 'settings:update', ({ room, member }, patch) => room.updateSettings(member.id, patch));
  },
};
