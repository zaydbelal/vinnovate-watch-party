# Deploying

The server serves the API, the WebSocket and the built client from one port, so a deployment is a single web service with an HTTPS URL. HTTPS matters: browsers only allow the microphone (voice) and screen capture on secure origins.

## Option A: Render (easiest)

1. Push this repo to GitHub (already done if you're reading this there).
2. Sign in at [render.com](https://render.com) with GitHub.
3. **New → Blueprint**, pick this repository and the branch you want to deploy. Render reads `render.yaml` and creates a web service called `watch-party`.
4. When it asks for the `TURN_*` values you can leave them empty for a first test and add them later (see below).
5. Wait for the first build (a few minutes). You get a URL like `https://watch-party-xxxx.onrender.com`. Share that; invite links are `https://…/r/CODE`.

Every push to that branch redeploys automatically.

**Free vs paid.** The blueprint uses Render's free plan. Free services go to sleep after a period of no traffic, and the first visitor waits about a minute while it wakes. For a planned watch party, switch the service to a paid instance in the Render dashboard, or open the site a few minutes early. Check Render's pricing page for current plans.

## Option B: any container host

`Dockerfile` builds a self-contained image (Node 22, production client build, `npm start`). It listens on `PORT` (default 3001).

```bash
docker build -t watch-party .
docker run -p 3001:3001 watch-party
```

Fly.io (`fly launch`, then `fly deploy`), Railway (deploy from repo, it detects the Dockerfile), Google Cloud Run and a plain VPS behind Caddy or nginx all work. The host must support WebSockets and must give you HTTPS.

## Voice and screen share across the internet: TURN

On a home network, voice and screen share connect browser to browser directly. Across the internet, some networks (many mobile carriers, offices, universities) block direct connections, and those people get no voice or shared screen. A **TURN relay** fixes that by forwarding their media.

1. Create an account with a TURN provider. Several have free tiers (for example Metered's TURN service); pick one that gives you a **static username and password**. Check their current free limits.
2. Copy the TURN URL(s), username and credential they give you.
3. Set environment variables on your host (in Render: the service → Environment):

| Variable | Example |
| --- | --- |
| `TURN_URL` | `turn:global.relay.example.com:3478,turns:global.relay.example.com:443?transport=tcp` (comma-separated) |
| `TURN_USERNAME` | from your provider |
| `TURN_CREDENTIAL` | from your provider |

For full control, set `ICE_SERVERS` instead: a JSON array of `RTCIceServer` objects, which replaces the defaults entirely.

Browsers fetch the list from `/api/ice` when they join a room. Check it at `https://your-app/api/ice`.

To test that TURN works: join from a phone on mobile data (not Wi-Fi) and start voice or a screen share with someone on a different network.

## Things to know

- **One instance only.** Rooms live in the server's memory, so run exactly one instance (the default everywhere). Scaling out would need a shared store and the Socket.IO Redis adapter.
- **Deploys and restarts end rooms.** Anyone in a room sees "Reconnecting", then "Room not found". Avoid deploying during a watch party.
- **Pick a region near most of your viewers.** Control latency is roughly one trip to the server and one back out. Playback sync itself is clock-based, so distance barely affects drift.
- **Streaming services** still work in companion mode (everyone uses their own account), and YouTube and direct video links play for everyone. A video file must be publicly reachable for every viewer, not just on your computer.
- **Check it's up:** `https://your-app/api/health` returns `{"ok":true,…}`; `https://your-app/api/metrics` shows live sync stats per room.
