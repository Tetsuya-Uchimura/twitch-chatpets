import {NIB_FORMS} from '../../src/shared/nib-forms.js';
import {generateEvolvedNib} from '../../src/client/nib-evolution-sprites.js';
const nibBodyColors=Object.keys(NIB_FORMS).map(form=>generateEvolvedNib('idle',0,form).palette[2]).map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]);
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-browser-'));
let clock = Date.UTC(2026, 9, 27, 12, 0, 30), sdk = 0, timers = 0, sockets = 0;
const runtime = createApp({ directory, publicDirectory: path.resolve('dist/public'), now: () => clock,
  config: loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'browser-secret-sentinel' }),
  clientFactory: () => { sdk++; throw new Error('forbidden SDK'); }, schedule: () => { timers++; },
  createSocket: () => { sockets++; throw new Error('forbidden Twitch'); } });
const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.start();
const base = `http://127.0.0.1:${server.address().port}`;
let browser; const errors = [], external = [];
fs.mkdirSync('artifacts', { recursive: true });
try {
  browser = await chromium.launch(browserOptions());
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(base + '/')) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
  await context.request.post(base + '/api/demo/playback', { data: { enabled: false } });
  const preview = await context.newPage(); await preview.goto(base);
  const overlay = await context.newPage(); await overlay.goto(base + '/?overlay=1');
  const wait = p => p.waitForFunction(() => document.getElementById('world').dataset.mascotCount === '1');
  await wait(preview); await wait(overlay);
  assert.equal(await overlay.locator('canvas').count(), 1);
  assert.equal(await overlay.locator('#pulse-demo-controls').isVisible(), false);
  for (const scenario of ['calm', 'laughter', 'excitement', 'anger', 'confusion', 'spike']) {
    const completed=preview.waitForResponse(r=>r.url()===base+'/api/demo/pulse'&&r.request().method()==='POST');
    await preview.locator(`[data-scenario="${scenario}"]`).click();await completed;
    const emotion = scenario === 'spike' ? 'calm' : scenario;
    const generation=runtime.snapshot().pulse.generation;
    for (const page of [preview, overlay]) {
      await page.waitForFunction(({emotion,generation}) => {const c=document.getElementById('world');return c.dataset.emotion===emotion&&c.dataset.pulseGeneration===String(generation)&&c.dataset.evolutionPhase==='idle';}, {emotion,generation});
      const result = await page.locator('#world').evaluate((canvas, bodyColors) => {
        const ctx = canvas.getContext('2d'), { width, height } = canvas;
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let bodyPixels = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && bodyColors.some(c => pixels[i] === c[0] && pixels[i + 1] === c[1] && pixels[i + 2] === c[2])) bodyPixels++;
        return { bodyPixels, width: Number(canvas.dataset.widgetWidth), height: Number(canvas.dataset.widgetHeight),
          activity: JSON.parse(canvas.dataset.activityBuckets), counts: JSON.parse(canvas.dataset.pulseCounts),
          description: canvas.getAttribute('aria-label'), renderer: canvas.dataset.spriteRenderer, frameErrors: canvas.dataset.frameErrors || '0' };
      }, nibBodyColors);
      assert.ok(result.bodyPixels > 50); assert.equal(result.width, 320); assert.equal(result.height, 380);
      assert.equal(result.activity.length, 12); assert.ok(result.activity.every(b => b.count > 0 && b.available));
      assert.ok(result.description.includes('Simulated demo history')); assert.equal(result.renderer, 'pixel-spans-v2'); assert.equal(result.frameErrors, '0');
      if (scenario !== 'spike') assert.ok(result.counts[emotion] > 0);
    }
    await overlay.screenshot({ path: `artifacts/pulse-${scenario}.png`, omitBackground: true });
  }
  // Safe boundary in the actual renderer: an existing jump completes before the new expression appears.
  clock += 31000;
  await context.request.post(base + '/api/demo/message', { data: { text: '!jump' } });
  await overlay.waitForFunction(() => document.getElementById('world').dataset.performance === 'jump');
  await context.request.post(base + '/api/demo/pulse', { data: { scenario: 'anger' } });
  await overlay.waitForFunction(() => document.getElementById('world').dataset.requestedEmotion === 'anger');
  await overlay.waitForFunction(() => document.getElementById('world').dataset.emotion === 'anger');
  assert.equal(runtime.pulse.snapshot().emotion, 'anger');
  for (const cue of ['!jump', '🍙', '!battle']) {
    clock += 31000;
    await context.request.post(base + '/api/demo/message', { data: { text: cue } });
    const performance = cue === '!jump' ? 'jump' : cue === '🍙' ? 'eat' : 'attack';
    await overlay.waitForFunction(performance => document.getElementById('world').dataset.performance === performance, performance);
    assert.equal(await overlay.locator('#world').getAttribute('data-emotion'), 'anger');
    await overlay.waitForTimeout(2600);
  }
  await preview.locator('[data-scenario="anger"]').click();
  await overlay.waitForFunction(() => JSON.parse(document.getElementById('world').dataset.pulseCounts).anger > 0);
  await preview.screenshot({ path: 'artifacts/pulse-dashboard.png', fullPage: true });
  for (const width of [250, 320, 350]) {
    await overlay.setViewportSize({ width, height: 430 }); await overlay.waitForTimeout(100);
    const geometry = await overlay.locator('#world').evaluate(canvas => {
      const { width, height } = canvas, pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const edge = [];
      for (let y = 0; y < height; y++) { edge.push(pixels[(y * width) * 4 + 3]); edge.push(pixels[(y * width + width - 1) * 4 + 3]); }
      return { edge: edge.some(a => a), alpha: pixels[3], widgetWidth: +canvas.dataset.widgetWidth,
        widgetHeight: +canvas.dataset.widgetHeight, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.alpha, 0); assert.equal(geometry.edge, false); assert.equal(geometry.overflow, false);
    assert.ok(geometry.widgetWidth <= width - 28); assert.ok(geometry.widgetHeight <= 402);
    await overlay.screenshot({ path: `artifacts/pulse-width-${width}.png`, omitBackground: true });
  }
  for (const file of ['index.html', 'app.js', 'style.css']) {
    const response = await context.request.get(base + '/' + file); assert.equal(response.status(), 200);
    assert.equal((await response.text()).includes('browser-secret-sentinel'), false);
  }
  for (const file of ['.env', 'server/ai.js', 'data/ai-state.json']) assert.equal((await context.request.get(base + '/' + file)).status(), 404);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(sdk, 0); assert.equal(timers, 0); assert.equal(sockets, 0);
  console.log('Chat Pulse production-browser checks passed: 6 scenarios, shared preview/OBS component, 12 replay buckets, 5 emotions, actions independent of anger, 250/320/350px fit, alpha, secrets, 0 API/timer/Twitch/external calls.');
} finally {
  await browser?.close(); runtime.stop(); await new Promise(r => server.close(r));
  assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true });
}
