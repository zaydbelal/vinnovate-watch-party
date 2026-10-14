# Architecture

```
 Browser (React)                                   Node server
┌──────────────────────────────┐   Socket.IO    ┌───────────────────────────────┐
│ RoomSession  (lib/session)   │◀──websocket──▶│ features/*.ts  (one per area)  │
│   ├ ClockSync  (lib/clock)   │               │      │                        │
│   ├ Store      (lib/store)   │               │      ▼                        │
│   └ actions: play(), chat()… │               │ Room  (rooms/Room.ts)         │
│ SyncEngine   (lib/syncEngine)│               │   pure state + rules, tested  │
│   └ PlayerAdapter (players/) │               │ RoomManager: timers, cleanup  │
│ Panels       (features/)     │               └───────────────────────────────┘
└──────────────────────────────┘
             ▲      shared/ (protocol types, config, playback math)      ▲
             └─────────────────────── imported by both ───────────────────┘
```

## The shared timeline

The server stores one `PlaybackState` per room:

```ts
{ media, playing, position, rate, updatedAt, version }
```

`position` is where the video was at server time `updatedAt`. Any client can compute the live position with `expectedPosition(state, serverNow)` (`shared/src/playback.ts`):

```
expected = playing ? position + (serverNow - updatedAt) / 1000 * rate : position
```

So the server only broadcasts when something changes (play, pause, seek, load). Between changes, clients don't need any messages to stay together.

### Clock sync

`serverNow` needs each client's clock offset from the server. `ClockSync` (`client/src/lib/clock.ts`) does NTP-style pings: `offset = serverTime + rtt/2 - localReceiveTime`. It takes 6 samples on join and one every 15 s, and trusts the sample with the lowest RTT, because that one has the least uneven-delay error.

### Drift correction (frame-accurate)

`SyncEngine` (`client/src/lib/syncEngine.ts`) checks every 250 ms:

| Drift (on-screen frame − expected) | Action |
| --- | --- |
| > 1000 ms (or > 350 ms on YouTube) | Seek to expected plus a learned *seek lead*, then wait 800 ms for buffering |
| > 42 ms (about one frame at 24 fps) | Change playback rate by up to ±8%, proportional to the drift, until drift < 12 ms (hysteresis) |
| otherwise | Play at the room rate |
| paused, more than half a frame off | Seek to the paused frame, so every paused screen shows the same frame |

Three details make this frame-accurate rather than "close enough":
- **Measure the frame on screen.** `video.currentTime` runs ahead of what is displayed. `Html5Player` uses `requestVideoFrameCallback` to record the media time and presentation time of each frame, and extrapolates from the last one. It also estimates the frame duration, which sets the paused tolerance.
- **Filter noise.** Drift is the median of the last 3 readings, so one jittery sample never triggers a correction. Large desyncs still act on the raw reading.
- **Learn the seek lead.** Seeking a playing video takes time, so a naive seek lands behind. After each seek the engine measures where it landed and adjusts how far ahead the next seek aims (capped at `SYNC.maxSeekLeadMs`).

YouTube only offers coarse rates and no frame callbacks, so it relies on seeking and is accurate to roughly 100–350 ms. All thresholds live in `shared/src/config.ts` (`SYNC`).

### Control flow of a command

1. User clicks pause. `session.pause()` emits `playback:command` with `issuedAt` (server clock) and `baseVersion`.
2. The server's `Room.applyCommand` checks permissions and computes the new state. A pause freezes at the position *when the user clicked* (`issuedAt`, clamped to the last 2 s), not when the packet arrived. Then `version` is incremented.
3. The server broadcasts `playback:state` to the room, including the issuer.
4. Each client drops states whose `version` is not newer than the one it has, then `SyncEngine.setState` snaps the player.
5. Each client measures `serverNow − issuedAt` (control propagation latency) and reports it, which feeds `/api/metrics`.

The issuer waits for the server echo instead of acting optimistically. This costs one LAN round trip (a few ms) and means nobody ever has to roll back.

## Reliability

**Late joins.** Joining returns a full `RoomSnapshot`, including the playback state. The client measures its clock offset *before* applying the snapshot, so a late joiner starts at the live position the first time. Measured within 70 ms.

**Reconnections.** The server issues a `sessionId` on first join, and the client keeps it in `sessionStorage`. That survives a refresh, while separate tabs still count as separate people. Socket.IO reconnects automatically, and every reconnect re-runs the same join path with the saved id:
- The same member record is restored (name, colour, votes), and a fresh snapshot resyncs the client.
- A dropped member keeps their seat for `RECONNECT_GRACE_MS` (30 s) and shows as "reconnecting…" to others.
- If the host drops, host passes immediately to the longest-present connected member so the room never stalls.
- If the old socket is still alive (a half-open connection), it is disconnected so one member never has two sockets.
- Empty rooms are deleted after `EMPTY_ROOM_TTL_MS`.

**Concurrent actions.** Node's single-threaded event loop handles commands one at a time, in arrival order. On top of that:
- Every accepted command increments `version`, and clients ignore anything older than what they have. This avoids out-of-order application even with reordering or a reconnect snapshot racing a broadcast.
- Idempotent no-ops are dropped. If two people hit pause at the same moment, the second is a no-op, so there is no extra version and no flicker.
- Commands aimed at a video that has since been replaced (`baseVersion` older than the load) are discarded as stale.
- `playback:ended` is sent by every client but is idempotent per media id, so the playlist advances exactly once.
- Poll and playlist votes are per-member sets, so double clicks and duplicates can't inflate counts.

The bench script fires 12 simultaneous conflicting commands for 20 rounds and checks that every client ends on the identical version and position: 20/20.

**Other failure handling.**
- Autoplay blocked by the browser: shows "Click to join playback" and resumes in sync after one click.
- Media fails to load: shows an error toast, and the room state is unaffected.
- Bad input: every payload is validated and clamped server-side (lengths, numbers, enum values, capacity).
- Spam: a token bucket per socket limits chat, reactions, playlist adds and poll creation.
- Disallowed actions return an `{ ok: false, error }` ack, which shows as a toast.
- The player is shielded: embed clicks are blocked, so nobody can desync themselves by clicking inside the YouTube iframe.

## Room features built on the timeline

All of these are rules in `Room.ts` (unit-tested) plus a small feature file. Anything time-based (countdown end, request expiry, buffer timeout) runs from `Room.tick()`, which `RoomManager` calls every 250 ms, so `Room` itself still has no timers.

- **Pause policy.** `canPause()` is true for everyone under the default `pausePolicy: 'anyone'`. `canResume()` also lets whoever paused resume (`playback.pausedBy`). Under `'vote'`, `requestPause()` opens a `PauseRequest`. It pauses once `ceil(active × PAUSE_VOTE.share)` present, non-AFK members agree, and it lapses after `PAUSE_VOTE.ttlMs`. The count is redone whenever someone votes, leaves or goes AFK.
- **Auto-buffer catching.** The client reports `buffer:state` only after a stall outlasts `BUFFERING.reportAfterMs`, and never during the post-seek settle window. The first report pauses the room into a `BufferHold`. When every held member reports recovery, the room resumes from the paused position. `maxHoldMs` caps the wait, and a per-member `cooldownMs` stops a flaky connection from pausing the room repeatedly.
- **Lobby.** `lobby: { active, startsAt }`. Media loaded during the lobby stays paused, so every client preloads it. When the countdown ends, the play state is committed with `updatedAt = startsAt`, so the timeline starts exactly at the scheduled moment even if the tick ran late. Pressing play also ends the lobby.
- **Trailer vote.** `TrailerVote` with 2–3 options and one vote per member. Closing it loads the winner through the same path as any other load.
- **Clips.** `{ mediaId, start, end }` ranges of 15–90 s. Clips are references, not files, so they work for every provider. Video files can be rendered to WebM in the browser (`client/src/lib/clipExport.ts`: a hidden `<video>` + `captureStream` + `MediaRecorder`, with audio routed through Web Audio so nothing plays out loud).
- **AFK.** `member.afk`, set by the "Away" switch or after `PRESENCE.hiddenAfkMs` with the tab hidden, and restored after a reconnect.
- **Voice.** The server keeps the `voice` member list and relays `voice:signal` (SDP and ICE) only between two members who are both in the channel. Audio is a peer-to-peer WebRTC mesh (`client/src/lib/voice.ts`). The member with the smaller id always sends the offer, so two peers never offer at once.
- **Lobby song.** `lobbyTrack: { source, startedAt }`. Every client plays it with the regular player adapters (YouTube audio-only, or a file) at `(serverNow − startedAt) mod duration`, re-aligning past `LOBBY_TRACK.driftToleranceMs`, so the loop is in sync without any further messages.
- **Screen share.** `screenShare: { memberId }`, one sharer at a time; starting a share pauses the room video. Media is one-to-many WebRTC from the sharer (`client/src/lib/screenShare.ts`). Viewers send a `want` signal whenever they see a share they aren't receiving (start, late join, reconnect, failed link), and the sharer answers each with a fresh offer, so every join order goes through one path. The server relays `screen:signal` only between the sharer and someone else in the room, and ends the share if the sharer leaves.
- **Speed.** A `rate` command re-anchors `position` at the current moment, so the timeline stays continuous. The drift engine multiplies its correction on top of the room rate.
- **Streaming services.** `MediaKind 'external'` with a `provider`. `ExternalPlayer` is a virtual clock that implements `PlayerAdapter`, so the sync engine, pause votes, speed and clips work unchanged.

## Server structure

- `features/*.ts`: each exports a `Feature` with `register(socket, ctx)`. `features/index.ts` lists them.
- `features/helpers.ts`: `onMember()` resolves the room and member, applies the rate limit, and converts thrown `RoomError`s into ack errors. Feature files stay one-liners.
- `rooms/Room.ts`: all state and rules, with no sockets or timers. It talks out through a `RoomEmitter` interface, which is why it is easy to unit-test.
- `rooms/RoomManager.ts`: room creation, the reconnect grace timers, empty-room cleanup, and batched stats broadcasts.

State updates use a small number of event types. Persistent state goes out as `room:patch` (a partial `RoomSnapshot` that clients shallow-merge). Playback has its own `playback:state` event because it is latency-critical and carries origin info. Chat and reactions are append-only events.

## Client structure

- `lib/session.ts`: `RoomSession` owns the socket, clock and store, and exposes actions (`play()`, `sendChat()`, …).
- `lib/store.ts`: a tiny observable store read with `useSyncExternalStore`. `lib/context.tsx` provides the `useRoom(selector)`, `useClient(selector)` and `useMe()` hooks.
- `lib/syncEngine.ts`: framework-agnostic sync loop around a `PlayerAdapter`.
- `players/`: `Html5Player` and `YouTubePlayer` implement `PlayerAdapter`, and `players/index.ts` maps media kind to adapter.
- `features/`: sidebar panels, registered in `features/index.ts`.
