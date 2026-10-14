import { useState } from 'react';
import { navigate } from '../App';
import { useClient, useMe, useRoom, useSession } from '../lib/context';
import type { Theme } from '../lib/theme';
import { SyncBadge } from './SyncBadge';
import { Switch, ThemePicker } from './ui';

export function RoomHeader({ theme, onTheme, onToggleFocus }: { theme: Theme; onTheme: (t: Theme) => void; onToggleFocus: () => void }) {
  const session = useSession();
  const code = useRoom((r) => r.code);
  const status = useClient((s) => s.status);
  const awayManual = useClient((s) => s.away.manual);
  const online = useRoom((r) => r.members.filter((m) => m.connected).length);
  const afk = useRoom((r) => r.members.filter((m) => m.connected && m.afk).length);
  const lobbyActive = useRoom((r) => r.lobby.active);
  const { isHost } = useMe();
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    const link = `${location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      session.notify('info', link);
    }
  };

  return (
    <header className="room-header">
      <button className="wordmark" onClick={() => navigate('/')} title="Leave room">
        Watch Party
      </button>
      <button className="room-code" onClick={copyLink} title="Copy invite link">
        {copied ? 'Link copied' : code}
      </button>
      <span className="spacer" />
      {status === 'reconnecting' && <span className="status warn">Reconnecting</span>}
      <span className="status" title={afk ? `${afk} stepped away` : undefined}>
        {online} watching{afk ? <span className="warn"> · {afk} away</span> : null}
      </span>
      <SyncBadge />
      {isHost && !lobbyActive && (
        <button className="btn small ghost hide-sm" onClick={() => void session.setLobby(true, null)} title="Pause and open the lobby">
          Intermission
        </button>
      )}
      <Switch checked={awayManual} onChange={session.setStepAway} label="Away" title="Mark yourself AFK so the host knows to wait" />
      <Switch checked={false} onChange={onToggleFocus} label="Focus" title="Black out everything except the video and chat (F)" />
      <ThemePicker theme={theme} onChange={onTheme} />
    </header>
  );
}
