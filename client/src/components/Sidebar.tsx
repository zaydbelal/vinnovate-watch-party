import { useState } from 'react';
import { panels } from '../features';

/** Tabbed side panels. In focus mode only chat remains. */
export function Sidebar({ focus }: { focus: boolean }) {
  const [active, setActive] = useState(panels[0].id);
  const current = focus ? 'chat' : active;
  return (
    <aside className="sidebar">
      {!focus && (
        <nav className="tabs" role="tablist">
          {panels.map((p) => (
            <button key={p.id} role="tab" aria-selected={p.id === active} className="tab" onClick={() => setActive(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
      )}
      {/* Panels stay mounted so chat scroll, search text etc. survive tab switches. */}
      {panels.map(({ id, component: Panel }) => (
        <div key={id} className="panel" hidden={id !== current}>
          <Panel />
        </div>
      ))}
    </aside>
  );
}
