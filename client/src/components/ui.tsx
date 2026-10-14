import { useEffect, useState } from 'react';
import type { Member } from '@watch-party/shared';
import { useSession } from '../lib/context';

/** Accessible on/off switch with a visible text label. */
export function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)} title={title}>
      <span className="switch-track" aria-hidden>
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

/** Initial on the member's colour; dims and says AFK when they've stepped away. */
export function Avatar({ member, speaking = false, size = 32 }: { member: Member; speaking?: boolean; size?: number }) {
  const away = member.afk || !member.connected;
  return (
    <span
      className={`avatar ${away ? 'away' : ''} ${speaking ? 'speaking' : ''}`}
      style={{ background: member.color, width: size, height: size, fontSize: size * 0.42 }}
      title={`${member.name}${member.afk ? ' (AFK)' : !member.connected ? ' (reconnecting)' : ''}`}
    >
      {member.name[0]?.toUpperCase()}
      {member.afk && <span className="avatar-tag">AFK</span>}
    </span>
  );
}

/** Server-clock time, re-rendered every `intervalMs`. */
export function useServerNow(intervalMs = 250): number {
  const session = useSession();
  const [now, setNow] = useState(() => session.clock.serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(session.clock.serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [session, intervalMs]);
  return now;
}

/* Transport icons. Kept to the few controls where a glyph is clearer than a word. */
const svg = (d: string) =>
  function Icon() {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden fill="currentColor">
        <path d={d} />
      </svg>
    );
  };
export const PlayIcon = svg('M7 4.5v15a.5.5 0 0 0 .76.43l12-7.5a.5.5 0 0 0 0-.86l-12-7.5A.5.5 0 0 0 7 4.5z');
export const PauseIcon = svg('M6 4h4v16H6zM14 4h4v16h-4z');
export const VolumeIcon = svg('M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z');
export const MutedIcon = svg('M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z');
export const FullscreenIcon = svg('M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z');
