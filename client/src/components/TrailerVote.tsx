import { useEffect, useState } from 'react';
import { TRAILERS, type Movie, type NewMedia } from '@watch-party/shared';
import { fetchCatalog } from '../lib/api';
import { useMe, useRoom, useSession } from '../lib/context';
import { mediaFromInput } from '../lib/media';
import { RangePreview } from './RangePreview';

/**
 * Host drops up to three trailers; the room votes right here before the show.
 * Previews play locally so people can sample them without touching the room.
 */
export function TrailerVote({ onPreviewing }: { onPreviewing?: (previewing: boolean) => void }) {
  const session = useSession();
  const vote = useRoom((r) => r.trailerVote);
  const members = useRoom((r) => r.members);
  const { memberId, isHost } = useMe();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => onPreviewing?.(previewId != null), [previewId, onPreviewing]);
  useEffect(() => setPreviewId(null), [vote?.id]);

  if (!vote || (!vote.open && editing)) {
    return isHost ? <TrailerSetup onDone={() => setEditing(false)} startOpen={editing} /> : null;
  }

  const total = vote.options.reduce((n, o) => n + o.votes.length, 0);
  const voters = members.filter((m) => m.connected).length;
  const winner = vote.options.find((o) => o.id === vote.winnerId);

  return (
    <section className="trailers" aria-label="Trailer vote">
      <header className="trailers-head">
        <h2>{vote.open ? 'Vote on tonight’s pick' : `The room picked ${winner?.title}`}</h2>
        <span className="muted">
          {total} of {voters} voted
        </span>
      </header>
      <div className="trailer-grid">
        {vote.options.map((o) => {
          const mine = !!memberId && o.votes.includes(memberId);
          const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
          const previewing = previewId === o.id;
          return (
            <article key={o.id} className={`trailer ${mine ? 'mine' : ''} ${o.id === vote.winnerId ? 'winner' : ''}`}>
              {previewing ? (
                <RangePreview source={o.source} start={0} end={TRAILERS.previewSec} />
              ) : (
                <button className="trailer-thumb" onClick={() => setPreviewId(o.id)} title="Preview (only you)">
                  {o.thumbnail ? <img src={o.thumbnail} alt="" loading="lazy" /> : <span className="trailer-initial">{o.title[0]}</span>}
                  <span className="trailer-play">Preview</span>
                </button>
              )}
              <h3 className="trailer-title">{o.title}</h3>
              <div className="meter" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="row">
                <span className="muted small">
                  {o.votes.length} vote{o.votes.length === 1 ? '' : 's'} · {pct}%
                </span>
                <span className="spacer" />
                {previewing && (
                  <button className="btn small ghost" onClick={() => setPreviewId(null)}>
                    Close preview
                  </button>
                )}
                {vote.open && (
                  <button className={`btn small ${mine ? 'primary' : ''}`} onClick={() => session.voteTrailer(o.id)}>
                    {mine ? 'Voted' : 'Vote'}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {isHost && (
        <div className="row">
          {vote.open ? (
            <>
              <button className="btn primary" onClick={() => void session.closeTrailerVote()} disabled={total === 0}>
                Close voting and load the winner
              </button>
              <button className="btn ghost" onClick={() => void session.cancelTrailerVote()}>
                Cancel vote
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setEditing(true)}>
              New trailer vote
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function TrailerSetup({ onDone, startOpen }: { onDone: () => void; startOpen: boolean }) {
  const session = useSession();
  const [open, setOpen] = useState(startOpen);
  const [inputs, setInputs] = useState<string[]>(() => Array(TRAILERS.maxOptions).fill(''));
  const [catalog, setCatalog] = useState<Movie[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCatalog().then(setCatalog, () => {});
  }, []);

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        Put trailers up for a vote
      </button>
    );
  }

  const filled = inputs.filter((i) => i.trim());
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const media = await Promise.all(filled.map((i) => mediaFromInput(i, catalog)));
    const bad = media.findIndex((m) => !m);
    if (bad >= 0) {
      session.notify('error', `Couldn't use “${filled[bad]}”. Pick a catalog title or paste a video link.`);
      setBusy(false);
      return;
    }
    const res = await session.startTrailerVote(media as NewMedia[]);
    setBusy(false);
    if (res.ok) onDone();
  };

  return (
    <form className="trailer-setup" onSubmit={start}>
      <h2>Shortlist up to {TRAILERS.maxOptions} trailers</h2>
      <p className="muted">Type a title from Discover or paste a YouTube, video file or streaming link.</p>
      <datalist id="catalog-titles">
        {catalog.map((m) => (
          <option key={m.id} value={m.title} />
        ))}
      </datalist>
      {inputs.map((v, i) => (
        <input
          key={i}
          list="catalog-titles"
          value={v}
          placeholder={`Option ${i + 1}`}
          onChange={(e) => setInputs((all) => all.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <div className="row">
        <button className="btn primary" disabled={busy || filled.length < TRAILERS.minOptions}>
          Start the vote
        </button>
        <button type="button" className="btn ghost" onClick={() => (setOpen(false), onDone())}>
          Cancel
        </button>
      </div>
    </form>
  );
}
