/**
 * Browser end-to-end sync test: 3 real Chromium tabs join one room, then we
 * play, pause, seek, deliberately desync clients, reload one (reconnect) and
 * add a late joiner, printing the playback spread between tabs at each step.
 *
 *   npm run build && npm start              # serves client + API on :3001
 *   VIDEO_URL=http://localhost:3001/test.webm npm run e2e
 *
 * Generate a test clip with ffmpeg (WebM plays in every Chromium build):
 *   ffmpeg -f lavfi -i testsrc=duration=120:size=640x360:rate=30 -c:v libvpx-vp9 -b:v 500k client/dist/test.webm
 *
 * Env: BASE_URL (default http://localhost:3001), VIDEO_URL, CHROMIUM_PATH (optional).
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const VIDEO = process.env.VIDEO_URL ?? `${BASE}/test.webm`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

async function tab(name) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((n) => localStorage.setItem('wp:name', n), name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message));
  return page;
}

/** Position of each tab normalised to the same wall-clock instant. */
async function spread(pages, label) {
  const s = await Promise.all(pages.map((p) => p.evaluate(() => ({ t: document.querySelector('video')?.currentTime ?? NaN, now: Date.now() }))));
  const norm = s.map((x) => x.t - x.now / 1000);
  const ms = (Math.max(...norm) - Math.min(...norm)) * 1000;
  console.log(`${label.padEnd(28)} spread ${ms.toFixed(0).padStart(5)} ms   positions ${s.map((x) => x.t.toFixed(2)).join(', ')}`);
  return ms;
}

const results = {};
const [A, B, C] = await Promise.all(['Alice', 'Bob', 'Cara'].map(tab));
await A.goto(BASE);
await A.click('text=Create a room');
await A.waitForURL(/\/r\//);
const url = A.url();
console.log('Room:', url);
await Promise.all([B.goto(url), C.goto(url)]);
for (const p of [A, B, C]) await p.waitForSelector('.room-header');

await A.click('text=📃 Playlist');
await A.fill('input[placeholder^="Paste"]', VIDEO);
await A.click('.playlist >> button:has-text("Play")');
for (const p of [A, B, C]) await p.waitForSelector('video');
await sleep(4000);
results.playing = await spread([A, B, C], 'playing (4 s)');

await A.keyboard.press('Space');
await sleep(800);
results.paused = await spread([A, B, C], 'paused');
await A.keyboard.press('ArrowRight');
await sleep(1000);
results.seekWhilePaused = await spread([A, B, C], 'seek +10 s while paused');
await A.keyboard.press('Space');
await sleep(2500);
results.resumed = await spread([A, B, C], 'resumed');

// Bob jumps 3 s ahead (hard-seek path), Cara 0.4 s (playback-rate path).
await B.evaluate(() => (document.querySelector('video').currentTime += 3));
await C.evaluate(() => (document.querySelector('video').currentTime += 0.4));
await sleep(300);
await spread([A, B, C], 'artificial desync');
for (let i = 1; i <= 6; i++) {
  await sleep(1000);
  results[`afterDesync${i}s`] = await spread([A, B, C], `  ${i} s later`);
}

await C.reload();
await C.waitForSelector('video');
await sleep(2500);
results.afterReload = await spread([A, B, C], 'Cara reloaded (reconnect)');

const D = await tab('Dan');
await D.goto(url);
await D.waitForSelector('video');
await sleep(2500);
results.lateJoiner = await spread([A, B, C, D], 'Dan joined late');

const metrics = await (await fetch(`${BASE}/api/metrics`)).json();
console.log('Server metrics:', JSON.stringify(metrics.rooms.find((r) => url.endsWith(r.code))));
await browser.close();

const worst = Math.max(results.playing, results.resumed, results.afterDesync6s, results.afterReload, results.lateJoiner);
console.log(worst <= 500 ? `PASS: worst steady-state spread ${worst.toFixed(0)} ms (target ≤ 500 ms)` : `FAIL: ${worst.toFixed(0)} ms`);
process.exit(worst <= 500 ? 0 : 1);
