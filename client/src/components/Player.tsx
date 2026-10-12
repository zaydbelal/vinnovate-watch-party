import { useEffect, useRef, useState } from 'react';
import { REACTION_EMOJIS, formatTime } from '@watch-party/shared';
import { useClient, useMe, useRoom, useSession } from '../lib/context';
import { SyncEngine } from '../lib/syncEngine';

export function Player() {
  const session = useSession();
  const { canControl } = useMe();
  const playback = useRoom((r) => r.playback);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  // One engine per mounted player; it receives every playback broadcast.
  useEffect(() => {
    const engine = new SyncEngine(containerRef.current!, {
      serverNow: () => session.clock.serverNow(),
      onDrift: (d) => session.reportDrift(d),
      onNeedsInteraction: setNeedsClick,
      onEnded: (id) => session.ended(id),
      onError: (msg) => session.notify('error', msg),
      onLoading: setLoading,
    });
    engineRef.current = engine;
    const initial = session.store.get().room?.playback;
    if (initial) void engine.setState(initial);
    const off = session.onPlaybackState((b) => void engine.setState(b.state));
    const ui = setInterval(() => {
      setTime(engine.currentTime());
      setDuration(engine.duration());
    }, 250);
    return () => {
      off();
      clearInterval(ui);
      engine.destroy();
    };
  }, [session]);

  useEffect(() => engineRef.current?.setVolume(volume), [volume]);
  useEffect(() => engineRef.current?.setMuted(muted), [muted]);

  // Keyboard shortcuts: space = play/pause, ←/→ = ±10s.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !canControl || !playback.media) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void (playback.playing ? session.pause() : session.play());
      } else if (e.code === 'ArrowRight') void session.seek(time + 10);
      else if (e.code === 'ArrowLeft') void session.seek(Math.max(0, time - 10));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canControl, playback, session, time]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen();
  };

  const shown = scrub ?? time;
  const disabled = !canControl || !playback.media;

  return (
    <section className="player-col">
      <div className="player-frame" ref={frameRef}>
        <div className="player-container" ref={containerRef} />
        {/* Shield blocks clicks on embeds so nobody bypasses room controls. */}
        <div className="player-shield" onDoubleClick={fullscreen} />
        {!playback.media && (
          <div className="player-empty">
            <div className="big-emoji">🎬</div>
            <p>Nothing playing yet.</p>
            <p className="muted">Pick something from Discover or paste a link in Playlist.</p>
          </div>
        )}
        {loading && <div className="player-loading">Loading…</div>}
        {needsClick && (
          <button className="player-unblock" onClick={() => engineRef.current?.userGesture()}>
            ▶ Click to join playback
            <small>Your browser blocked autoplay</small>
          </button>
        )}
        <FloatingReactions />
      </div>

      <div className="controls">
        <button
          className="btn icon"
          disabled={disabled}
          onClick={() => void (playback.playing ? session.pause() : session.play())}
          title={canControl ? 'Play / pause (space)' : 'Only the host can control playback'}
        >
          {playback.playing ? '⏸' : '▶'}
        </button>
        <span className="time">{formatTime(shown)}</span>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(shown, duration || 0)}
          disabled={disabled}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            if (scrub != null) void session.seek(scrub);
            setScrub(null);
          }}
          onKeyUp={() => {
            if (scrub != null) void session.seek(scrub);
            setScrub(null);
          }}
        />
        <span className="time">{formatTime(duration)}</span>
        <button className="btn icon" onClick={() => setMuted((m) => !m)} title="Mute (only you)">
          {muted || volume === 0 ? '🔇' : '🔊'}
        </button>
        <input className="volume" type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => (setVolume(Number(e.target.value)), setMuted(false))} />
        <button className="btn icon" onClick={fullscreen} title="Fullscreen">
          ⛶
        </button>
      </div>

      <div className="now-playing">
        <div>
          <strong>{playback.media?.title ?? 'No video'}</strong>
          {!canControl && <span className="muted"> · host controls playback</span>}
        </div>
        <div className="reaction-bar">
          {REACTION_EMOJIS.map((e) => (
            <button key={e} className="reaction-btn" onClick={() => session.react(e, time)} title="React">
              {e}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FloatingReactions() {
  const reactions = useClient((s) => s.reactions);
  const members = useRoom((r) => r.members);
  return (
    <div className="floating-reactions">
      {reactions.map((r) => {
        // Stable pseudo-random horizontal lane per reaction id.
        const lane = (parseInt(r.id.slice(0, 6), 16) % 80) + 10;
        const who = members.find((m) => m.id === r.memberId);
        return (
          <div key={r.id} className="float" style={{ left: `${lane}%` }}>
            <span className="float-emoji">{r.emoji}</span>
            {who && (
              <span className="float-name" style={{ color: who.color }}>
                {who.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
