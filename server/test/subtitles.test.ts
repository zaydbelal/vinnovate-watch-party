import { describe, expect, it } from 'vitest';
import { cueAt, parseSubtitles } from '@watch-party/shared';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>Hello</i> there

2
00:00:04,000 --> 00:00:06,000
{\\an8}Second line
two rows

3
01:02:03,250 --> 01:02:05,000
Late
`;

const VTT = `WEBVTT

NOTE a comment

00:01.000 --> 00:02.000 align:start
<c.yellow>Short stamps</c>

intro
00:00:02.500 --> 00:00:04.000
With id
`;

describe('subtitles', () => {
  it('parses SRT, stripping tags and keeping multi-line cues', () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start: 1, end: 3.5, text: 'Hello there' });
    expect(cues[1].text).toBe('Second line\ntwo rows');
    expect(cues[2].start).toBeCloseTo(3723.25);
  });

  it('parses WebVTT with short timestamps, cue ids and settings, CRLF and BOM', () => {
    const cues = parseSubtitles('﻿' + VTT.replace(/\n/g, '\r\n'));
    expect(cues.map((c) => c.text)).toEqual(['Short stamps', 'With id']);
    expect(cues[0]).toMatchObject({ start: 1, end: 2 });
  });

  it('finds the cue on screen at a time', () => {
    const cues = parseSubtitles(SRT);
    expect(cueAt(cues, 0.5)).toBe('');
    expect(cueAt(cues, 2)).toBe('Hello there');
    expect(cueAt(cues, 3.7)).toBe('');
    expect(cueAt(cues, 5)).toBe('Second line\ntwo rows');
    expect(cueAt([], 5)).toBe('');
  });

  it('ignores junk', () => {
    expect(parseSubtitles('not subtitles at all')).toEqual([]);
  });
});
