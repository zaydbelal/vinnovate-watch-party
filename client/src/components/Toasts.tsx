import { useClient } from '../lib/context';

export function Toasts() {
  const notices = useClient((s) => s.notices);
  return (
    <div className="toasts">
      {notices.map((n) => (
        <div key={n.id} className={`toast ${n.level}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
}
