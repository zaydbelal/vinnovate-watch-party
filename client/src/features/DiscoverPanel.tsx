import { useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { recommend, type Movie } from '@watch-party/shared';
import { fetchCatalog } from '../lib/api';
import { useMe, useRoom, useSession } from '../lib/context';

type SortKey = 'relevance' | 'rating' | 'year' | 'title';
type SourceFilter = 'all' | 'youtube' | 'html5';
type LengthFilter = 'any' | 'short' | 'medium' | 'long';

const LENGTHS: Record<LengthFilter, { label: string; test: (min: number) => boolean }> = {
  any: { label: 'Any length', test: () => true },
  short: { label: '< 5 min', test: (m) => m < 5 },
  medium: { label: '5–15 min', test: (m) => m >= 5 && m <= 15 },
  long: { label: '> 15 min', test: (m) => m > 15 },
};

/** Fuzzy search weights: tweak to change what matters most when searching. */
const FUSE_OPTIONS = {
  threshold: 0.4,
  ignoreLocation: true,
  keys: [
    { name: 'title', weight: 3 },
    { name: 'director', weight: 1.5 },
    { name: 'genres', weight: 1.5 },
    { name: 'categories', weight: 1 },
    { name: 'description', weight: 0.5 },
  ],
};

export function DiscoverPanel() {
  const session = useSession();
  const history = useRoom((r) => r.history);
  const playlist = useRoom((r) => r.playlist);
  const { canControl } = useMe();
  const [movies, setMovies] = useState<Movie[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [genre, setGenre] = useState('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [length, setLength] = useState<LengthFilter>('any');
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<SortKey>('relevance');

  useEffect(() => {
    fetchCatalog().then(setMovies, (e) => setError(e.message));
  }, []);

  const fuse = useMemo(() => new Fuse(movies, FUSE_OPTIONS), [movies]);
  const categories = useMemo(() => [...new Set(movies.flatMap((m) => m.categories))].sort(), [movies]);
  const genres = useMemo(() => [...new Set(movies.flatMap((m) => m.genres))].sort(), [movies]);

  const results = useMemo(() => {
    let list = query.trim() ? fuse.search(query.trim()).map((r) => r.item) : movies;
    list = list.filter(
      (m) =>
        (!category || m.categories.includes(category)) &&
        (genre === 'all' || m.genres.includes(genre)) &&
        (source === 'all' || m.source.kind === source) &&
        LENGTHS[length].test(m.durationMin) &&
        m.rating >= minRating,
    );
    const sorters: Record<SortKey, ((a: Movie, b: Movie) => number) | null> = {
      relevance: null, // keep Fuse's ranking (or catalog order)
      rating: (a, b) => b.rating - a.rating,
      year: (a, b) => b.year - a.year,
      title: (a, b) => a.title.localeCompare(b.title),
    };
    const sorter = sorters[sort];
    return sorter ? [...list].sort(sorter) : list;
  }, [fuse, movies, query, category, genre, source, length, minRating, sort]);

  const queuedIds = useMemo(() => playlist.map((p) => p.catalogId).filter((x): x is string => !!x), [playlist]);
  const recommended = useMemo(() => recommend(movies, { history, queued: queuedIds }, 6), [movies, history, queuedIds]);
  const filtersActive = !!query.trim() || !!category || genre !== 'all' || source !== 'all' || length !== 'any' || minRating > 0;

  const toMedia = (m: Movie) => ({ title: m.title, source: m.source, thumbnail: m.thumbnail, durationSec: m.durationMin * 60, catalogId: m.id });
  const queue = (m: Movie) => void session.addToPlaylist(toMedia(m));
  const play = (m: Movie) => void session.load(toMedia(m));

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="discover">
      <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Fuzzy search: try “sintle” or “robots”…" />

      <div className="chips">
        <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setCategory(null)}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(category === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="filters">
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="all">All genres</option>
          {genres.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select value={length} onChange={(e) => setLength(e.target.value as LengthFilter)}>
          {Object.entries(LENGTHS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
          <option value="all">Any source</option>
          <option value="youtube">YouTube</option>
          <option value="html5">Video file</option>
        </select>
        <select value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
          <option value={0}>Any rating</option>
          <option value={6}>★ 6+</option>
          <option value={7}>★ 7+</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="relevance">Sort: relevance</option>
          <option value="rating">Sort: rating</option>
          <option value="year">Sort: newest</option>
          <option value="title">Sort: A–Z</option>
        </select>
      </div>

      {!filtersActive && recommended.length > 0 && (
        <>
          <h4>{history.length || queuedIds.length ? 'Recommended for this room' : 'Popular picks'}</h4>
          <div className="movie-grid">
            {recommended.map((m) => (
              <MovieCard key={m.id} movie={m} canPlay={canControl} onPlay={play} onQueue={queue} />
            ))}
          </div>
          <h4>All titles</h4>
        </>
      )}

      {results.length === 0 ? (
        <p className="muted empty">No matches. Try loosening the filters.</p>
      ) : (
        <div className="movie-grid">
          {results.map((m) => (
            <MovieCard key={m.id} movie={m} canPlay={canControl} onPlay={play} onQueue={queue} />
          ))}
        </div>
      )}
    </div>
  );
}

function MovieCard({ movie, canPlay, onPlay, onQueue }: { movie: Movie; canPlay: boolean; onPlay: (m: Movie) => void; onQueue: (m: Movie) => void }) {
  return (
    <div className="movie-card" title={movie.description}>
      <div className="movie-thumb">
        {movie.thumbnail ? <img src={movie.thumbnail} alt="" loading="lazy" /> : <span>🎬</span>}
        <span className="movie-badge">{movie.source.kind === 'youtube' ? 'YouTube' : 'File'}</span>
      </div>
      <div className="movie-title ellipsis">{movie.title}</div>
      <div className="muted small">
        {movie.year} · {movie.durationMin} min · ★ {movie.rating}
      </div>
      <div className="muted small ellipsis">{movie.genres.join(', ')}</div>
      <div className="row">
        {canPlay && (
          <button className="btn small primary" onClick={() => onPlay(movie)}>
            ▶ Play
          </button>
        )}
        <button className="btn small" onClick={() => onQueue(movie)}>
          + Queue
        </button>
      </div>
    </div>
  );
}
