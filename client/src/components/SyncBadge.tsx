import { useClient } from '../lib/context';

/** Live view of this client's sync quality (drift, RTT, last control latency). */
export function SyncBadge() {
  const sync = useClient((s) => s.sync);
  const abs = Math.abs(sync.driftMs);
  const level = abs < 50 ? 'good' : abs < 250 ? 'ok' : 'bad';
  return (
    <span
      className={`status sync ${level}`}
      title={`Drift ${sync.driftMs} ms · RTT ${sync.rttMs} ms · clock offset ${sync.offsetMs} ms · last control latency ${sync.lastControlLatencyMs ?? '–'} ms`}
    >
      <span className="dot" /> {sync.driftMs >= 0 ? '+' : ''}
      {sync.driftMs} ms
    </span>
  );
}
