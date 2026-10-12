/**
 * Measures playback-control propagation latency and concurrent-action
 * convergence against a running server.
 *
 *   npm start            # or npm run dev -w server
 *   npm run bench -- --clients 12 --commands 300 --url http://localhost:3001
 *
 * All simulated clients live in this process, so they share one clock and
 * latency is measured directly (command emitted -> state received), with no
 * clock-sync error. Results are printed and written to bench-results.json.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';
import { percentile, type ClientToServerEvents, type PlaybackBroadcast, type ServerToClientEvents } from '@watch-party/shared';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const URL = args.url ?? 'http://localhost:3001';
const CLIENTS = Number(args.clients ?? 12);
const COMMANDS = Number(args.commands ?? 300);
const GAP_MS = Number(args.gap ?? 50);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(code: string, name: string): Promise<{ socket: Client; memberId: string }> {
  const socket: Client = io(URL, { transports: ['websocket'], forceNew: true });
  await new Promise<void>((res, rej) => {
    socket.once('connect', () => res());
    socket.once('connect_error', rej);
  });
  const joined = await new Promise<Parameters<Parameters<ClientToServerEvents['room:join']>[1]>[0]>((res) =>
    socket.emit('room:join', { code, name }, res),
  );
  if (!joined.ok) throw new Error(joined.error);
  return { socket, memberId: joined.memberId };
}

async function main() {
  const res = await fetch(`${URL}/api/rooms`, { method: 'POST' });
  const { code } = (await res.json()) as { code: string };
  console.log(`Room ${code}: connecting ${CLIENTS} clients…`);

  // The first member to join becomes host, so connect it before the rest.
  const first = await connect(code, 'bench-host');
  const clients = [first, ...(await Promise.all(Array.from({ length: CLIENTS - 1 }, (_, i) => connect(code, `bench-${i + 1}`))))];
  const host = clients[0].socket;

  // Track every playback broadcast each client receives.
  let latestVersion = 0;
  const pending = new Map<number, { sentAt: number; received: number[] }>(); // keyed by expected version
  const finalStates: PlaybackBroadcast['state'][] = Array(CLIENTS);
  clients.forEach(({ socket }, idx) =>
    socket.on('playback:state', (b) => {
      const now = performance.now();
      finalStates[idx] = b.state;
      pending.get(b.state.version)?.received.push(now);
    }),
  );

  const send = (socket: Client, cmd: Parameters<ClientToServerEvents['playback:command']>[0]) =>
    new Promise<{ ok: boolean; error?: string }>((r) => socket.emit('playback:command', cmd, r));

  // Load a video so play/pause/seek are valid.
  const loaded = await send(host, {
    action: 'load',
    media: { title: 'Bench', source: { kind: 'html5', url: 'https://example.com/bench.mp4' }, durationSec: 3600 },
    baseVersion: 0,
    issuedAt: Date.now(),
  });
  if (!loaded.ok) throw new Error(`load rejected: ${loaded.error}`);
  await sleep(200);
  latestVersion = finalStates[0].version;

  // --- Phase 1: sequential control propagation --------------------------------
  const latencies: number[] = [];
  const acks: number[] = [];
  const actions = ['pause', 'seek', 'play', 'seek'] as const;
  for (let i = 0; i < COMMANDS; i++) {
    const action = actions[i % actions.length];
    const version = latestVersion + 1;
    const entry = { sentAt: performance.now(), received: [] as number[] };
    pending.set(version, entry);
    const ack = await send(host, { action, position: (i * 7) % 3000, baseVersion: latestVersion, issuedAt: Date.now() });
    acks.push(performance.now() - entry.sentAt);
    if (!ack.ok) throw new Error(`command rejected: ${ack.error}`);
    // Wait until everyone has it (or 2 s).
    const deadline = performance.now() + 2000;
    while (entry.received.length < CLIENTS && performance.now() < deadline) await sleep(1);
    if (entry.received.length < CLIENTS) console.warn(`version ${version}: only ${entry.received.length}/${CLIENTS} received`);
    latencies.push(...entry.received.map((t) => t - entry.sentAt));
    latestVersion = version;
    pending.delete(version);
    await sleep(GAP_MS);
  }

  // --- Phase 2: concurrent actions --------------------------------------------
  // Everyone may control; all clients fire a seek at the same instant, repeatedly.
  await new Promise((r) => host.emit('settings:update', { controlMode: 'everyone' }, r));
  let convergedRounds = 0;
  const ROUNDS = 20;
  for (let round = 0; round < ROUNDS; round++) {
    await Promise.all(
      clients.map(({ socket }, i) => send(socket, { action: i % 2 ? 'seek' : round % 2 ? 'pause' : 'play', position: 100 + i, baseVersion: latestVersion, issuedAt: Date.now() })),
    );
    await sleep(150);
    const versions = new Set(finalStates.map((s) => s.version));
    const positions = new Set(finalStates.map((s) => `${s.playing}:${s.position.toFixed(3)}`));
    if (versions.size === 1 && positions.size === 1) convergedRounds++;
    latestVersion = Math.max(...finalStates.map((s) => s.version));
  }

  const summary = {
    date: new Date().toISOString(),
    url: URL,
    clients: CLIENTS,
    commands: COMMANDS,
    propagationMs: {
      samples: latencies.length,
      p50: +percentile(latencies, 50).toFixed(2),
      p95: +percentile(latencies, 95).toFixed(2),
      p99: +percentile(latencies, 99).toFixed(2),
      max: +Math.max(...latencies).toFixed(2),
    },
    ackRoundTripMs: { p50: +percentile(acks, 50).toFixed(2), p95: +percentile(acks, 95).toFixed(2) },
    concurrency: { rounds: ROUNDS, simultaneousCommandsPerRound: CLIENTS, convergedRounds },
    target: { p95PropagationMs: 250, pass: percentile(latencies, 95) <= 250 && convergedRounds === ROUNDS },
  };
  console.log(JSON.stringify(summary, null, 2));
  writeFileSync('bench-results.json', JSON.stringify(summary, null, 2));

  clients.forEach(({ socket }) => socket.disconnect());
  process.exit(summary.target.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
