import { SYNC } from '@watch-party/shared';
import type { AppSocket } from './socket';

interface Sample {
  rtt: number;
  offset: number;
}

/**
 * Estimates (server clock - local clock) NTP-style. We keep a sliding window
 * of samples and trust the one with the lowest RTT, since it has the least
 * asymmetric-delay error.
 */
export class ClockSync {
  private samples: Sample[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly socket: AppSocket) {}

  get offsetMs(): number {
    return this.best()?.offset ?? 0;
  }

  get rttMs(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].rtt : 0;
  }

  /** Current time on the server's clock (ms). */
  serverNow(): number {
    return Date.now() + this.offsetMs;
  }

  async start(): Promise<void> {
    this.stop();
    for (let i = 0; i < SYNC.clockInitialSamples; i++) await this.sample();
    this.timer = setInterval(() => void this.sample(), SYNC.clockResyncIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private sample(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.socket.connected) return resolve();
      const t0 = Date.now();
      const timeout = setTimeout(resolve, 3000);
      this.socket.emit('clock:ping', t0, (serverTime) => {
        clearTimeout(timeout);
        const t1 = Date.now();
        const rtt = t1 - t0;
        this.samples.push({ rtt, offset: serverTime + rtt / 2 - t1 });
        if (this.samples.length > 10) this.samples.shift();
        resolve();
      });
    });
  }

  private best(): Sample | undefined {
    return this.samples.reduce<Sample | undefined>((b, s) => (!b || s.rtt < b.rtt ? s : b), undefined);
  }
}
