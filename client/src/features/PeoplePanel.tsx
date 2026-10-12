import { useMe, useRoom, useSession } from '../lib/context';

/** Members, host transfer, room settings and per-member sync health. */
export function PeoplePanel() {
  const session = useSession();
  const members = useRoom((r) => r.members);
  const hostId = useRoom((r) => r.hostId);
  const controlMode = useRoom((r) => r.settings.controlMode);
  const { memberId, isHost } = useMe();

  return (
    <div className="people">
      {isHost && (
        <label className="setting">
          <input
            type="checkbox"
            checked={controlMode === 'everyone'}
            onChange={(e) => void session.updateSettings({ controlMode: e.target.checked ? 'everyone' : 'host' })}
          />
          Let everyone control playback
        </label>
      )}
      <ul className="member-list">
        {[...members]
          .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)
          .map((m) => {
            const drift = m.stats ? Math.abs(m.stats.driftMs) : null;
            const health = drift == null ? '' : drift < 200 ? 'good' : drift < 500 ? 'ok' : 'bad';
            return (
              <li key={m.id} className={m.connected ? '' : 'offline'}>
                <span className="avatar" style={{ background: m.color }}>
                  {m.name[0]?.toUpperCase()}
                </span>
                <div className="member-info">
                  <div>
                    {m.name}
                    {m.id === memberId && <span className="muted"> (you)</span>}
                    {m.id === hostId && <span title="Host"> 👑</span>}
                  </div>
                  <div className="muted small">
                    {!m.connected
                      ? 'reconnecting…'
                      : m.stats
                        ? `drift ${m.stats.driftMs} ms · rtt ${m.stats.rttMs} ms${m.stats.lastControlLatencyMs != null ? ` · ctrl ${m.stats.lastControlLatencyMs} ms` : ''}`
                        : 'syncing…'}
                  </div>
                </div>
                {health && <span className={`dot ${health}`} title="Sync health" />}
                {isHost && m.id !== memberId && m.connected && (
                  <button className="btn small" onClick={() => void session.transferHost(m.id)}>
                    Make host
                  </button>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
