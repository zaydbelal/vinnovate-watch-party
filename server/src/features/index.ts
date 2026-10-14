import type { Feature } from '../types';
import { chatFeature } from './chat';
import { clipsFeature } from './clips';
import { clockFeature } from './clock';
import { hostFeature } from './host';
import { lobbyFeature } from './lobby';
import { pauseFeature } from './pause';
import { playbackFeature } from './playback';
import { playlistFeature } from './playlist';
import { pollsFeature } from './polls';
import { presenceFeature } from './presence';
import { reactionsFeature } from './reactions';
import { roomFeature } from './room';
import { voiceFeature } from './voice';

/**
 * Every socket feature the server runs. To add one, create a file in this
 * folder exporting a `Feature` and append it here.
 */
export const features: Feature[] = [
  roomFeature,
  clockFeature,
  playbackFeature,
  chatFeature,
  reactionsFeature,
  playlistFeature,
  pollsFeature,
  hostFeature,
  pauseFeature,
  presenceFeature,
  clipsFeature,
  lobbyFeature,
  voiceFeature,
];
