import type { Feature } from '../types';
import { onMember } from './helpers';

export const playlistFeature: Feature = {
  name: 'playlist',
  register(socket, ctx) {
    onMember(socket, ctx, 'playlist:add', ({ room, member }, { media }) => room.addToPlaylist(member.id, media), { rateLimited: true });
    onMember(socket, ctx, 'playlist:remove', ({ room, member }, { itemId }) => room.removeFromPlaylist(member.id, itemId));
    onMember(socket, ctx, 'playlist:vote', ({ room, member }, { itemId }) => room.toggleVote(member.id, itemId));
    onMember(socket, ctx, 'playlist:play', ({ room, member }, { itemId }) => room.playFromPlaylist(member.id, itemId));
  },
};
