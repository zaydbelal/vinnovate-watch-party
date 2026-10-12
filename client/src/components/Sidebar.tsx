import { useState } from 'react';
import { panels } from '../features';

export function Sidebar() {
  const [active, setActive] = useState(panels[0].id);
  return (
    <aside className="sidebar">
      <nav className="tabs">
        {panels.map((p) => (
          <button key={p.id} className={`tab ${p.id === active ? 'active' : ''}`} onClick={() => setActive(p.id)}>
            {p.label}
          </button>
        ))}
      </nav>
      {/* Panels stay mounted so chat scroll, search text etc. survive tab switches. */}
      {panels.map(({ id, component: Panel }) => (
        <div key={id} className="panel" hidden={id !== active}>
          <Panel />
        </div>
      ))}
    </aside>
  );
}
