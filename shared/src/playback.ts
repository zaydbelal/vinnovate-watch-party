import type { PlaybackState } from './protocol';

/**
 * Where the shared timeline is at server time `now` (ms).
 * Every client computes this independently, which is what keeps them in sync.
 */
export function expectedPosition(state: PlaybackState, now: number): number {
  if (!state.playing) return state.position;
  const elapsedSec = Math.max(0, now - state.updatedAt) / 1000;
  return state.position + elapsedSec * state.rate;
}

export function formatTime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  const s = Math.floor(totalSec % 60);
  const m = Math.floor((totalSec / 60) % 60);
  const h = Math.floor(totalSec / 3600);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Nearest-rank percentile; `p` in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}
