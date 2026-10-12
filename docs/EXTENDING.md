# Making changes

Recipes for the most common changes. After any change run:

```bash
npm run typecheck && npm test
```

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

## Support another video provider

1. `shared/src/protocol.ts`: add the kind to `MediaKind`.
2. `shared/src/media.ts`: recognise its URLs in `parseMediaUrl`.
3. `client/src/players/`: implement `PlayerAdapter` (see `html5.ts` for the simplest one). Set `fineRate` to `false` if the player can't do small speed changes; the sync engine will then correct by seeking.
4. `client/src/players/index.ts`: register it in `playerFactories`.
5. `server/src/rooms/Room.ts` `makeItem()`: allow the new kind.

## Change permissions or room rules

All rules (who can control playback, remove items, close polls, how the next video is picked) are methods on `Room` in `server/src/rooms/Room.ts`. They throw `RoomError('message')` to reject an action, and the message appears as a toast for that user.

## Restyle

Colours, radius and sidebar width are CSS variables at the top of `client/src/styles.css`.
