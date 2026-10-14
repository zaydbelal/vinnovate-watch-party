import { useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { recommend, type Movie } from '@watch-party/shared';
import { fetchCatalog } from '../lib/api';
import { useMe, useRoom, useSession } from '../lib/context';
import { movieToMedia } from '../lib/media';

type SortKey = 'relevance' | 'rating' | 'year' | 'title';
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
        (genre === 'all' || m.genres.includes(genre)),
    );
    const sorters: Record<SortKey, ((a: Movie, b: Movie) => number) | null> = {
      relevance: null, // keep Fuse's ranking (or catalog order)
      rating: (a, b) => b.rating - a.rating,
      year: (a, b) => b.year - a.year,
      title: (a, b) => a.title.localeCompare(b.title),
    };
    const sorter = sorters[sort];
    return sorter ? [...list].sort(sorter) : list;
  }, [fuse, movies, query, category, genre, sort]);

  const queuedIds = useMemo(() => playlist.map((p) => p.catalogId).filter((x): x is string => !!x), [playlist]);
  const recommended = useMemo(() => recommend(movies, { history, queued: queuedIds }, 6), [movies, history, queuedIds]);
  const filtersActive = !!query.trim() || !!category || genre !== 'all';

  const queue = (m: Movie) => void session.addToPlaylist(movieToMedia(m));
  const play = (m: Movie) => void session.load(movieToMedia(m));

  if (error) return <p className="error">{error}</p>;

  return (
    <div className="discover">
      <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, genres, directors" aria-label="Search the catalog" />

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
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="relevance">Sort: relevance</option>
          <option value="rating">Sort: rating</option>
          <option value="year">Sort: newest</option>
          <option value="title">Sort: A–Z</option>
        </select>
      </div>

      {!filtersActive && (history.length > 0 || queuedIds.length > 0) && recommended.length > 0 && (
        <>
          <h4>Recommended for this room</h4>
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
  const [thumbFailed, setThumbFailed] = useState(false);
  return (
    <div className="movie-card" title={movie.description}>
      <div className="movie-thumb">
        {movie.thumbnail && !thumbFailed ? <img src={movie.thumbnail} alt="" loading="lazy" onError={() => setThumbFailed(true)} /> : <span>{movie.title[0]}</span>}
      </div>
      <div className="movie-title ellipsis">{movie.title}</div>
      <div className="muted small">
        {movie.year} · {movie.durationMin} min · ★ {movie.rating}
      </div>
      <div className="muted small ellipsis">{movie.genres.join(', ')}</div>
      <div className="row">
        {canPlay && (
          <button className="btn small primary" onClick={() => onPlay(movie)}>
            Play
          </button>
        )}
        <button className="btn small" onClick={() => onQueue(movie)}>
          Queue
        </button>
      </div>
    </div>
  );
}
