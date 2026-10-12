import { createContext, useContext } from 'react';
import type { RoomSnapshot } from '@watch-party/shared';
import type { RoomSession } from './session';
import { useStore, type ClientState } from './store';

export const SessionContext = createContext<RoomSession | null>(null);

export function useSession(): RoomSession {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside a room');
  return s;
}

/** Subscribe to a slice of client state. Keep selectors cheap and stable. */
export function useClient<S>(selector: (s: ClientState) => S): S {
  return useStore(useSession().store, selector);
}

/** Subscribe to a slice of the room snapshot (only valid once joined). */
export function useRoom<S>(selector: (r: RoomSnapshot) => S): S {
  return useClient((s) => selector(s.room!));
}

/** Common derived values most panels need. */
export function useMe() {
  const memberId = useClient((s) => s.memberId);
  const hostId = useRoom((r) => r.hostId);
  const controlMode = useRoom((r) => r.settings.controlMode);
  const isHost = !!memberId && memberId === hostId;
  return { memberId, isHost, canControl: isHost || controlMode === 'everyone' };
}
