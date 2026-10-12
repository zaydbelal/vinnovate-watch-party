import { useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { saveName } from '../lib/identity';

/** Shown when someone opens an invite link without a saved name. */
export function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <main className="home">
      <form
        className="home-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name.trim());
          onDone(name.trim());
        }}
      >
        <h2>You're invited 🍿</h2>
        <label className="field">
          <span>What should we call you?</span>
          <input value={name} maxLength={LIMITS.maxNameLength} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <button className="btn primary big" disabled={!name.trim()}>
          Join the party
        </button>
      </form>
    </main>
  );
}
