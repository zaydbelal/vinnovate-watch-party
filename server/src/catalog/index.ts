import type { Movie } from '@watch-party/shared';
import movies from './movies.json' with { type: 'json' };

/**
 * The discovery catalog. Edit movies.json to add titles; the client fetches it
 * from /api/catalog and does fuzzy search, filters and recommendations itself.
 */
export const catalog: Movie[] = movies as Movie[];
