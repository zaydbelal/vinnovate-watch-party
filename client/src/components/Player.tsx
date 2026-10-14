import { useEffect, useRef, useState } from 'react';
import { CLIPS, PLAYBACK_RATES, REACTION_EMOJIS, formatTime } from '@watch-party/shared';
import { useClient, useMe, useRoom, useSession } from '../lib/context';
import { ScreenShareClient } from '../lib/screenShare';
import { SyncEngine } from '../lib/syncEngine';
import { Lobby } from './Lobby';
import { FullscreenIcon, MutedIcon, PauseIcon, PlayIcon, VolumeIcon } from './ui';

/**
 * The stage: video (or lobby), room banners, transport controls and reactions.
 * Keyboard: Space play/pause, ←/→ seek 10 s, C clip, M mute, F focus mode.
 */
export function Player({ focus, onToggleFocus }: { focus: boolean; onToggleFocus: () => void }) {
  const session = useSession();
  const { memberId, isHost, canControl } = useMe();
  const playback = useRoom((r) => r.playback);
  const settings = useRoom((r) => r.settings);
  const lobbyActive = useRoom((r) => r.lobby.active);
  const hostId = useRoom((r) => r.hostId);
  const hostDrift = useRoom((r) => r.members.find((m) => m.id === r.hostId)?.stats?.driftMs ?? 0);
  const lockToHost = useClient((s) => s.lockToHost);
  const sharerId = useRoom((r) => r.screenShare?.memberId ?? null);
  const shareWho = useRoom((r) => r.settings.screenShare);
  const sharing = !!sharerId;
  const sharerName = useRoom((r) => r.members.find((m) => m.id === r.screenShare?.memberId)?.name);
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
      onBuffering: (id, b) => session.reportBuffering(id, b),
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

  // "Sync to host": follow where the host's player actually is, not just the timeline.
  const following = lockToHost && !isHost && !!hostId;
  useEffect(() => {
    engineRef.current?.setTargetOffset(following ? hostDrift : 0);
  }, [following, hostDrift]);

  const pausedByMe = !playback.playing && playback.pausedBy === memberId;
  const canPause = settings.pausePolicy === 'anyone' || canControl;
  const canResume = canControl || pausedByMe;

  const togglePlay = () => {
    if (!playback.media) return;
    if (playback.playing) void (canPause ? session.pause() : session.requestPause());
    else if (canResume) void session.play();
  };
  const clip = (len: number) => {
    const end = time;
    const start = Math.max(0, end - len);
    void session.createClip(start, end).then((r) => r.ok && session.notify('info', `Clipped the last ${Math.round(end - start)} s. Find it under Clips.`));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyF') onToggleFocus();
      else if (e.code === 'Escape' && focus) onToggleFocus();
      else if (e.code === 'KeyM') setMuted((m) => !m);
      if (!playback.media) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyC') clip(CLIPS.defaultLength);
      else if (canControl && e.code === 'ArrowRight') void session.seek(time + 10);
      else if (canControl && e.code === 'ArrowLeft') void session.seek(Math.max(0, time - 10));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frameRef.current?.requestFullscreen();
  };

  const shown = scrub ?? time;
  const external = playback.media?.source.kind === 'external';
  const playLabel = playback.playing ? (canPause ? 'Pause' : 'Ask to pause') : canResume ? 'Play' : 'Paused';

  return (
    <section className={`stage ${lobbyActive && !sharing ? 'in-lobby' : ''} ${sharing ? 'is-sharing' : ''}`}>
      {sharing && <ScreenView sharerId={sharerId} volume={volume} muted={muted} />}
      {lobbyActive && !sharing && <Lobby />}
      <div className="player-frame" ref={frameRef} aria-hidden={lobbyActive || undefined}>
        <div className="player-container" ref={containerRef} />
        {/* Shield blocks clicks on embeds so nobody bypasses room controls. */}
        <div className="player-shield" onDoubleClick={fullscreen} />
        {!playback.media && (
          <div className="player-empty">
            <p className="player-empty-title">Nothing playing yet</p>
            <p className="muted">Pick something in Discover, or paste a link in Queue.</p>
          </div>
        )}
        {loading && <div className="player-loading">Loading</div>}
        {needsClick && (
          <button className="player-unblock" onClick={() => engineRef.current?.userGesture()}>
            Click to join playback
            <small>Your browser blocked autoplay</small>
          </button>
        )}
        <RoomBanners />
        <FloatingReactions />
      </div>

      <div className="controls">
        <button className="ctl" disabled={!playback.media || (!playback.playing && !canResume)} onClick={togglePlay} title={`${playLabel} (Space)`} aria-label={playLabel}>
          {playback.playing ? canPause ? <PauseIcon /> : <span className="ctl-text">Ask to pause</span> : <PlayIcon />}
        </button>
        <span className="time">{formatTime(shown)}</span>
        <input
          className="seek"
          type="range"
          aria-label="Seek"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(shown, duration || 0)}
          disabled={!canControl || !playback.media || !duration}
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
        <span className="time">{duration ? formatTime(duration) : '--:--'}</span>
        <select
          className="speed"
          aria-label="Playback speed"
          title={canControl ? 'Playback speed (everyone)' : 'Playback speed (set by the host)'}
          value={playback.rate}
          disabled={!canControl || !playback.media}
          onChange={(e) => void session.setRate(Number(e.target.value))}
        >
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={r}>
              {r}×
            </option>
          ))}
        </select>
        <button className="ctl hide-sm" onClick={() => setMuted((m) => !m)} title="Mute (only you, M)" aria-label="Mute">
          {muted || volume === 0 ? <MutedIcon /> : <VolumeIcon />}
        </button>
        <input
          className="volume"
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(e) => (setVolume(Number(e.target.value)), setMuted(false))}
        />
        <ClipMenu disabled={!playback.media} onClip={clip} />
        {ScreenShareClient.supported() && !sharing && (shareWho === 'anyone' || isHost) && (
          <button className="btn small ghost hide-sm" onClick={() => void session.startScreenShare()} title="Share a screen, window or tab with the room">
            Share screen
          </button>
        )}
        {!isHost && hostId && (
          <button
            className={`btn small ${following ? 'primary' : 'ghost'}`}
            disabled={!playback.media}
            onClick={() => {
              session.setLockToHost(!lockToHost);
              setTimeout(() => engineRef.current?.resync(), 0);
            }}
            title="Match the host's screen exactly instead of the room clock"
          >
            {following ? 'Synced to host' : 'Sync to host'}
          </button>
        )}
        <button className="ctl" onClick={fullscreen} title="Fullscreen" aria-label="Fullscreen">
          <FullscreenIcon />
        </button>
      </div>

      {!focus && (
        <div className="now-playing">
          <div className="now-playing-text">
            <h2 className="now-title">{sharing ? `${sharerName ?? 'Someone'}'s screen` : (playback.media?.title ?? 'No video')}</h2>
            <p className="muted small">
              {[
                !canControl && (settings.pausePolicy === 'anyone' ? 'Anyone can pause · host controls the rest' : 'Host controls playback · ask to pause'),
                playback.rate !== 1 && `${playback.rate}×`,
                external && 'Companion mode: play it in your own account',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="reaction-bar">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} className="reaction-btn" onClick={() => session.react(e, time)} aria-label={`React ${e}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The shared screen, shown in place of the video. Your volume and mute
 * controls apply to it too. The sharer sees their own capture, muted.
 */
function ScreenView({ sharerId, volume, muted }: { sharerId: string; volume: number; muted: boolean }) {
  const session = useSession();
  const stream = useClient((s) => s.screen.stream);
  const { memberId, isHost } = useMe();
  const name = useRoom((r) => r.members.find((m) => m.id === sharerId)?.name ?? 'Someone');
  const ref = useRef<HTMLVideoElement>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const mine = sharerId === memberId;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) v.play().then(() => setNeedsClick(false), () => setNeedsClick(true));
  }, [stream]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = volume;
    v.muted = mine || muted;
  }, [volume, muted, mine]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.parentElement?.requestFullscreen();
  };

  return (
    <div className="player-frame screen-frame">
      <video ref={ref} className="player-media" playsInline autoPlay onDoubleClick={fullscreen} />
      {!stream && <div className="player-loading">Connecting to {name}'s screen</div>}
      {needsClick && (
        <button className="player-unblock" onClick={() => void ref.current?.play().then(() => setNeedsClick(false))}>
          Click to watch {name}'s screen
          <small>Your browser blocked autoplay</small>
        </button>
      )}
      <div className="screen-bar">
        <span>{mine ? 'You are sharing your screen' : `${name} is sharing their screen`}</span>
        {(mine || isHost) && (
          <button className="btn small primary" onClick={() => void session.stopScreenShare()}>
            {mine ? 'Stop sharing' : 'End share'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Clip the last N seconds (lengths from CLIPS in shared/src/config.ts). */
function ClipMenu({ disabled, onClip }: { disabled: boolean; onClip: (len: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="clip-menu" ref={ref}>
      <button className="btn small ghost" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Clip the last few seconds (C)">
        Clip
      </button>
      {open && (
        <div className="popover" role="menu">
          <span className="muted small">Clip the last</span>
          {CLIPS.lengths.map((len) => (
            <button
              key={len}
              role="menuitem"
              className="btn small"
              onClick={() => {
                onClip(len);
                setOpen(false);
              }}
            >
              {len} s
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pause requests and buffering holds, shown over the bottom of the video. */
function RoomBanners() {
  const session = useSession();
  const req = useRoom((r) => r.pauseRequest);
  const hold = useRoom((r) => r.bufferHold);
  const members = useRoom((r) => r.members);
  const { memberId } = useMe();
  const name = (id: string) => (id === memberId ? 'You' : (members.find((m) => m.id === id)?.name ?? 'Someone'));

  if (hold) {
    return (
      <div className="banner" role="status">
        Waiting for {hold.memberIds.map(name).join(', ')} to catch up
      </div>
    );
  }
  if (!req) return null;
  const agreed = !!memberId && req.votes.includes(memberId);
  return (
    <div className="banner" role="status">
      <span>
        <strong>{name(req.requestedBy)}</strong> {req.requestedBy === memberId ? 'asked' : 'wants'} to pause · {req.votes.length} of {req.needed}
      </span>
      {agreed ? (
        req.requestedBy !== memberId && (
          <button className="btn small ghost" onClick={() => void session.votePause(req.id, false)}>
            Withdraw
          </button>
        )
      ) : (
        <button className="btn small primary" onClick={() => void session.votePause(req.id, true)}>
          Agree
        </button>
      )}
    </div>
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
            {who && <span className="float-name">{who.name}</span>}
          </div>
        );
      })}
    </div>
  );
}
