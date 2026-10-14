import { parseMediaUrl, titleFromStreamingUrl, youtubeThumbnail, type Movie, type NewMedia } from '@watch-party/shared';
import { youtubeTitle } from './api';

export function movieToMedia(m: Movie): NewMedia {
  return { title: m.title, source: m.source, thumbnail: m.thumbnail, durationSec: m.durationMin * 60, catalogId: m.id };
}

/** A pasted link (YouTube, file, streaming service) or an exact catalog title -> media. */
export async function mediaFromInput(input: string, catalog: Movie[] = []): Promise<NewMedia | null> {
  const text = input.trim();
  const movie = catalog.find((m) => m.title.toLowerCase() === text.toLowerCase());
  if (movie) return movieToMedia(movie);
  const source = parseMediaUrl(text);
  if (!source) return null;
  if (source.kind === 'youtube') {
    return { title: (await youtubeTitle(source.url)) ?? `YouTube · ${source.url}`, source, thumbnail: youtubeThumbnail(source.url) };
  }
  if (source.kind === 'external') return { title: titleFromStreamingUrl(source), source };
  return { title: decodeURIComponent(new URL(source.url).pathname.split('/').pop() || 'Video'), source };
}

/** Embed URL for a local, unsynced preview of a range (trailers, clips). */
export function previewSrc(source: NewMedia['source'], start: number, end: number): string | null {
  if (source.kind === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${source.url}?autoplay=1&rel=0&start=${Math.floor(start)}&end=${Math.ceil(end)}`;
  }
  if (source.kind === 'html5') return `${source.url}#t=${start.toFixed(2)},${end.toFixed(2)}`;
  return null;
}
