import type { MediaSource } from './protocol';

/** A movie in the discovery catalog (server/src/catalog/movies.json). */
export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  /** Curated shelves such as "Open Movies" or "Short & Sweet". */
  categories: string[];
  rating: number;
  durationMin: number;
  description: string;
  director?: string;
  thumbnail?: string;
  source: MediaSource;
}

export interface RecommendationInput {
  /** Catalog ids the room watched (newest last). */
  history: string[];
  /** Catalog ids currently queued. */
  queued: string[];
}

/**
 * Score unseen movies by genre affinity with what the room watched/queued.
 * Recent items weigh more; rating breaks ties. Pure function, easy to tweak.
 */
export function recommend(movies: Movie[], input: RecommendationInput, limit = 8): Movie[] {
  const byId = new Map(movies.map((m) => [m.id, m]));
  const affinity = new Map<string, number>();
  const signals = [...input.history.map((id, i, all) => ({ id, w: 1 + i / all.length })), ...input.queued.map((id) => ({ id, w: 0.75 }))];
  for (const { id, w } of signals) {
    for (const g of byId.get(id)?.genres ?? []) affinity.set(g, (affinity.get(g) ?? 0) + w);
  }
  const exclude = new Set([...input.history, ...input.queued]);
  return movies
    .filter((m) => !exclude.has(m.id))
    .map((m) => ({
      m,
      score: m.genres.reduce((s, g) => s + (affinity.get(g) ?? 0), 0) + m.rating / 10,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}
