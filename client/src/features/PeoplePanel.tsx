import { Avatar, Switch } from '../components/ui';
import { useClient, useMe, useRoom, useSession } from '../lib/context';

/** Members (AFK, buffering, sync health), host transfer and room settings. */
export function PeoplePanel() {
  const session = useSession();
  const members = useRoom((r) => r.members);
  const hostId = useRoom((r) => r.hostId);
  const settings = useRoom((r) => r.settings);
  const speaking = useClient((s) => s.voice.speaking);
  const { memberId, isHost } = useMe();

  return (
    <div className="people">
      {isHost && (
        <section className="settings">
          <h3 className="section-label">Room rules</h3>
          <Switch
            checked={settings.controlMode === 'everyone'}
            onChange={(v) => void session.updateSettings({ controlMode: v ? 'everyone' : 'host' })}
            label="Everyone controls playback"
          />
          <Switch
            checked={settings.pausePolicy === 'vote'}
            onChange={(v) => void session.updateSettings({ pausePolicy: v ? 'vote' : 'anyone' })}
            label="Pausing needs half the room"
          />
          <Switch
            checked={settings.waitForBuffering}
            onChange={(v) => void session.updateSettings({ waitForBuffering: v })}
            label="Wait for anyone buffering"
          />
          <Switch
            checked={settings.screenShare === 'host'}
            onChange={(v) => void session.updateSettings({ screenShare: v ? 'host' : 'anyone' })}
            label="Only the host can share their screen"
          />
        </section>
      )}
      <h3 className="section-label">In the room</h3>
      <ul className="member-list">
        {[...members]
          .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinedAt - b.joinedAt)
          .map((m) => {
            const drift = m.stats ? Math.abs(m.stats.driftMs) : null;
            const health = drift == null ? '' : drift < 50 ? 'good' : drift < 250 ? 'ok' : 'bad';
            return (
              <li key={m.id} className={m.connected && !m.afk ? '' : 'dim'}>
                <Avatar member={m} speaking={speaking.includes(m.id)} />
                <div className="member-info">
                  <div className="member-name">
                    {m.name}
                    {m.id === memberId && <span className="muted"> (you)</span>}
                    {m.id === hostId && <span className="tag">Host</span>}
                    {m.afk && <span className="tag warn">AFK</span>}
                    {m.buffering && <span className="tag">Buffering</span>}
                  </div>
                  <div className="muted small">
                    {!m.connected
                      ? 'Reconnecting'
                      : m.stats
                        ? `drift ${m.stats.driftMs} ms · rtt ${m.stats.rttMs} ms${m.stats.lastControlLatencyMs != null ? ` · ctrl ${m.stats.lastControlLatencyMs} ms` : ''}`
                        : 'Syncing'}
                  </div>
                </div>
                {health && <span className={`dot ${health}`} title="Sync health" />}
                {isHost && m.id !== memberId && m.connected && (
                  <button className="btn small ghost" onClick={() => void session.transferHost(m.id)}>
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
