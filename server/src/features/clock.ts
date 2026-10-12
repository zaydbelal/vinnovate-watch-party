import type { Feature } from '../types';

/** NTP-style clock sync: the client measures RTT and offset from this. */
export const clockFeature: Feature = {
  name: 'clock',
  register(socket) {
    socket.on('clock:ping', (_clientTime, ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });
  },
};
