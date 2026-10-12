import type { MediaKind } from '@watch-party/shared';
import { Html5Player } from './html5';
import type { PlayerAdapter } from './types';
import { YouTubePlayer } from './youtube';

/** Media kind -> player implementation. Add new providers here. */
export const playerFactories: Record<MediaKind, (container: HTMLElement) => PlayerAdapter> = {
  html5: (c) => new Html5Player(c),
  youtube: (c) => new YouTubePlayer(c),
};

export type { PlayerAdapter } from './types';
export { AutoplayBlockedError } from './types';
