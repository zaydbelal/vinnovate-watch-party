import type { Feature } from '../types';
import { onMember } from './helpers';

/** Pre-show lobby with countdown, and the trailer vote that runs inside it. */
export const lobbyFeature: Feature = {
  name: 'lobby',
  register(socket, ctx) {
    onMember(socket, ctx, 'lobby:track', ({ room, member }, { track }) => room.setLobbyTrack(member.id, track));
    onMember(socket, ctx, 'lobby:set', ({ room, member }, { active, countdownSec }) => room.setLobby(member.id, !!active, countdownSec));
    onMember(socket, ctx, 'trailers:start', ({ room, member }, { options }) => room.startTrailerVote(member.id, options), { rateLimited: true });
    onMember(socket, ctx, 'trailers:vote', ({ room, member }, { optionId }) => room.voteTrailer(member.id, optionId));
    onMember(socket, ctx, 'trailers:close', ({ room, member }) => room.closeTrailerVote(member.id));
    onMember(socket, ctx, 'trailers:cancel', ({ room, member }) => room.cancelTrailerVote(member.id));
  },
};
