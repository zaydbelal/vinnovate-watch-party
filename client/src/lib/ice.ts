import { VOICE, type RTCIceServerLike } from '@watch-party/shared';

const base = import.meta.env.VITE_SERVER_URL ?? '';
let servers: RTCIceServerLike[] = [...VOICE.iceServers];
let loaded: Promise<void> | null = null;

/**
 * Fetch the server's STUN/TURN list once (it may include TURN credentials
 * set by the deployment). Falls back to VOICE.iceServers.
 */
export function loadIceServers(): Promise<void> {
  loaded ??= fetch(`${base}/api/ice`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (Array.isArray(d?.iceServers) && d.iceServers.length) servers = d.iceServers;
    })
    .catch(() => {});
  return loaded;
}

export function iceServers(): RTCIceServerLike[] {
  return servers;
}
