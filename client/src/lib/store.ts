import { useSyncExternalStore } from 'react';
import type { Reaction, RoomSnapshot } from '@watch-party/shared';
import type { VoiceState } from './voice';

export type ConnectionStatus = 'connecting' | 'joined' | 'reconnecting' | 'error';

export interface SyncStats {
  offsetMs: number;
  rttMs: number;
  driftMs: number;
  lastControlLatencyMs: number | null;
}

export interface ClientState {
  status: ConnectionStatus;
  error: string | null;
  memberId: string | null;
  room: RoomSnapshot | null;
  /** Reactions currently floating over the video. */
  reactions: Reaction[];
  sync: SyncStats;
  /** Transient toast messages. */
  notices: { id: number; level: 'info' | 'error'; text: string }[];
  voice: VoiceState;
  /** Why you're AFK: pressed "Step away", or your tab has been hidden. */
  away: { manual: boolean; auto: boolean };
  /** Follow the host's actual player instead of the room timeline. */
  lockToHost: boolean;
}

type Listener = () => void;

/** Tiny observable store; components read it with `useRoomStore(selector)`. */
export class Store<T> {
  private listeners = new Set<Listener>();
  constructor(private state: T) {}
  get = () => this.state;
  set = (update: Partial<T> | ((s: T) => Partial<T>)) => {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
}

export function initialState(): ClientState {
  return {
    status: 'connecting',
    error: null,
    memberId: null,
    room: null,
    reactions: [],
    sync: { offsetMs: 0, rttMs: 0, driftMs: 0, lastControlLatencyMs: null },
    notices: [],
    voice: { joined: false, muted: false, speaking: [] },
    away: { manual: false, auto: false },
    lockToHost: false,
  };
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
