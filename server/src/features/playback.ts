import type { Feature } from '../types';
import { onMember } from './helpers';

/** Play / pause / seek / load, end-of-video, and sync stat reports. */
export const playbackFeature: Feature = {
  name: 'playback',
  register(socket, ctx) {
    onMember(socket, ctx, 'playback:command', ({ room, member }, cmd) => {
      room.applyCommand(member.id, cmd);
    });

    onMember(socket, ctx, 'playback:ended', ({ room }, { mediaId }) => {
      room.mediaEnded(mediaId);
    });

    onMember(socket, ctx, 'playback:report', ({ room, member }, stats) => {
      room.updateStats(member.id, stats);
    });
  },
};
