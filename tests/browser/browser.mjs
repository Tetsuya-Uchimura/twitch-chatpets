import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { loadConfig } from '../../src/server/config.js';
import { createApp } from '../../src/server/app.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'critters-browser-'));
let apiCalls = 0;
const runtime = createApp({ config: loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'test-key-present' }), directory,
  clientFactory: () => { apiCalls++; throw new Error('Demo must never construct OpenAI.'); },
  createSocket: () => { throw new Error('Demo must never open Twitch.'); },
});
const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.start();
const base = `http://127.0.0.1:${server.address().port}`;
await fetch(base + '/api/demo/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
let browser, page;
const errors = [], external = [];
fs.mkdirSync('artifacts', { recursive: true });
async function secureContext(options) {
  const context = await browser.newContext(options);
  await context.route('**/*', async route => {
    if (!route.request().url().startsWith(base + '/')) { external.push(route.request().url()); await route.abort(); }
    else await route.continue();
  });
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  return context;
}
try {
  browser = await chromium.launch(browserOptions());
  const context = await secureContext({ viewport: { width: 1440, height: 1100 } });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  const ready = async url => { await page.goto(url); await page.locator('#connection').filter({ hasText: 'Demo world' }).waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.getElementById('world').dataset.mascotCount === '1'); };
  await ready(base); assert.equal(await page.locator('#cast').count(), 0);
  assert.equal(await page.locator('#ai-enabled').isDisabled(), true); assert.equal(await page.locator('#cost').innerText(), '$0.00');
  assert.equal(runtime.game.creatures.length, 1);
  await page.screenshot({ path: 'artifacts/dashboard-initial.png', fullPage: true });
  await page.locator('#chat-input').fill('GG 💖 日本語'); await page.locator('#chat-form button').click();
  await page.locator('#chat-log li').filter({ hasText: 'GG 💖 日本語' }).waitFor();
  await page.waitForFunction(() => document.getElementById('world').dataset.phase === 'chase');
  const before = await page.locator('#world').evaluate(c => c.toDataURL()); await page.waitForTimeout(120);
  assert.notEqual(await page.locator('#world').evaluate(c => c.toDataURL()), before);
  await page.locator('#interval').fill('30'); await page.locator('#budget').fill('0.20'); await page.locator('#settings-form button').click();
  await page.locator('#toast').filter({ hasText: 'Settings saved.' }).waitFor();
  assert.equal(runtime.store.state.settings.intervalSeconds, 30);
  assert.equal((await context.request.patch(base + '/api/ai/settings', { data: { enabled: true } })).status(), 409);
  await page.locator('#anchor').selectOption('left'); await page.locator('#stage-form button').click();
  await page.locator('#toast').filter({ hasText: 'Overlay saved.' }).waitFor();
  assert.equal(runtime.store.state.stageSettings.anchor, 'left'); assert.equal(runtime.store.state.stageSettings.cast, 'solo');
  await context.request.patch(base + '/api/stage/settings', { data: { cast: 'trio', anchor: 'right' } });
  assert.equal(runtime.store.state.stageSettings.cast, 'solo');
  await page.screenshot({ path: 'artifacts/dashboard-desktop.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'artifacts/dashboard-mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const [cue, performance, phase] of [['GG 💖', 'eat', 'interact'], ['LOL 😂', 'play', 'interact'], ['POG 🔥', 'dash', 'interact'],
    ['Why?', 'inspect', 'inspect'], ['!jump HOP!', 'jump', 'interact'], ['!battle', 'attack', 'interact'], ['bruh…', 'recoil', 'interact'],
    ['!powerup', 'powerup', 'powerup'], ['good night zzz', 'sleep', 'sleep'], ['!happy', 'happy', 'interact']]) {
    await ready(base); if (performance === 'attack') runtime.chat.battleAt = -Infinity; // Isolated visual fixture; production cooldown is tested separately.
    await page.locator('#chat-input').fill(cue); await page.locator('#chat-form button').click();
    await page.locator('#chat-log li').filter({ hasText: cue.normalize('NFKC') }).waitFor();
    await page.waitForFunction(({ performance, phase }) => { const d = document.getElementById('world').dataset; return d.performance === performance && d.phase === phase; }, { performance, phase });
    await page.waitForTimeout(performance === 'jump' ? 220 : 90);
    assert.equal(runtime.game.lastInteraction.performance, performance); assert.equal(await page.locator('#world').getAttribute('data-mascot-count'), '1');
    const ratio = Number(await page.locator('#world').getAttribute('data-text-ratio')); if (ratio) assert.ok(ratio >= .4 && ratio <= 1);
    await page.locator('#world').screenshot({ path: `artifacts/nib-${performance}.png` });
  }
  await ready(base);
  await context.request.post(base + '/api/demo/message', { data: { text: '頑張れ！😂'.repeat(40) } });
  await page.waitForFunction(() => document.getElementById('world').dataset.capsuleLabel?.endsWith('…'));
  const ratio = Number(await page.locator('#world').getAttribute('data-text-ratio')); assert.ok(ratio >= .4 && ratio <= 1);
  runtime.game.burst = []; runtime.game.emoteAt.clear();
  for (const text of ['LOL one 😂', 'LOL two 😂', 'LOL three 😂']) await context.request.post(base + '/api/demo/message', { data: { text } });
  await page.waitForFunction(() => document.getElementById('world').dataset.stickers?.includes('kekw'));
  await page.locator('#world').screenshot({ path: 'artifacts/nib-combo.png' });
  await page.locator('#stage-emotes').uncheck(); await page.locator('#stage-form button').click();
  await page.waitForFunction(() => document.getElementById('world').dataset.stickers === '');
  await context.request.patch(base + '/api/stage/settings', { data: { emotes: true, anchor: 'right' } });
  await ready(base + '/?overlay=1&cast=trio'); // Old links still yield exactly one mascot.
  assert.equal(await page.locator('.rail').isVisible(), false); assert.equal(await page.locator('#ai-settings').isVisible(), false);
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(200);
  const bounds = () => page.locator('#world').evaluate(c => {
    const { width: w, height: h } = c, data = c.getContext('2d').getImageData(0, 0, w, h).data;
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[(y * w + x) * 4 + 3] > 40) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX: minX / w, maxX: maxX / w, minY: minY / h, maxY: maxY / h, topLeftAlpha: data[3], smoothing: c.getContext('2d').imageSmoothingEnabled };
  });
  const right = await bounds(); assert.equal(right.topLeftAlpha, 0); assert.equal(right.smoothing, false); assert.ok(right.minX > .7); assert.ok(right.minY > .45);
  await page.screenshot({ path: 'artifacts/overlay.png', omitBackground: true });
  await context.request.patch(base + '/api/stage/settings', { data: { anchor: 'left' } }); await page.waitForTimeout(350);
  assert.ok((await bounds()).maxX < .35);
  runtime.game.evolvedAt = -Infinity;
  runtime.game.recommend({ creatureType: 'mystic', energyLevel: 80, dominantMood: 'curious', recommendedEvent: 'none' }, { totalMessages: 20, localCategoryCounts: { question: 20 } });
  await page.waitForFunction(() => document.getElementById('world').dataset.form === 'mystic');
  assert.equal(await page.locator('#world').getAttribute('data-mascot-count'), '1');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100);
  const highDpi = await secureContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1.25 });
  const dpiPage = await highDpi.newPage(); await dpiPage.goto(base + '/?overlay=1&anchor=right');
  await dpiPage.waitForFunction(() => document.getElementById('world').dataset.pixelUnit);
  assert.ok(Number.isInteger(Number(await dpiPage.locator('#world').getAttribute('data-pixel-unit'))));
  await dpiPage.screenshot({ path: 'artifacts/overlay-dpr125.png', omitBackground: true }); await highDpi.close();

  // A short, toolbar-free video is encoded by the browser itself, from this app's own canvas.
  // The checkerboard is composited for clarity in the video; the actual OBS source stays transparent.
  await context.request.patch(base + '/api/stage/settings', { data: { tempo: 112, scale: 1.4, anchor: 'right', emotes: true } });
  runtime.game.creatures[0].type = 'cozy'; runtime.game.recent = []; runtime.game.burst = []; runtime.game.emoteAt.clear();
  const videoContext = await secureContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  const videoPage = await videoContext.newPage(); await videoPage.goto(base + '/?overlay=1');
  await videoPage.waitForFunction(() => document.getElementById('world').dataset.mascotCount === '1');
  await videoPage.evaluate(() => {
    const source = document.getElementById('world'), out = document.createElement('canvas'); out.width = source.width; out.height = source.height;
    const ctx = out.getContext('2d'), chunks = [], stream = out.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1200000 });
    let running = true;
    function paint() { ctx.fillStyle = '#e8eee2'; ctx.fillRect(0, 0, out.width, out.height);
      for (let y = 0; y < out.height; y += 20) for (let x = 0; x < out.width; x += 20) if ((x / 20 + y / 20) % 2) { ctx.fillStyle = '#d7e0cf'; ctx.fillRect(x, y, 20, 20); }
      ctx.imageSmoothingEnabled = false; ctx.drawImage(source, 0, 0); if (running) requestAnimationFrame(paint); }
    paint(); recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise(resolve => { recorder.onstop = async () => { running = false; stream.getTracks().forEach(t => t.stop()); resolve(Array.from(new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer()))); }; });
    window.finishNibRecording = () => { recorder.stop(); return done; }; recorder.start();
  });
  for (const cue of ['GG 💖', 'LOL 😂', 'POG 🔥', 'Why?', '!jump HOP!', '!battle', 'bruh…', '!powerup', 'good night zzz']) {
    if (cue === '!battle') runtime.chat.battleAt = -Infinity;
    assert.equal((await context.request.post(base + '/api/demo/message', { data: { text: cue } })).status(), 200);
    await videoPage.waitForTimeout(cue.includes('zzz') ? 3600 : 2700);
  }
  const video = await videoPage.evaluate(() => window.finishNibRecording());
  fs.writeFileSync('artifacts/nib-demo.webm', Buffer.from(video)); assert.ok(video.length > 20000);
  await videoContext.close();
  assert.deepEqual(external, []); assert.deepEqual(errors, []); assert.equal(apiCalls, 0);
  console.log('Browser checks passed: one pixel mascot, all reaction categories, compact text ratio, long Japanese/emoji truncation, combos, settings, transparency, corner bounds, evolution identity, fractional DPR, reduced motion, zero API/external calls. Saved artifacts/nib-demo.webm.');
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: 'artifacts/browser-failure.png', fullPage: true }); console.error(JSON.stringify({ errors, external, settings: runtime.store.state.stageSettings })); }
  throw error;
} finally {
  await browser?.close(); runtime.stop(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
