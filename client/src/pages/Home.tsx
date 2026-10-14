import { useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { navigate } from '../App';
import { createRoom, roomExists } from '../lib/api';
import { getSavedName, saveName } from '../lib/identity';
import { useTheme } from '../lib/theme';
import { Switch } from '../components/ui';

export function Home() {
  const [name, setName] = useState(getSavedName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  const requireName = () => {
    if (!name.trim()) {
      setError('Pick a display name first');
      return false;
    }
    saveName(name.trim());
    return true;
  };

  const onCreate = async () => {
    if (!requireName()) return;
    setBusy(true);
    try {
      navigate(`/r/${await createRoom()}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const onJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireName()) return;
    // Accept a full invite link as well as a bare code.
    const clean = code.trim().split('/').pop()!.toUpperCase();
    if (!clean) return setError('Enter a room code');
    setBusy(true);
    if (await roomExists(clean).catch(() => false)) navigate(`/r/${clean}`);
    else {
      setError('No room with that code');
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <div className="home-theme">
        <Switch checked={theme === 'dark'} onChange={toggleTheme} label="Dark" />
      </div>
      <div className="home-inner">
        <h1 className="home-title">Watch Party</h1>
        <p className="home-lede">
          The same frame, on every screen. Chat, talk, vote on what's next, and clip the moment everyone screamed.
        </p>

        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={LIMITS.maxNameLength} onChange={(e) => setName(e.target.value)} placeholder="e.g. Zayd" autoFocus />
        </label>

        <button className="btn primary big" onClick={onCreate} disabled={busy}>
          Create a room
        </button>

        <form className="join" onSubmit={onJoin}>
          <label className="field">
            <span>Have a code?</span>
            <div className="row">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Room code or invite link" />
              <button className="btn" disabled={busy}>
                Join
              </button>
            </div>
          </label>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
