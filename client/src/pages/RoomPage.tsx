import { useEffect, useRef, useState } from 'react';
import { navigate } from '../App';
import { NamePrompt } from '../components/NamePrompt';
import { Player } from '../components/Player';
import { RoomHeader } from '../components/RoomHeader';
import { Sidebar } from '../components/Sidebar';
import { Toasts } from '../components/Toasts';
import { SessionContext } from '../lib/context';
import { enterFullscreen, exitFullscreen, fullscreenElement, onFullscreenChange } from '../lib/fullscreen';
import { getSavedName } from '../lib/identity';
import { RoomSession } from '../lib/session';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/theme';

export function RoomPage({ code }: { code: string }) {
  const [name, setName] = useState(getSavedName);
  const [session, setSession] = useState<RoomSession | null>(null);

  useEffect(() => {
    if (!name) return;
    const s = new RoomSession(code, name);
    s.start();
    setSession(s);
    return () => s.stop();
  }, [code, name]);

  if (!name) return <NamePrompt onDone={setName} />;
  if (!session) return null;
  return (
    <SessionContext.Provider value={session}>
      <RoomView session={session} />
    </SessionContext.Provider>
  );
}

export type FullscreenMode = 'video' | 'chat' | null;

function RoomView({ session }: { session: RoomSession }) {
  const status = useStore(session.store, (s) => s.status);
  const error = useStore(session.store, (s) => s.error);
  const hasRoom = useStore(session.store, (s) => !!s.room);
  const away = useStore(session.store, (s) => s.away.manual);
  const [theme, setTheme] = useTheme();
  // Focus mode: only the video and chat, on black.
  const [focus, setFocus] = useState(false);
  const toggleFocus = () => setFocus((f) => !f);

  // Fullscreen is personal: nobody else's screen changes. "video" fills the
  // screen with the player; "chat" fullscreens the focus layout (video + chat).
  const roomRef = useRef<HTMLDivElement>(null);
  const [fsMode, setFsMode] = useState<FullscreenMode>(null);
  const [pseudo, setPseudo] = useState(false);
  const fsTarget = useRef<HTMLElement | null>(null);
  const focusBefore = useRef(false);
  const leaveFullscreen = () => {
    exitFullscreen();
    fsTarget.current = null;
    setPseudo(false);
    setFsMode((mode) => {
      if (mode === 'chat') setFocus(focusBefore.current);
      return null;
    });
  };
  const setFullscreen = async (mode: FullscreenMode) => {
    if (!mode || fsMode) return leaveFullscreen();
    const room = roomRef.current;
    // Video only still includes the control bar, so you can pause, change speed or exit.
    const target = mode === 'chat' ? room : room?.querySelector<HTMLElement>('.stage');
    if (!target) return;
    if (mode === 'chat') {
      focusBefore.current = focus;
      setFocus(true);
    }
    fsTarget.current = target;
    setFsMode(mode);
    setPseudo(!(await enterFullscreen(target)));
  };
  // Leaving via the browser (Esc, swipe) ends our mode too.
  useEffect(
    () =>
      onFullscreenChange(() => {
        if (!fullscreenElement() && fsTarget.current && !pseudo) leaveFullscreen();
      }),
  );
  // Pseudo fullscreen (no Fullscreen API, e.g. iPhone) exits with Esc.
  useEffect(() => {
    if (!fsMode) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && pseudo && leaveFullscreen();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (status === 'error' && !hasRoom) {
    return (
      <main className="home">
        <div className="home-inner">
          <h2>Can't join this room</h2>
          <p className="muted">{error}</p>
          <button className="btn primary" onClick={() => navigate('/')}>
            Back home
          </button>
        </div>
      </main>
    );
  }
  if (!hasRoom) return <div className="center muted">Joining room</div>;

  return (
    <div className={`room ${focus ? 'focus' : ''} ${pseudo && fsMode === 'chat' ? 'pseudo-fs' : ''}`} ref={roomRef}>
      {!focus && <RoomHeader theme={theme} onTheme={setTheme} onToggleFocus={toggleFocus} />}
      {away && !focus && (
        <div className="away-bar">
          You're marked away. The host can see it.
          <button className="btn small" onClick={() => session.setStepAway(false)}>
            I'm back
          </button>
        </div>
      )}
      <div className="room-body">
        <Player focus={focus} onToggleFocus={toggleFocus} fullscreen={fsMode} pseudoFullscreen={pseudo} onFullscreen={(m) => void setFullscreen(m)} />
        <Sidebar focus={focus} />
      </div>
      {focus && (
        <button
          className="focus-exit"
          onClick={() => (fsMode === 'chat' ? leaveFullscreen() : toggleFocus())}
          title={fsMode === 'chat' ? 'Leave fullscreen (Esc)' : 'Leave focus mode (F or Esc)'}
        >
          {fsMode === 'chat' ? 'Exit fullscreen' : 'Exit focus'}
        </button>
      )}
      <Toasts />
    </div>
  );
}
