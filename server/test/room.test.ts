import { describe, expect, it, beforeEach } from 'vitest';
import { expectedPosition, type PlaybackBroadcast, type PlaybackCommand } from '@watch-party/shared';
import { Room, RoomError, type RoomEmitter } from '../src/rooms/Room';

const media = { title: 'Clip', source: { kind: 'html5' as const, url: 'https://example.com/a.mp4' }, durationSec: 600, catalogId: 'clip' };

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const broadcasts: PlaybackBroadcast[] = [];
  const emitter: RoomEmitter = { patch() {}, playback: (b) => broadcasts.push(b), chat() {}, reaction() {} };
  const room = new Room('ABCDEF', emitter, clock.now);
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

  it('guests cannot control in host mode', () => {
    expect(() => s.room.applyCommand(s.guest.id, s.cmd('pause'))).toThrow(RoomError);
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
