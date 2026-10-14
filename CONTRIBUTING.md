# Contributing

npm workspaces monorepo: `shared/` (protocol types, config, pure helpers), `server/` (Express + Socket.IO), `client/` (React + Vite).

- Check changes with `npm run typecheck && npm test`. Use `npm run bench` against a running server for latency. For UI changes also run `npm run design:check` (Impeccable anti-pattern scan).
- Wire protocol: `shared/src/protocol.ts` is the single source of truth for events and payloads.
- Server features are one file each in `server/src/features/`, registered in `features/index.ts`. Use `onMember()` from `helpers.ts`.
- Room rules belong in `server/src/rooms/Room.ts`, which has no sockets or timers. Add tests in `server/test/room.test.ts`.
- Persistent state goes to clients through `emit.patch(...)`, which the client merges automatically.
- Client actions live on `RoomSession` (`client/src/lib/session.ts`). Sidebar panels go in `client/src/features/`, registered in `features/index.ts`.
- Sync tunables and feature knobs (clips, lobby, lo-fi, voice, pause votes, buffering, subtitles) live in `shared/src/config.ts`. Don't hard-code thresholds.
- Theme tokens are at the top of `client/src/styles.css`. Separate with space and tonal fills, not borders or shadows (the Brutal theme block is the exception).
- See [docs/EXTENDING.md](docs/EXTENDING.md) for recipes.
