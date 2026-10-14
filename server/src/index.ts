import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { percentile } from '@watch-party/shared';
import { catalog } from './catalog';
import { config } from './config';
import { features } from './features';
import { RoomManager } from './rooms/RoomManager';
import type { AppServer, FeatureContext } from './types';

const app = express();
const httpServer = createServer(app);
const io: AppServer = new Server(httpServer, {
  cors: { origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') },
  // Keep heartbeats tight so dead connections are noticed quickly.
  pingInterval: 10_000,
  pingTimeout: 8_000,
});
const rooms = new RoomManager(io, config);
const ctx: FeatureContext = { io, rooms, config };

io.on('connection', (socket) => {
  for (const feature of features) feature.register(socket, ctx);
});

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
app.use(express.json());

app.post('/api/rooms', (_req, res) => {
  res.json({ code: rooms.create().code });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ code: room.code, members: room.connectedCount });
});

app.get('/api/catalog', (_req, res) => {
  res.json(catalog);
});

/** Live sync metrics for documentation / monitoring. */
app.get('/api/metrics', (_req, res) => {
  res.json({
    rooms: rooms.all().map((r) => {
      const members = r.publicMembers().filter((m) => m.connected);
      const drifts = members.map((m) => Math.abs(m.stats?.driftMs ?? 0));
      return {
        code: r.code,
        members: members.length,
        controlLatencyMs: { samples: r.latencySamples.length, p50: percentile(r.latencySamples, 50), p95: percentile(r.latencySamples, 95) },
        driftMs: { p50: percentile(drifts, 50), p95: percentile(drifts, 95), max: Math.max(0, ...drifts) },
      };
    }),
  });
});

/** STUN/TURN servers for voice and screen share (configured with env vars, see server/src/config.ts). */
app.get('/api/ice', (_req, res) => {
  res.json({ iceServers: config.iceServers });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// Serve the built client in production (single port deploy).
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

httpServer.listen(config.port, () => {
  console.log(`Watch party server on http://localhost:${config.port}`);
});
