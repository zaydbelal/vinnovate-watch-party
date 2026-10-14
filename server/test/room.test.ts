import { describe, expect, it, beforeEach } from 'vitest';
import { BUFFERING, PAUSE_VOTE, expectedPosition, type PlaybackBroadcast, type PlaybackCommand } from '@watch-party/shared';
import { Room, RoomError, type RoomEmitter } from '../src/rooms/Room';

const media = { title: 'Clip', source: { kind: 'html5' as const, url: 'https://example.com/a.mp4' }, durationSec: 600, catalogId: 'clip' };

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const broadcasts: PlaybackBroadcast[] = [];
  const emitter: RoomEmitter = { patch() {}, playback: (b) => broadcasts.push(b), chat() {}, reaction() {} };
  const room = new Room('ABCDEF', emitter, clock.now);
  room.lobby = { active: false, startsAt: null }; // most tests start past the lobby
  const host = room.addMember('Host', 's1');
  const guest = room.addMember('Guest', 's2');
  const cmd = (action: PlaybackCommand['action'], extra: Partial<PlaybackCommand> = {}): PlaybackCommand => ({
    action,
    baseVersion: room.playback.version,
    issuedAt: clock.now(),
    ...extra,
  });
  return { room, host, guest, clock, broadcasts, cmd };
}

describe('Room playback', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
  });

  it('first member becomes host', () => {
    expect(s.room.hostId).toBe(s.host.id);
  });

  it('load starts playing at 0 and records history', () => {
    expect(s.room.playback.playing).toBe(true);
    expect(s.room.playback.position).toBe(0);
    expect(s.room.history).toEqual(['clip']);
  });

  it('timeline advances with server time', () => {
    s.clock.advance(5000);
    expect(expectedPosition(s.room.playback, s.clock.now())).toBeCloseTo(5);
  });

  it('pause freezes position at the moment it was issued', () => {
    s.clock.advance(10_000);
    const issuedAt = s.clock.now();
    s.clock.advance(80); // network delay
    s.room.applyCommand(s.host.id, s.cmd('pause', { issuedAt }));
    expect(s.room.playback.playing).toBe(false);
    expect(s.room.playback.position).toBeCloseTo(10);
  });

  it('duplicate pause from two users is a no-op (concurrent actions)', () => {
    s.room.updateSettings(s.host.id, { controlMode: 'everyone' });
    const v = s.room.playback.version;
    expect(s.room.applyCommand(s.host.id, s.cmd('pause'))).toBe(true);
    expect(s.room.applyCommand(s.guest.id, s.cmd('pause', { baseVersion: v }))).toBe(false);
    expect(s.room.playback.version).toBe(v + 1);
  });

  it('seek clamps to duration and bumps version', () => {
    const v = s.room.playback.version;
    s.room.applyCommand(s.host.id, s.cmd('seek', { position: 9999 }));
    expect(s.room.playback.position).toBe(600);
    expect(s.room.playback.version).toBe(v + 1);
  });

  it('guests cannot seek or change speed in host mode', () => {
    expect(() => s.room.applyCommand(s.guest.id, s.cmd('seek', { position: 5 }))).toThrow(RoomError);
    expect(() => s.room.applyCommand(s.guest.id, s.cmd('rate', { rate: 1.5 }))).toThrow(RoomError);
  });

  it('anyone can pause by default, and whoever paused can resume', () => {
    expect(s.room.applyCommand(s.guest.id, s.cmd('pause'))).toBe(true);
    expect(s.room.playback.playing).toBe(false);
    expect(s.room.applyCommand(s.guest.id, s.cmd('play'))).toBe(true);
    expect(s.room.playback.playing).toBe(true);
  });

  it('a guest cannot resume a pause the host made', () => {
    s.room.applyCommand(s.host.id, s.cmd('pause'));
    expect(() => s.room.applyCommand(s.guest.id, s.cmd('play'))).toThrow(RoomError);
  });

  it('in vote mode guests must ask to pause', () => {
    s.room.updateSettings(s.host.id, { pausePolicy: 'vote' });
    expect(() => s.room.applyCommand(s.guest.id, s.cmd('pause'))).toThrow(RoomError);
  });

  it('speed change keeps the position continuous', () => {
    s.clock.advance(10_000);
    s.room.applyCommand(s.host.id, s.cmd('rate', { rate: 2 }));
    expect(s.room.playback.position).toBeCloseTo(10);
    s.clock.advance(5000);
    expect(expectedPosition(s.room.playback, s.clock.now())).toBeCloseTo(20);
    expect(() => s.room.applyCommand(s.host.id, s.cmd('rate', { rate: 3 }))).toThrow(/speed/);
  });

  it('commands aimed at a replaced video are dropped as stale', () => {
    const stale = s.cmd('seek', { position: 30 });
    s.room.applyCommand(s.host.id, s.cmd('load', { media: { ...media, title: 'Other' } }));
    expect(s.room.applyCommand(s.host.id, stale)).toBe(false);
    expect(s.room.playback.position).toBe(0);
  });

  it('versions strictly increase across broadcasts', () => {
    s.room.applyCommand(s.host.id, s.cmd('pause'));
    s.room.applyCommand(s.host.id, s.cmd('seek', { position: 3 }));
    s.room.applyCommand(s.host.id, s.cmd('play'));
    const versions = s.broadcasts.map((b) => b.state.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('Room playlist & polls', () => {
  it('ended plays the most-voted item next, once', () => {
    const s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    const a = s.room.addToPlaylist(s.host.id, { ...media, title: 'A' });
    const b = s.room.addToPlaylist(s.guest.id, { ...media, title: 'B' });
    s.room.toggleVote(s.guest.id, b.id);
    const current = s.room.playback.media!.id;
    expect(s.room.mediaEnded(current)).toBe(true);
    expect(s.room.playback.media!.title).toBe('B');
    expect(s.room.mediaEnded(current)).toBe(false); // second "ended" from another client
    expect(s.room.playlist.map((i) => i.id)).toEqual([a.id]);
  });

  it('poll allows one vote per member and winner jumps the queue', () => {
    const s = setup();
    const a = s.room.addToPlaylist(s.host.id, { ...media, title: 'A' });
    const b = s.room.addToPlaylist(s.host.id, { ...media, title: 'B' });
    const poll = s.room.createPoll(s.host.id, 'Next?', ['A', 'B'], [a.id, b.id]);
    s.room.votePoll(s.host.id, poll.id, poll.options[1].id);
    s.room.votePoll(s.guest.id, poll.id, poll.options[0].id);
    s.room.votePoll(s.guest.id, poll.id, poll.options[1].id); // changes vote
    expect(poll.options[0].votes).toEqual([]);
    expect(poll.options[1].votes).toHaveLength(2);
    s.room.closePoll(s.host.id, poll.id);
    expect(s.room.playlist[0].id).toBe(b.id);
  });
});

describe('Room membership', () => {
  it('host leaving hands host to the longest-present member', () => {
    const s = setup();
    s.clock.advance(1);
    const third = s.room.addMember('Third', 's3');
    s.room.removeMember(s.host.id);
    expect(s.room.hostId).toBe(s.guest.id);
    s.room.transferHost(s.guest.id, third.id);
    expect(s.room.hostId).toBe(third.id);
  });

  it('reconnecting by session id keeps the same member', () => {
    const s = setup();
    s.room.disconnect(s.guest.id);
    expect(s.room.findBySession(s.guest.sessionId)?.id).toBe(s.guest.id);
    s.room.reconnect(s.guest, 'new-socket');
    expect(s.room.members.get(s.guest.id)?.connected).toBe(true);
  });

  it('enforces room capacity', () => {
    const s = setup();
    expect(() => s.room.addMember('X', 'sx', 2)).toThrow(/full/);
  });
});

describe('Pause votes', () => {
  function voteSetup(people: number) {
    const s = setup();
    const extra = Array.from({ length: people - 2 }, (_, i) => s.room.addMember(`P${i}`, `x${i}`));
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    s.room.updateSettings(s.host.id, { pausePolicy: 'vote' });
    return { ...s, extra };
  }

  it('pauses once half of the active viewers agree', () => {
    const s = voteSetup(4);
    s.room.requestPause(s.guest.id);
    expect(s.room.pauseRequest?.needed).toBe(Math.ceil(4 * PAUSE_VOTE.share));
    expect(s.room.playback.playing).toBe(true);
    s.room.votePause(s.extra[0].id, s.room.pauseRequest!.id, true);
    expect(s.room.playback.playing).toBe(false);
    expect(s.room.pauseRequest).toBeNull();
    // The requester may resume their own pause.
    expect(s.room.applyCommand(s.guest.id, s.cmd('play'))).toBe(true);
  });

  it('AFK viewers do not count toward the threshold', () => {
    const s = voteSetup(4);
    s.room.setAfk(s.extra[0].id, true);
    s.room.setAfk(s.extra[1].id, true);
    s.room.requestPause(s.guest.id); // 1 of 2 active = half
    expect(s.room.playback.playing).toBe(false);
  });

  it('requests expire', () => {
    const s = voteSetup(4);
    s.room.requestPause(s.guest.id);
    s.clock.advance(PAUSE_VOTE.ttlMs + 1);
    s.room.tick();
    expect(s.room.pauseRequest).toBeNull();
    expect(s.room.playback.playing).toBe(true);
  });
});

describe('Auto-buffer catching', () => {
  function bufSetup() {
    const s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    return { ...s, mediaId: s.room.playback.media!.id };
  }

  it('pauses while someone buffers and resumes from the same spot when they recover', () => {
    const s = bufSetup();
    s.clock.advance(5000);
    s.room.setBuffering(s.guest.id, s.mediaId, true);
    expect(s.room.playback.playing).toBe(false);
    expect(s.room.bufferHold?.memberIds).toEqual([s.guest.id]);
    const pos = s.room.playback.position;
    s.clock.advance(2000);
    s.room.setBuffering(s.guest.id, s.mediaId, false);
    expect(s.room.playback.playing).toBe(true);
    expect(s.room.playback.position).toBeCloseTo(pos);
    expect(s.room.bufferHold).toBeNull();
  });

  it('gives up waiting after the max hold', () => {
    const s = bufSetup();
    s.room.setBuffering(s.guest.id, s.mediaId, true);
    s.clock.advance(BUFFERING.maxHoldMs);
    s.room.tick();
    expect(s.room.playback.playing).toBe(true);
  });

  it('respects the setting and the cooldown', () => {
    const s = bufSetup();
    s.room.setBuffering(s.guest.id, s.mediaId, true);
    s.room.setBuffering(s.guest.id, s.mediaId, false);
    s.room.setBuffering(s.guest.id, s.mediaId, true); // within cooldown
    expect(s.room.playback.playing).toBe(true);
    s.room.setBuffering(s.guest.id, s.mediaId, false);
    s.room.updateSettings(s.host.id, { waitForBuffering: false });
    s.clock.advance(BUFFERING.cooldownMs + 1);
    s.room.setBuffering(s.guest.id, s.mediaId, true);
    expect(s.room.playback.playing).toBe(true);
  });
});

describe('Lobby and trailer vote', () => {
  it('video loaded in the lobby waits paused, then starts exactly at the countdown', () => {
    const s = setup();
    s.room.setLobby(s.host.id, true, 60);
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    expect(s.room.playback.playing).toBe(false);
    const startsAt = s.room.lobby.startsAt!;
    s.clock.advance(60_000 + 200); // tick runs a little late
    s.room.tick();
    expect(s.room.lobby.active).toBe(false);
    expect(s.room.playback.playing).toBe(true);
    // Timeline is anchored to the scheduled start, not the late tick.
    expect(expectedPosition(s.room.playback, s.clock.now())).toBeCloseTo((s.clock.now() - startsAt) / 1000);
  });

  it('only the host runs the lobby', () => {
    const s = setup();
    expect(() => s.room.setLobby(s.guest.id, true, 60)).toThrow(RoomError);
  });

  it('trailer vote: one vote each, winner gets loaded', () => {
    const s = setup();
    s.room.setLobby(s.host.id, true, null);
    const tv = s.room.startTrailerVote(s.host.id, [
      { ...media, title: 'A' },
      { ...media, title: 'B' },
      { ...media, title: 'C' },
    ]);
    s.room.voteTrailer(s.host.id, tv.options[2].id);
    s.room.voteTrailer(s.guest.id, tv.options[1].id);
    s.room.voteTrailer(s.guest.id, tv.options[2].id); // switches
    expect(tv.options[2].votes).toHaveLength(2);
    expect(tv.options[1].votes).toHaveLength(0);
    s.room.closeTrailerVote(s.host.id);
    expect(s.room.playback.media?.title).toBe('C');
    expect(s.room.playback.playing).toBe(false); // still in the lobby
  });

  it('rejects too many trailers', () => {
    const s = setup();
    expect(() => s.room.startTrailerVote(s.host.id, [media, media, media, media])).toThrow(RoomError);
  });
});

describe('Clips, AFK and voice', () => {
  it('clips are capped at 90 s and clamped to the video', () => {
    const s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    const clip = s.room.createClip(s.guest.id, 30, 60);
    expect(clip.end - clip.start).toBe(30);
    expect(() => s.room.createClip(s.guest.id, 0, 200)).toThrow(/90/);
    expect(() => s.room.removeClip(s.host.id === clip.createdBy ? s.guest.id : 'nobody', clip.id)).toThrow(RoomError);
    s.room.removeClip(s.host.id, clip.id);
    expect(s.room.clips).toHaveLength(0);
  });

  it('marks members AFK and back', () => {
    const s = setup();
    s.room.setAfk(s.guest.id, true);
    expect(s.room.members.get(s.guest.id)?.afk).toBe(true);
    s.room.setAfk(s.guest.id, false);
    expect(s.room.members.get(s.guest.id)?.afk).toBe(false);
  });

  it('disconnecting leaves voice', () => {
    const s = setup();
    s.room.joinVoice(s.guest.id);
    expect(s.room.voice).toEqual([s.guest.id]);
    s.room.disconnect(s.guest.id);
    expect(s.room.voice).toEqual([]);
  });

  it('accepts streaming-service sources in companion mode', () => {
    const s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media: { title: 'N', source: { kind: 'external', provider: 'netflix', url: 'https://www.netflix.com/watch/123' } } }));
    expect(s.room.playback.media?.source.provider).toBe('netflix');
    expect(() =>
      s.room.applyCommand(s.host.id, s.cmd('load', { media: { title: 'X', source: { kind: 'external', url: 'https://x.com' } } })),
    ).toThrow(RoomError);
  });
});

describe('Lobby song and screen share', () => {
  it('song queue: first song starts, the rest queue, and an end advances once', () => {
    const s = setup();
    const song = (title: string) => ({ title, source: { kind: 'youtube' as const, url: 'jfKfPfyJRdk' } });
    const a = s.room.addSong(s.guest.id, song('A'));
    expect(s.room.lobbyTrack).toMatchObject({ id: a.id, title: 'A', startedAt: s.clock.now() });
    s.room.addSong(s.host.id, song('B'));
    s.room.addSong(s.guest.id, song('C'));
    expect(s.room.lobbyQueue.map((x) => x.title)).toEqual(['B', 'C']);
    s.room.songEnded(a.id);
    s.room.songEnded(a.id); // second client's report is ignored
    expect(s.room.lobbyTrack?.title).toBe('B');
    expect(s.room.lobbyQueue.map((x) => x.title)).toEqual(['C']);
  });

  it('last song loops; skip and remove need host or adder; clear goes back to lo-fi', () => {
    const s = setup();
    const song = (title: string) => ({ title, source: { kind: 'html5' as const, url: 'https://example.com/a.mp3' } });
    const a = s.room.addSong(s.host.id, song('A'));
    s.room.songEnded(a.id); // empty queue: keeps looping
    expect(s.room.lobbyTrack?.id).toBe(a.id);
    const b = s.room.addSong(s.host.id, song('B'));
    expect(() => s.room.removeSong(s.guest.id, b.id)).toThrow(RoomError);
    expect(() => s.room.skipSong(s.guest.id)).toThrow(RoomError);
    s.room.skipSong(s.host.id);
    expect(s.room.lobbyTrack?.title).toBe('B');
    s.room.addSong(s.guest.id, song('C'));
    expect(() => s.room.clearSongs(s.guest.id)).toThrow(RoomError);
    s.room.clearSongs(s.host.id);
    expect(s.room.lobbyTrack).toBeNull();
    expect(s.room.lobbyQueue).toEqual([]);
  });

  it('rejects streaming-service links as lobby music', () => {
    const s = setup();
    expect(() =>
      s.room.addSong(s.host.id, { title: 'N', source: { kind: 'external', provider: 'netflix', url: 'https://www.netflix.com/watch/1' } }),
    ).toThrow(RoomError);
  });

  it('one sharer at a time, pauses the video, and ends when the sharer leaves', () => {
    const s = setup();
    s.room.applyCommand(s.host.id, s.cmd('load', { media }));
    s.room.startScreenShare(s.guest.id);
    expect(s.room.screenShare?.memberId).toBe(s.guest.id);
    expect(s.room.playback.playing).toBe(false);
    expect(() => s.room.startScreenShare(s.host.id)).toThrow(/already sharing/);
    s.room.disconnect(s.guest.id);
    expect(s.room.screenShare).toBeNull();
  });

  it('host-only sharing and host can stop anyone', () => {
    const s = setup();
    s.room.startScreenShare(s.guest.id);
    s.room.stopScreenShare(s.host.id);
    expect(s.room.screenShare).toBeNull();
    s.room.updateSettings(s.host.id, { screenShare: 'host' });
    expect(() => s.room.startScreenShare(s.guest.id)).toThrow(RoomError);
  });
});
