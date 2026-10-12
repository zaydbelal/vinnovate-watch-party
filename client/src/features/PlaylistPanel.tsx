import { useState } from 'react';
import { parseMediaUrl, youtubeThumbnail } from '@watch-party/shared';
import { youtubeTitle } from '../lib/api';
import { useMe, useRoom, useSession } from '../lib/context';

/** Shared queue: paste links, vote, play, and turn the queue into a poll. */
export function PlaylistPanel() {
  const session = useSession();
  const playlist = useRoom((r) => r.playlist);
  const members = useRoom((r) => r.members);
  const { memberId, isHost, canControl } = useMe();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent, playNow = false) => {
    e.preventDefault();
    const source = parseMediaUrl(url);
    if (!source) return session.notify('error', 'That link does not look like a YouTube video or a video file');
    setBusy(true);
    const title =
      source.kind === 'youtube'
        ? ((await youtubeTitle(source.url)) ?? `YouTube · ${source.url}`)
        : decodeURIComponent(new URL(source.url).pathname.split('/').pop() || 'Video');
    const media = { title, source, thumbnail: source.kind === 'youtube' ? youtubeThumbnail(source.url) : undefined };
    const res = playNow ? await session.load(media) : await session.addToPlaylist(media);
    setBusy(false);
    if (res.ok) setUrl('');
  };

  const pollFromQueue = () => {
    const items = playlist.slice(0, 6);
    void session.createPoll(
      'What should we watch next?',
      items.map((i) => i.title),
      items.map((i) => i.id),
    );
  };

  return (
    <div className="playlist">
      <form className="row" onSubmit={(e) => add(e)}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube or .mp4 link" />
        <button className="btn" disabled={busy || !url}>
          + Queue
        </button>
        {canControl && (
          <button type="button" className="btn primary" disabled={busy || !url} onClick={(e) => add(e, true)}>
            Play
          </button>
        )}
      </form>

      {playlist.length === 0 ? (
        <p className="muted empty">Queue is empty. Add from Discover or paste a link. The most-voted video plays next.</p>
      ) : (
        <>
          <ul className="queue">
            {playlist.map((item, i) => {
              const voted = !!memberId && item.votes.includes(memberId);
              return (
                <li key={item.id}>
                  <span className="queue-pos">{i + 1}</span>
                  {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <div className="thumb-ph">🎬</div>}
                  <div className="queue-info">
                    <div className="ellipsis">{item.title}</div>
                    <div className="muted small">by {members.find((m) => m.id === item.addedBy)?.name ?? 'someone'}</div>
                  </div>
                  <button className={`btn small ${voted ? 'primary' : ''}`} onClick={() => session.vote(item.id)} title="Vote to play next">
                    ▲ {item.votes.length}
                  </button>
                  {canControl && (
                    <button className="btn small" onClick={() => void session.playItem(item.id)} title="Play now">
                      ▶
                    </button>
                  )}
                  {(isHost || item.addedBy === memberId) && (
                    <button className="btn small ghost" onClick={() => void session.removeFromPlaylist(item.id)} title="Remove">
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {playlist.length >= 2 && (
            <button className="btn" onClick={pollFromQueue}>
              📊 Let the room vote on the next video
            </button>
          )}
        </>
      )}
    </div>
  );
}
