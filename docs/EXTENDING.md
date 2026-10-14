# Making changes

Recipes for the most common changes. After any change run:

```bash
npm run typecheck && npm test
npm run design:check   # Impeccable: flags common AI-design anti-patterns in the UI
```

Impeccable is also installed as a Claude Code skill (`.claude/skills/impeccable`, from `npx impeccable install`). Its hooks in `.claude/settings.json` check UI files after every edit and do a deeper pass when Claude finishes a turn, so anti-patterns are caught as they're written. In Claude Code, `/impeccable` lists its design commands. The engine binary is gitignored; the launcher downloads the right one for your OS on first use.

## Customise at a glance

Almost every knob lives in one of three places. Change the value, save, done.

| What | Where | Key |
| --- | --- | --- |
| Colours, fonts, type sizes, spacing, radius, sidebar width | `client/src/styles.css` (top of file) | `--accent`, `--font`, `--fs-*`, `--space-*`, `--radius`, `--sidebar-width`; dark mode overrides in `:root[data-theme='dark']` |
| Font files | `client/public/fonts` + `@font-face` at the top of `client/src/styles.css` | Satoshi woff2 files are self-hosted. To change face, replace the files and `@font-face` rules, update `--font`, and update the preloads in `client/index.html` |
| Sync tightness | `shared/src/config.ts` | `SYNC.*` (drift tolerance/target, paused frame tolerance, check interval, smoothing) |
| Speed menu | `shared/src/config.ts` | `PLAYBACK_RATES` |
| Wait-for-buffering behaviour | `shared/src/config.ts` | `BUFFERING.reportAfterMs`, `maxHoldMs`, `cooldownMs` |
| Pause vote share and expiry | `shared/src/config.ts` | `PAUSE_VOTE.share` (0.5 = half), `ttlMs` |
| When someone counts as AFK | `shared/src/config.ts` | `PRESENCE.hiddenAfkMs` |
| Clip lengths | `shared/src/config.ts` | `CLIPS.lengths`, `minSec`, `maxSec`, `maxPerRoom` |
| Lobby countdown presets, open-on-create | `shared/src/config.ts` | `LOBBY.countdownPresets`, `openOnCreate` |
| Lo-fi music tempo, volume, chords | `shared/src/config.ts` | `LOFI.bpm`, `volume`, `progression` (sound design in `client/src/lib/lofi.ts`) |
| Trailer vote size, preview length | `shared/src/config.ts` | `TRAILERS.*` |
| Voice: STUN/TURN servers, max people, speaking sensitivity | `shared/src/config.ts` | `VOICE.iceServers`, `maxParticipants`, `speakingThreshold` |
| Default room rules (who controls, pause policy, buffering) | `server/src/rooms/Room.ts` | `settings = { controlMode, pausePolicy, waitForBuffering }` |
| Streaming services | `shared/src/media.ts` | `STREAMING_PROVIDERS` (name + hostnames) |
| Reaction emojis | `shared/src/config.ts` | `REACTION_EMOJIS` |
| Sidebar tabs and their order | `client/src/features/index.ts` | `panels` |
| Server port, reconnect grace, capacity | `server/src/config.ts` or env vars | `PORT`, `RECONNECT_GRACE_MS`, `MAX_MEMBERS` |

## Tune sync behaviour or limits

Everything is in `shared/src/config.ts`:

- `SYNC.driftToleranceMs`, `driftTargetMs`, `hardSeekThresholdMs`, `maxRateAdjust`: how tightly and how aggressively clients correct.
- `SYNC.driftCheckIntervalMs`: how often drift is checked.
- `LIMITS.*`: room size, chat history, poll options, playlist length.

Server-only settings (port, reconnect grace, capacity, rate limit) are in `server/src/config.ts` and can be overridden with environment variables.

## Add movies to Discover

Append an entry to `server/src/catalog/movies.json`:

```json
{
  "id": "my-movie",
  "title": "My Movie",
  "year": 2024,
  "genres": ["Comedy"],
  "categories": ["Family Night"],
  "rating": 7.1,
  "durationMin": 12,
  "description": "One line shown on hover.",
  "thumbnail": "https://…/poster.jpg",
  "source": { "kind": "youtube", "url": "VIDEO_ID" }
}
```

`source.kind` is `youtube` (url = the 11-character video id) or `html5` (url = a direct `.mp4`/`.webm` link). New genres and categories show up as filters automatically. To change how recommendations are scored, edit `recommend()` in `shared/src/catalog.ts`. Search weighting is `FUSE_OPTIONS` in `client/src/features/DiscoverPanel.tsx`.

## Add a sidebar tab

1. Create `client/src/features/MyPanel.tsx`:

   ```tsx
   import { useRoom, useSession } from '../lib/context';

   export function MyPanel() {
     const session = useSession();
     const members = useRoom((r) => r.members);
     return <div>{members.length} people here</div>;
   }
   ```

2. Register it in `client/src/features/index.ts`:

   ```ts
   { id: 'mine', label: '✨ Mine', component: MyPanel },
   ```

Hooks available in panels: `useRoom(selector)` (room snapshot), `useClient(selector)` (connection status, sync stats, reactions), `useMe()` (`memberId`, `isHost`, `canControl`), and `useSession()` (actions). Selectors should return existing objects or primitives, not freshly built arrays, otherwise React re-renders forever.

## Add a real-time feature end to end

Worked example: a host-editable **room topic** that everyone sees.

**1. Protocol** (`shared/src/protocol.ts`): add the state and the event.

```ts
export interface RoomSnapshot {
  // …
  topic: string;
}

export interface ClientToServerEvents {
  // …
  'topic:set': (payload: { topic: string }, ack?: Ack) => void;
}
```

`npm run typecheck` now lists every place that needs updating.

**2. Rules** (`server/src/rooms/Room.ts`): state, a method, and the snapshot field.

```ts
topic = '';

setTopic(byId: string, topic: string): void {
  if (this.hostId !== byId) throw new RoomError('Only the host can set the topic');
  this.topic = String(topic ?? '').trim().slice(0, 120);
  this.emit.patch({ topic: this.topic }); // clients merge this automatically
}

// in snapshot(): topic: this.topic,
```

Add a test in `server/test/room.test.ts`.

**3. Socket handler**: create `server/src/features/topic.ts`:

```ts
import type { Feature } from '../types';
import { onMember } from './helpers';

export const topicFeature: Feature = {
  name: 'topic',
  register(socket, ctx) {
    onMember(socket, ctx, 'topic:set', ({ room, member }, { topic }) => room.setTopic(member.id, topic));
  },
};
```

Add `topicFeature` to the list in `server/src/features/index.ts`. `onMember` handles room lookup, error acks and (with `{ rateLimited: true }`) spam protection.

**4. Client action** (`client/src/lib/session.ts`):

```ts
setTopic = (topic: string) => this.call('topic:set', { topic });
```

**5. UI**: read it anywhere with `useRoom((r) => r.topic)` and call `session.setTopic(...)`.

No client event handler is needed. Anything sent through `emit.patch` is merged into the store by `RoomSession`. Ephemeral events (like reactions) instead need a `ServerToClientEvents` entry and a `socket.on` in `RoomSession.start()`.

## Add a streaming service (companion mode)

DRM services can't be embedded, so they share one `external` player: a synced virtual clock with an "Open in …" link. To add one, append it to `STREAMING_PROVIDERS` in `shared/src/media.ts` and to the `StreamingProvider` type in `shared/src/protocol.ts`. If the service supports a start-time URL parameter, add it to `streamingDeepLink()`.

## Support another video provider

1. `shared/src/protocol.ts`: add the kind to `MediaKind`.
2. `shared/src/media.ts`: recognise its URLs in `parseMediaUrl`.
3. `client/src/players/`: implement `PlayerAdapter` (see `html5.ts` for the simplest one). Set `fineRate` to `false` if the player can't do small speed changes; the sync engine will then correct by seeking. `isBuffering()` drives auto-buffer catching.
4. `client/src/players/index.ts`: register it in `playerFactories`.
5. `server/src/rooms/Room.ts` `cleanSource()`: allow the new kind.

## Change permissions or room rules

All rules (who can control playback, remove items, close polls, how the next video is picked) are methods on `Room` in `server/src/rooms/Room.ts`. They throw `RoomError('message')` to reject an action, and the message appears as a toast for that user.

## Restyle

All colours, type sizes, spacing and radius are CSS variables at the top of `client/src/styles.css`; dark mode only overrides the colour tokens. House rules the current design follows (and `npm run design:check` helps enforce): separate things with space and tonal fills rather than borders, no heavy shadows or glow, no purple/blue gradients, one accent colour, and words instead of an icon on every list item.
