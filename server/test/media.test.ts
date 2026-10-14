import { describe, expect, it } from 'vitest';
import { parseMediaUrl, streamingDeepLink, titleFromStreamingUrl } from '@watch-party/shared';

describe('parseMediaUrl', () => {
  it('recognises streaming services as companion-mode sources', () => {
    expect(parseMediaUrl('https://www.netflix.com/watch/81234567')).toMatchObject({ kind: 'external', provider: 'netflix' });
    expect(parseMediaUrl('https://www.primevideo.com/detail/0ABC/')).toMatchObject({ kind: 'external', provider: 'prime' });
    expect(parseMediaUrl('https://www.amazon.in/gp/video/detail/B0XYZ')).toMatchObject({ kind: 'external', provider: 'prime' });
    expect(parseMediaUrl('https://www.hotstar.com/in/movies/the-big-day/1260000000')).toMatchObject({ kind: 'external', provider: 'hotstar' });
    expect(parseMediaUrl('https://www.zee5.com/movies/details/some-film/0-0-1')).toMatchObject({ kind: 'external', provider: 'zee5' });
  });

  it('still handles YouTube and files', () => {
    expect(parseMediaUrl('https://youtu.be/aqz-KE-bpKQ')).toEqual({ kind: 'youtube', url: 'aqz-KE-bpKQ' });
    expect(parseMediaUrl('https://example.com/a.mp4')?.kind).toBe('html5');
  });

  it('derives titles and deep links', () => {
    const src = parseMediaUrl('https://www.hotstar.com/in/movies/the-big-day/1260000000')!;
    expect(titleFromStreamingUrl(src)).toBe('The Big Day · JioHotstar');
    expect(streamingDeepLink(parseMediaUrl('https://www.netflix.com/watch/1')!, 95.7)).toBe('https://www.netflix.com/watch/1?t=95');
  });
});
