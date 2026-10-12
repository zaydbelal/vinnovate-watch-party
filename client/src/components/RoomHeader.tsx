import { useState } from 'react';
import { navigate } from '../App';
import { useClient, useRoom, useSession } from '../lib/context';
import { SyncBadge } from './SyncBadge';

export function RoomHeader() {
  const session = useSession();
  const code = useRoom((r) => r.code);
  const status = useClient((s) => s.status);
  const online = useRoom((r) => r.members.filter((m) => m.connected).length);
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
      <button className="logo-btn" onClick={() => navigate('/')} title="Leave room">
        🍿 <span>Watch Party</span>
      </button>
      <div className="room-code" title="Room code">
        {code}
      </div>
      <button className="btn small" onClick={copyLink}>
        {copied ? 'Copied!' : 'Copy invite link'}
      </button>
      <div className="spacer" />
      {status === 'reconnecting' && <span className="pill warn">Reconnecting…</span>}
      <span className="pill">👥 {online}</span>
      <SyncBadge />
    </header>
  );
}
