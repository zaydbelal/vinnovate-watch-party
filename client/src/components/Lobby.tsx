import { useCallback, useEffect, useRef, useState } from 'react';
import { LOBBY, formatTime } from '@watch-party/shared';
import { useMe, useRoom, useSession } from '../lib/context';
import { LobbyTrackPlayer } from '../lib/lobbyTrack';
import { LofiMusic } from '../lib/lofi';
import { mediaFromInput } from '../lib/media';
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
  const track = useRoom((r) => r.lobbyTrack);
  const { isHost } = useMe();
  const now = useServerNow();
  const [musicOn, setMusicOn] = useState(musicPref);
  const [previewing, setPreviewing] = useState(false);
  const music = useRef<LofiMusic | null>(null);
  const trackMount = useRef<HTMLDivElement>(null);
  const trackPlayer = useRef<LobbyTrackPlayer | null>(null);

  const remaining = lobby.startsAt != null ? Math.max(0, (lobby.startsAt - now) / 1000) : null;
  const here = members.filter((m) => m.connected);
  const away = here.filter((m) => m.afk).length;
  const intermission = !!media && position > 1;

  // Music follows the preference, pauses during trailer previews, and needs one
  // user gesture before the browser lets it start.
  // A host-picked song replaces the generated lo-fi.
  useEffect(() => {
    const m = (music.current ??= new LofiMusic());
    const tp = (trackPlayer.current ??= new LobbyTrackPlayer(trackMount.current!, () => session.clock.serverNow()));
    const want = musicOn && !previewing;
    if (!want || track) m.stop();
    if (!want || !track) tp.stop();
    if (!want) return;
    const tryStart = track ? () => void tp.play(track) : () => void m.start().catch(() => {});
    tryStart();
    window.addEventListener('pointerdown', tryStart, { once: true });
    return () => window.removeEventListener('pointerdown', tryStart);
  }, [musicOn, previewing, track, session]);
  useEffect(
    () => () => {
      music.current?.dispose();
      trackPlayer.current?.stop();
    },
    [],
  );

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
        <span className="muted small lobby-track">{track ? `Playing ${track.title}` : 'Lo-fi radio'}</span>
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

      {isHost && <LobbyTrackPicker hasTrack={!!track} />}

      <TrailerVote onPreviewing={onPreviewing} />
      {/* Off-screen mount for the lobby song's player (YouTube needs a real-sized iframe). */}
      <div ref={trackMount} className="lobby-track-mount" aria-hidden />
    </section>
  );
}

/** Host: paste a YouTube or audio link to loop for everyone, or go back to the lo-fi. */
function LobbyTrackPicker({ hasTrack }: { hasTrack: boolean }) {
  const session = useSession();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const media = await mediaFromInput(url);
    if (!media || media.source.kind === 'external') {
      setBusy(false);
      session.notify('error', 'Paste a YouTube link or a direct audio file (.mp3, .m4a, .ogg)');
      return;
    }
    const res = await session.setLobbyTrack({ title: media.title, source: media.source });
    setBusy(false);
    if (res.ok) setUrl('');
  };
  return (
    <form className="lobby-music-form row" onSubmit={submit}>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a song: YouTube link or audio file" aria-label="Lobby music link" />
      <button className="btn" disabled={busy || !url.trim()}>
        Play for everyone
      </button>
      {hasTrack && (
        <button type="button" className="btn ghost" onClick={() => void session.setLobbyTrack(null)}>
          Back to lo-fi
        </button>
      )}
    </form>
  );
}
