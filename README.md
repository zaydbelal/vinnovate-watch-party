# 🍿 Watch Party

A real-time watch-party app: create a room, share the link, and everyone watches the same video in sync, with live chat, emoji reactions, a voted playlist, group polls, host transfer and a movie catalog with fuzzy search.

Built for the VinnovateIT Round 1 web-development task ("Watch Party").

| Requirement | Where it lives |
| --- | --- |
| Create/join rooms by invite link or code | `POST /api/rooms`, `server/src/features/room.ts`, `client/src/pages/Home.tsx` |
| Sync play / pause / seek | `server/src/rooms/Room.ts` (`applyCommand`), `client/src/lib/syncEngine.ts` |
| Movie recommendations, categories, filters, fuzzy search | `server/src/catalog/movies.json`, `client/src/features/DiscoverPanel.tsx`, `shared/src/catalog.ts` (`recommend`) |
| Emoji reactions, live chat, shared playlist, polls, host transfer | `client/src/features/*Panel.tsx`, `server/src/features/*.ts` |
| Automatic drift detection and correction | `client/src/lib/syncEngine.ts`, tuned in `shared/src/config.ts` |
| Late joins, reconnections, concurrent actions | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#reliability) |
| ≥ 10 users/room, ≤ 250 ms p95 propagation, ≤ 500 ms drift | [docs/LATENCY.md](docs/LATENCY.md): measured **p95 2.5 ms** (12 clients) and **≤ 70 ms** steady-state drift |

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

## Features

- **Rooms**: 6-character codes (no look-alike characters), shareable `/r/CODE` links, name prompt for invitees, up to 50 people per room (configurable).
- **Synchronized playback** for YouTube links and direct video files (MP4/WebM). The server owns one timeline; every client follows it using a clock-synced position, so there is no "follow the host's player" lag.
- **Drift correction**: small drift is fixed by gently changing playback speed (no visible jump), large drift by seeking. Every member's drift, RTT and control latency is shown live in the People tab.
- **Discover**: catalog with shelves (categories), genre, length, source and rating filters, sorting, typo-tolerant fuzzy search (Fuse.js), and "Recommended for this room" based on what the room has watched and queued.
- **Shared playlist**: anyone can queue a video, everyone can up-vote, and the most-voted item plays next when the current one ends. One click turns the queue into a "what next?" poll, and the winner jumps the queue.
- **Live chat** with system messages (joins, host changes, now playing) and **emoji reactions** that float over the video with the sender's name.
- **Polls**: up to 6 options, one vote per person (click again to change your vote), live bars, closed by the creator or host.
- **Host controls**: transfer host, or let everyone control playback. If the host drops out, the longest-present member takes over automatically.
- **Reliability**: reconnects keep your seat and identity for 30 s, late joiners land at the live position, autoplay blocks get a "click to join playback" button, and simultaneous commands from several people are serialised and versioned so everyone converges on the same state.
- Keyboard: `Space` play/pause, `←`/`→` seek ±10 s.

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

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Server port |
| `CORS_ORIGIN` | `*` | Allowed origins (comma-separated) when the client is hosted elsewhere |
| `RECONNECT_GRACE_MS` | `30000` | How long a dropped member keeps their seat |
| `EMPTY_ROOM_TTL_MS` | `600000` | When an empty room is deleted |
| `MAX_MEMBERS` | `50` | Room capacity |
| `VITE_SERVER_URL` | same origin | Client: server URL if hosted separately |
