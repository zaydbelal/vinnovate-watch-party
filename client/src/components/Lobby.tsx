import { useCallback, useEffect, useRef, useState } from 'react';
import { LOBBY, formatTime } from '@watch-party/shared';
import { useMe, useRoom, useSession } from '../lib/context';
import { LofiMusic } from '../lib/lofi';
import { TrailerVote } from './TrailerVote';
import { Avatar, useServerNow } from './ui';

const MUSIC_KEY = 'wp:lofi';

function musicPref(): boolean {
  try {
    return localStorage.getItem(MUSIC_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Pre-show / intermission screen: a countdown, who's settled in, lo-fi music
 * and the trailer vote. The video is already loaded (paused) underneath, so
 * when the countdown hits zero everyone starts on the same frame.
 */
export function Lobby() {
  const session = useSession();
  const lobby = useRoom((r) => r.lobby);
  const media = useRoom((r) => r.playback.media);
  const position = useRoom((r) => r.playback.position);
  const members = useRoom((r) => r.members);
  const { isHost } = useMe();
  const now = useServerNow();
  const [musicOn, setMusicOn] = useState(musicPref);
  const [previewing, setPreviewing] = useState(false);
  const music = useRef<LofiMusic | null>(null);

  const remaining = lobby.startsAt != null ? Math.max(0, (lobby.startsAt - now) / 1000) : null;
  const here = members.filter((m) => m.connected);
  const away = here.filter((m) => m.afk).length;
  const intermission = !!media && position > 1;

  // Music follows the preference, pauses during trailer previews, and needs one
  // user gesture before the browser lets it start.
  useEffect(() => {
    const m = (music.current ??= new LofiMusic());
    const want = musicOn && !previewing;
    if (!want) {
      m.stop();
      return;
    }
    const tryStart = () => void m.start().catch(() => {});
    tryStart();
    window.addEventListener('pointerdown', tryStart, { once: true });
    return () => window.removeEventListener('pointerdown', tryStart);
  }, [musicOn, previewing]);
  useEffect(() => () => music.current?.stop(), []);

  const toggleMusic = () => {
    const next = !musicOn;
    setMusicOn(next);
    try {
      localStorage.setItem(MUSIC_KEY, next ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };
  const onPreviewing = useCallback((p: boolean) => setPreviewing(p), []);

  return (
    <section className="lobby" aria-label={intermission ? 'Intermission' : 'Pre-show lobby'}>
      <div className="lobby-hero">
        <p className="eyebrow">{intermission ? 'Intermission' : 'Pre-show'}</p>
        {remaining != null ? (
          <h1 className="countdown" aria-live="polite">
            {formatTime(Math.ceil(remaining))}
          </h1>
        ) : (
          <h1 className="lobby-title">{intermission ? 'Back in a bit' : 'Settle in'}</h1>
        )}
        <p className="lobby-sub">
          {media ? (
            <>
              {intermission ? 'Resuming' : 'Up next'} <strong>{media.title}</strong>
            </>
          ) : isHost ? (
            'Pick something in Discover or run a trailer vote.'
          ) : (
            'Grab snacks. The host will start the show.'
          )}
        </p>
      </div>

      <div className="lobby-people">
        <div className="avatar-row">
          {here.map((m) => (
            <Avatar key={m.id} member={m} size={36} />
          ))}
        </div>
        <span className="muted">
          {here.length} here{away ? ` · ${away} away` : ''}
        </span>
      </div>

      <div className="lobby-actions">
        <button className="btn ghost" onClick={toggleMusic} aria-pressed={musicOn}>
          {musicOn ? 'Music on' : 'Music off'}
        </button>
        {isHost && (
          <>
            <span className="lobby-sep" />
            {LOBBY.countdownPresets.map((sec) => (
              <button key={sec} className="btn" onClick={() => void session.setLobby(true, sec)}>
                {sec / 60} min
              </button>
            ))}
            {lobby.startsAt != null && (
              <button className="btn ghost" onClick={() => void session.setLobby(true, null)}>
                Stop countdown
              </button>
            )}
            <button className={`btn ${media ? 'primary' : 'ghost'}`} onClick={() => void session.setLobby(false)}>
              {media ? 'Start now' : 'Skip the lobby'}
            </button>
          </>
        )}
      </div>

      <TrailerVote onPreviewing={onPreviewing} />
    </section>
  );
}
