# Watch Party

A real-time watch-party app: create a room, share the link, and everyone watches the same video in sync, frame for frame. It has chat and voice, emoji reactions, a voted playlist, group polls, a pre-show lobby with a countdown, lo-fi music and a trailer vote, clips of the last 15–90 seconds, and a movie catalog with fuzzy search.

Built for the VinnovateIT Round 1 web-development task ("Watch Party").

| Requirement | Where it lives |
| --- | --- |
| Create/join rooms by invite link or code | `POST /api/rooms`, `server/src/features/room.ts`, `client/src/pages/Home.tsx` |
| Sync play / pause / seek | `server/src/rooms/Room.ts` (`applyCommand`), `client/src/lib/syncEngine.ts` |
| Movie recommendations, categories, filters, fuzzy search | `server/src/catalog/movies.json`, `client/src/features/DiscoverPanel.tsx`, `shared/src/catalog.ts` (`recommend`) |
| Emoji reactions, live chat, shared playlist, polls, host transfer | `client/src/features/*Panel.tsx`, `server/src/features/*.ts` |
| Automatic drift detection and correction | `client/src/lib/syncEngine.ts`, tuned in `shared/src/config.ts` |
| Late joins, reconnections, concurrent actions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#reliability) |
| ≥ 10 users/room, ≤ 250 ms p95 propagation, ≤ 500 ms drift | [docs/LATENCY.md](docs/LATENCY.md): measured **p95 3.1 ms** (12 clients), **< 20 ms** drift once corrected (under one frame at 30 fps); worst case 67 ms seconds after a reconnect |

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev          # server on :3001, client on http://localhost:5173
```

Open http://localhost:5173, create a room, and open the invite link in another browser or on your phone. The dev server listens on your LAN IP too.

Production (one port, the server serves the built client):

```bash
npm run build
npm start            # http://localhost:3001
```

## Deploy

One web service, one HTTPS URL. Easiest: on [Render](https://render.com) choose **New → Blueprint** and pick this repo (`render.yaml` does the rest). A `Dockerfile` covers Fly.io, Railway, Cloud Run or a VPS. For voice and screen share across the internet, add a TURN relay with `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL`. Full steps: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Features

**Playback**
- **Frame-accurate sync** for YouTube links and direct video files (MP4/WebM). The server owns one timeline and every client follows it with a clock-synced position. For video files, drift is measured against the frame actually on screen (`requestVideoFrameCallback`), median-filtered, and corrected by small speed changes until it is under one frame. Paused players snap to the same frame. Seeks learn how long they take and land ahead to compensate.
- **Anyone can pause** by default, and whoever paused can resume. The host can switch to **pause by vote**: viewers ask, and the room pauses once half of the present (non-AFK) viewers agree.
- **Auto-buffer catching**: if someone's player stalls for over a second, the room pauses with a "Waiting for Sam to catch up" banner and resumes from the same spot when they recover. It gives up after 12 s, after which the stalled viewer catches up by seeking.
- **Sync to host**: a viewer can lock to where the host's player actually is, not just the room clock.
- **Playback speed** 0.5×–2× for everyone (controllers only), with the timeline kept continuous.
- **Streaming services (companion mode)**: paste a Netflix, Prime Video, JioHotstar or ZEE5 link. These services use DRM and block embedding and remote control, so no website can play them inside another page. Instead the room shows a large synced timecode with an "Open in …" link (Netflix opens at the current second), and each viewer plays the title in their own account. Pause, resume, seek and speed cues still come from the room.

**Together**
- **Pre-show lobby**: new rooms open on a landing screen with generated lo-fi music (Web Audio, no files; vinyl crackle optional, off by default), who's settled in, and a host countdown (1/3/5/10 min). The video preloads paused underneath, and when the countdown hits zero everyone starts on the same frame. The host can reopen it any time as an **Intermission**.
- **Lobby song queue**: anyone pastes a YouTube link or audio file URL. Songs play in order for everyone, in sync on the shared clock, and the last one repeats until someone adds more. The host or whoever added a song can skip or remove it; "Back to lo-fi" (host) clears the queue.
- **Screen share**: share a screen, window or tab (peer-to-peer WebRTC, up to 720p). It replaces the video for everyone and pauses the room video underneath. Late joiners pick it up automatically, and the host can end anyone's share or restrict sharing to the host. DRM services (Netflix etc.) show black when shared; that's the browser, not the app. Tab audio is shared on Chrome/Edge; whole-screen audio only on Windows.
- **Trailer vote**: the host shortlists up to 3 trailers (catalog titles or links). Everyone can preview them locally inside the lobby and vote, and the winner is loaded for the show.
- **Clips**: save the last 15, 30, 60 or 90 s with one click (or `C`). Everyone can rewatch a clip in a local preview, controllers can replay it for the room, and video files can be downloaded as WebM when the host allows CORS.
- **Voice chat**: peer-to-peer WebRTC audio (mesh, up to 12 people) with mute and speaking indicators. Text chat with system messages.
- **AFK**: "Away" switch, or automatic after 30 s with the tab hidden. The avatar dims with an AFK tag, and the host sees "2 away" in the header. AFK viewers aren't counted in pause votes and never trigger buffer holds.
- **Focus mode** (`F`): blacks out everything except the video and the chat sidebar.
- Emoji reactions that float over the video, a voted playlist, polls, host transfer, and Discover with categories, genre filter, sorting, fuzzy search and recommendations (the catalog is free open movies from the Blender Studio; add your own in `server/src/catalog/movies.json`).

**Look and feel**
- Light and dark themes (remembers your choice, defaults to the OS setting), responsive down to phone width, Satoshi type, separation by space and tone rather than borders, no glow or gradients. `npm run design:check` runs [Impeccable](https://impeccable.style)'s anti-pattern detector, and CI runs it too. Impeccable is also installed as a Claude Code skill with hooks that check UI edits in real time.

**Reliability**: reconnects keep your seat, identity, voice and AFK state for 30 s. Late joiners land at the live position, autoplay blocks get a "click to join playback" button, and simultaneous commands are serialised and versioned so everyone converges on the same state.

**Keyboard**: `Space` play/pause (or ask to pause), `←`/`→` seek ±10 s, `C` clip, `M` mute, `F` focus mode, `Esc` leave focus.

## Project layout

```
shared/   Types and logic used by both sides (protocol, config, playback math, recommendations)
server/   Express + Socket.IO. One file per feature in src/features, room rules in src/rooms/Room.ts
client/   React + Vite. Sidebar panels in src/features, player adapters in src/players
scripts/  latency-bench.ts (load and latency test), e2e-sync.mjs (real-browser sync test)
docs/     Architecture, how to extend, latency report
```

## Making changes

The code is laid out so most changes touch one obvious place. See **[docs/EXTENDING.md](docs/EXTENDING.md)** for step-by-step recipes. In short:

| I want to… | Edit |
| --- | --- |
| Tune sync thresholds or room limits | `shared/src/config.ts` |
| Change server settings (port, grace period, capacity) | `server/src/config.ts` or env vars |
| Add or edit movies | `server/src/catalog/movies.json` |
| Change the look | CSS variables at the top of `client/src/styles.css` |
| Tune clips, lobby, music, voice, pause votes, buffering | `shared/src/config.ts` (see the table in [docs/EXTENDING.md](docs/EXTENDING.md#customise-at-a-glance)) |
| Add a sidebar tab | New component in `client/src/features/` + one line in `client/src/features/index.ts` |
| Add a socket event / feature | `shared/src/protocol.ts` → `server/src/features/` → `client/src/lib/session.ts` |
| Support a new video provider | `shared/src/media.ts` + an adapter in `client/src/players/` |
| Change room rules (permissions, voting, polls) | `server/src/rooms/Room.ts` (unit-tested in `server/test/room.test.ts`) |

Because client and server share `shared/src/protocol.ts`, renaming an event or changing a payload shows up as a type error on both sides.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (auto-reload) and client (HMR) together |
| `npm run build` / `npm start` | Production build and single-port server |
| `npm run typecheck` | TypeScript check for all three packages |
| `npm test` | Unit tests for room logic (Vitest) |
| `npm run bench -- --clients 12` | Control-propagation latency and concurrency test against a running server |
| `npm run e2e` | Real-browser sync test with Playwright (see header of `scripts/e2e-sync.mjs`) |
| `npm run design:check` | Impeccable UI anti-pattern scan of the client |

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Allowed origins (comma-separated) when the client is hosted elsewhere |
| `RECONNECT_GRACE_MS` | `30000` | How long a dropped member keeps their seat |
| `EMPTY_ROOM_TTL_MS` | `600000` | When an empty room is deleted |
| `MAX_MEMBERS` | `50` | Room capacity |
| `VITE_SERVER_URL` | same origin | Client: server URL if hosted separately |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | unset | TURN relay for voice/screen share across the internet (comma-separate several URLs) |
| `ICE_SERVERS` | unset | JSON array of `RTCIceServer` objects; replaces the default STUN/TURN list |
