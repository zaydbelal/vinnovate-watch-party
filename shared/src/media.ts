import type { MediaSource } from './protocol';

/**
 * Turn whatever the user pasted into a playable source.
 * Add new providers (Vimeo, HLS, ...) here and a matching player adapter on
 * the client (client/src/players).
 */
export function parseMediaUrl(input: string): MediaSource | null {
  const raw = input.trim();
  if (!raw) return null;

  // Bare YouTube id
  if (/^[\w-]{11}$/.test(raw)) return { kind: 'youtube', url: raw };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1, 12);
    return /^[\w-]{11}$/.test(id) ? { kind: 'youtube', url: id } : null;
  }
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const id =
      url.searchParams.get('v') ??
      url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ??
      null;
    return id && /^[\w-]{11}$/.test(id) ? { kind: 'youtube', url: id } : null;
  }

  // Anything else is treated as a direct media file the <video> tag can play.
  return { kind: 'html5', url: url.toString() };
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
