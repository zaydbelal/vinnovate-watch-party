import type { MediaSource, StreamingProvider } from './protocol';

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

  const provider = streamingProvider(host);
  if (provider) return { kind: 'external', provider, url: url.toString() };

  // Anything else is treated as a direct media file the <video> tag can play.
  return { kind: 'html5', url: url.toString() };
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Display names and hostnames for supported streaming services. Add a service here. */
export const STREAMING_PROVIDERS: Record<StreamingProvider, { name: string; hosts: string[] }> = {
  netflix: { name: 'Netflix', hosts: ['netflix.com'] },
  prime: { name: 'Prime Video', hosts: ['primevideo.com', 'amazon.com', 'amazon.in', 'amazon.co.uk'] },
  hotstar: { name: 'JioHotstar', hosts: ['hotstar.com', 'jiohotstar.com'] },
  zee5: { name: 'ZEE5', hosts: ['zee5.com'] },
};

function streamingProvider(host: string): StreamingProvider | null {
  for (const [id, p] of Object.entries(STREAMING_PROVIDERS)) {
    if (p.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return id as StreamingProvider;
  }
  return null;
}

/** Best-effort readable title from a streaming URL slug ("/movies/the-big-day/123" -> "The Big Day"). */
export function titleFromStreamingUrl(source: MediaSource): string {
  const name = source.provider ? STREAMING_PROVIDERS[source.provider].name : 'Stream';
  try {
    const slug = new URL(source.url).pathname
      .split('/')
      .filter((p) => /[a-z]/i.test(p) && p.includes('-') && !/^(watch|title|detail|dp|gp|video|movies|shows|tv)$/i.test(p))
      .pop();
    if (slug) return `${slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} · ${name}`;
  } catch {
    /* fall through */
  }
  return `${name} title`;
}

/** Link that opens the title in the service, at `seconds` where the service supports it. */
export function streamingDeepLink(source: MediaSource, seconds: number): string {
  if (source.provider !== 'netflix') return source.url;
  const url = new URL(source.url);
  url.searchParams.set('t', String(Math.max(0, Math.floor(seconds))));
  return url.toString();
}
