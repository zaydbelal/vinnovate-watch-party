import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { NamePrompt } from '../components/NamePrompt';
import { Player } from '../components/Player';
import { RoomHeader } from '../components/RoomHeader';
import { Sidebar } from '../components/Sidebar';
import { Toasts } from '../components/Toasts';
import { SessionContext } from '../lib/context';
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

function RoomView({ session }: { session: RoomSession }) {
  const status = useStore(session.store, (s) => s.status);
  const error = useStore(session.store, (s) => s.error);
  const hasRoom = useStore(session.store, (s) => !!s.room);
  const away = useStore(session.store, (s) => s.away.manual);
  const [theme, toggleTheme] = useTheme();
  // Focus mode: only the video and chat, on black.
  const [focus, setFocus] = useState(false);
  const toggleFocus = () => setFocus((f) => !f);

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
    <div className={`room ${focus ? 'focus' : ''}`}>
      {!focus && <RoomHeader theme={theme} onToggleTheme={toggleTheme} onToggleFocus={toggleFocus} />}
      {away && !focus && (
        <div className="away-bar">
          You're marked away. The host can see it.
          <button className="btn small" onClick={() => session.setStepAway(false)}>
            I'm back
          </button>
        </div>
      )}
      <div className="room-body">
        <Player focus={focus} onToggleFocus={toggleFocus} />
        <Sidebar focus={focus} />
      </div>
      {focus && (
        <button className="focus-exit" onClick={toggleFocus} title="Leave focus mode (F or Esc)">
          Exit focus
        </button>
      )}
      <Toasts />
    </div>
  );
}
