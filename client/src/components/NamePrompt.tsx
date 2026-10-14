import { useState } from 'react';
import { LIMITS } from '@watch-party/shared';
import { saveName } from '../lib/identity';

/** Shown when someone opens an invite link without a saved name. */
export function NamePrompt({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <main className="home">
      <form
        className="home-inner"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          saveName(name.trim());
          onDone(name.trim());
        }}
      >
        <h1 className="home-title">You're invited</h1>
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
