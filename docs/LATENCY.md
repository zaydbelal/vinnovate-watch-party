# Latency & sync measurements

| Constraint | Target | Measured | How |
| --- | --- | --- | --- |
| Concurrent users per room | ≥ 10 | 10, 12, 25 and 50 clients tested; capacity 50 (configurable) | `npm run bench` |
| Playback control propagation, p95 | ≤ 250 ms | **2.5–3.0 ms** (10–50 clients) | `npm run bench` |
| Playback drift after correction | ≤ 500 ms | **≤ 70 ms** spread between browsers; 3 s desync corrected in < 0.3 s, 0.4 s desync in ~4 s | `npm run e2e` |
| Concurrent conflicting actions | consistent state | 20/20 rounds converged (all clients at an identical version and position) | `npm run bench` |

## Test conditions

- **Machine:** 4 vCPU Intel Xeon @ 2.8 GHz, 15 GB RAM, Linux. The server and all clients ran on the same host over loopback, which stands in for a local network (sub-millisecond RTT).
- **Software:** Node 22, Socket.IO 4.8 (WebSocket transport only, no long-polling), Chromium 141 (headless, `--autoplay-policy=no-user-gesture-required`), production client build served by the Node server.
- **Date:** 2026-10-12.
- Clock offsets are measured, not assumed: in the browser test every tab runs `ClockSync` the same way it would on separate devices.

Loopback understates real LAN latency, so the margins matter more than the absolute numbers. On a typical Wi-Fi LAN (2–10 ms RTT), propagation adds roughly one one-way trip per hop (client → server → clients), which still leaves a margin of more than 10× against the 250 ms target. To reproduce on a real network, run the server on one machine and point the bench at it from another: `npm run bench -- --url http://<server-lan-ip>:3001`.

## 1. Control propagation (`scripts/latency-bench.ts`)

**Method:** N Socket.IO clients join one room. The host sends a play/pause/seek command, and we record the time from emitting the command to each client receiving the resulting `playback:state` broadcast. All clients are in one process, so there is no clock-sync error in this number. Commands are 50 ms apart, cycling pause → seek → play → seek.

| Clients | Commands | Samples | p50 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 300 | 3 000 | 1.6 ms | 2.8 ms | 4.4 ms | 10.5 ms |
| 12 | 300 | 3 600 | 1.4 ms | 2.5 ms | 4.1 ms | 9.1 ms |
| 25 | 300 | 7 500 | 1.7 ms | 2.9 ms | 5.0 ms | 9.0 ms |
| 50 | 200 | 10 000 | 1.8 ms | 3.0 ms | 3.9 ms | 6.0 ms |

Latency stays almost flat as rooms grow, because a broadcast is a single Socket.IO room emit.

**Concurrency phase:** with "everyone can control" enabled, all N clients send a play/pause/seek **at the same instant**, 20 rounds in a row. After each round we check that every client holds the identical `version`, `playing` and `position`. Result: 20/20 rounds converged for every N.

In-app, every client also measures `serverNow − issuedAt` for each command it receives and reports it. `GET /api/metrics` returns p50/p95 per room. During the browser test it showed p50 3 ms and p95 8–13 ms (this includes clock-sync estimation error).

## 2. Drift and correction (`scripts/e2e-sync.mjs`)

**Method:** three real Chromium tabs, each with its own browser context and clock sync, join a room and play a 2-minute WebM clip. At each step we read every tab's `video.currentTime` together with `Date.now()`, normalise them to the same instant, and report the spread (max − min) between tabs.

Representative run:

```
playing (4 s)                spread     5 ms
paused                       spread     1 ms
seek +10 s while paused      spread     1 ms
resumed                      spread     3 ms
artificial desync            spread   182 ms   ← Bob +3 s (already re-seeked), Cara +0.4 s
  1 s later                  spread   265 ms   ← Cara at 0.92x, Bob settling after seek
  2 s later                  spread   161 ms
  3 s later                  spread    89 ms
  4 s later                  spread    40 ms
  5 s later                  spread    34 ms
  6 s later                  spread    35 ms
Cara reloaded (reconnect)    spread    55 ms
Dan joined late              spread    69 ms
PASS: worst steady-state spread 69 ms (target ≤ 500 ms)
```

- **Large drift (+3 s):** detected within one 500 ms check and corrected by seeking. It was already back within ~200 ms by the next sample (300 ms later).
- **Small drift (+0.4 s):** corrected without a visible jump by playing at 0.92x, then back to 1.0x once under 25 ms. It converged in about 4 s.
- **Reconnect (page reload)** and **late join:** the new client lands within 55–70 ms of the others on its first frame.
- **Steady state:** each client keeps its own drift under the 100 ms correction threshold. `/api/metrics` reported per-client drift p50 22 ms and p95 29 ms during playback.

YouTube embeds can't do fine speed changes, so they correct by seeking once drift exceeds 350 ms (`SYNC.coarseSeekThresholdMs`). That bounds YouTube drift at about 350 ms plus one check interval, still within 500 ms.

## 3. Failure handling (tested behaviour)

| Failure | Behaviour | Verified by |
| --- | --- | --- |
| Client refreshes or loses connection | Same member restored via session id; snapshot resyncs within 55 ms | e2e "Cara reloaded" |
| Late joiner | Snapshot + clock sync before first frame; within 70 ms | e2e "Dan joined late" |
| Host disconnects or leaves | Host passes to the longest-present member | `room.test.ts` |
| Simultaneous commands | Serialised, versioned, no-ops dropped, all clients converge | bench concurrency phase, `room.test.ts` |
| Command for a replaced video | Dropped as stale | `room.test.ts` |
| Several clients report "ended" | Playlist advances exactly once | `room.test.ts` |
| Guest tries to control in host mode | Rejected with a toast; playback unaffected | e2e, `room.test.ts` |
| Browser blocks autoplay | "Click to join playback" overlay, then resumes in sync | manual |
| Video fails to load | Error toast; room state unaffected | manual |
| Room full | Join rejected with a clear message | `room.test.ts` |
| Message flood | Per-socket token bucket (10 burst, 4/s) | code: `features/helpers.ts` |

## Reproducing

```bash
npm install && npm run build && npm start        # terminal 1

npm run bench -- --clients 12 --commands 300     # terminal 2; writes bench-results.json

# Browser test (needs Chromium for Playwright: npx playwright install chromium)
ffmpeg -f lavfi -i testsrc=duration=120:size=640x360:rate=30 -c:v libvpx-vp9 -b:v 500k client/dist/test.webm
npm run e2e
```
