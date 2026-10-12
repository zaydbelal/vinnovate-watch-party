import type { Movie } from '@watch-party/shared';

const base = import.meta.env.VITE_SERVER_URL ?? '';

export async function createRoom(): Promise<string> {
  const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not create room');
  return (await res.json()).code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`${base}/api/rooms/${encodeURIComponent(code)}`);
  return res.ok;
}

let catalogPromise: Promise<Movie[]> | null = null;
export function fetchCatalog(): Promise<Movie[]> {
  catalogPromise ??= fetch(`${base}/api/catalog`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Catalog unavailable'))))
    .catch((err) => {
      catalogPromise = null;
      throw err;
    });
  return catalogPromise;
}

/** Best-effort title lookup for pasted YouTube links (falls back silently). */
export async function youtubeTitle(id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    return res.ok ? ((await res.json()).title as string) : null;
  } catch {
    return null;
  }
}
