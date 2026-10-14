import type { Feature } from '../types';
import { onMember } from './helpers';

/** Pre-show lobby with countdown, and the trailer vote that runs inside it. */
export const lobbyFeature: Feature = {
  name: 'lobby',
  register(socket, ctx) {
    onMember(socket, ctx, 'songs:add', ({ room, member }, song) => room.addSong(member.id, song), { rateLimited: true });
    onMember(socket, ctx, 'songs:remove', ({ room, member }, { songId }) => room.removeSong(member.id, songId));
    onMember(socket, ctx, 'songs:skip', ({ room, member }) => room.skipSong(member.id));
    onMember(socket, ctx, 'songs:ended', ({ room }, { songId }) => room.songEnded(String(songId)));
    onMember(socket, ctx, 'songs:clear', ({ room, member }) => room.clearSongs(member.id));
    onMember(socket, ctx, 'lobby:set', ({ room, member }, { active, countdownSec }) => room.setLobby(member.id, !!active, countdownSec));
    onMember(socket, ctx, 'trailers:start', ({ room, member }, { options }) => room.startTrailerVote(member.id, options), { rateLimited: true });
    onMember(socket, ctx, 'trailers:vote', ({ room, member }, { optionId }) => room.voteTrailer(member.id, optionId));
    onMember(socket, ctx, 'trailers:close', ({ room, member }) => room.closeTrailerVote(member.id));
    onMember(socket, ctx, 'trailers:cancel', ({ room, member }) => room.cancelTrailerVote(member.id));
  },
};
