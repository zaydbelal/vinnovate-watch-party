import type { Feature } from '../types';
import { chatFeature } from './chat';
import { clockFeature } from './clock';
import { hostFeature } from './host';
import { playbackFeature } from './playback';
import { playlistFeature } from './playlist';
import { pollsFeature } from './polls';
import { reactionsFeature } from './reactions';
import { roomFeature } from './room';

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
];
