/** One subtitle line (or block of lines) and when it shows, in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function seconds(stamp: string): number | null {
  const m = TIME.exec(stamp);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/**
 * Parse SRT or WebVTT text into cues, sorted by start time. Formatting tags
 * (<i>, {\an8}, <c.yellow>…) are stripped: subtitles render as plain text.
 */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex < 0) continue; // WEBVTT header, NOTE, STYLE, stray numbers
    const [from, to] = lines[timingIndex].split('-->');
    const start = seconds(from);
    const end = seconds(to);
    if (start == null || end == null || end <= start) continue;
    const body = lines
      .slice(timingIndex + 1)
      .map((l) => l.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '').trim())
      .filter(Boolean)
      .join('\n');
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Text showing at `t` seconds (overlapping cues are joined), or '' (binary search). */
export function cueAt(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: string[] = [];
  // Walk back over earlier cues that are still on screen (overlaps are rare and short).
  for (let i = last; i >= 0 && i > last - 8; i--) if (cues[i].end > t) out.unshift(cues[i].text);
  return out.join('\n');
}
