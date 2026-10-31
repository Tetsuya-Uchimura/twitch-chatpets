import {NIB_FORMS} from '../../src/shared/nib-forms.js';
import {generateEvolvedNib} from '../../src/client/nib-evolution-sprites.js';
const nibBodyColors=Object.keys(NIB_FORMS).map(form=>generateEvolvedNib('idle',0,form).palette[2]).map(c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)]);
import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { EMOTIONS } from '../../src/shared/pulse-classifier.js';
import { ACTION_INTENTS, resolveActionVariant, variantDuration } from '../../src/shared/action-variants.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-personality-browser-'));
let sdk = 0, jobs = 0, sockets = 0;
const runtime = createApp({ directory, publicDirectory: path.resolve('dist/public'),
  config: loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'unused-practice-sentinel' }),
  clientFactory() { sdk++; throw new Error('forbidden'); }, schedule() { jobs++; return 1; },
  createSocket() { sockets++; throw new Error('forbidden'); } });
const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.start();
const base = `http://127.0.0.1:${server.address().port}`;
let browser; const errors = [], external = [], trace = [];
fs.mkdirSync('artifacts', { recursive: true });
try {
  browser = await chromium.launch(browserOptions());
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await context.route('**/*', route => { if (!route.request().url().startsWith(base + '/')) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
  await context.request.post(base + '/api/demo/pulse', { data: { scenario: 'calm' } });
  const preview = await context.newPage(), overlay = await context.newPage();
  await preview.clock.install();
  for (const [page, url] of [[preview, base], [overlay, base + '/?overlay=1']]) {
    await page.goto(url); await page.waitForFunction(() => document.getElementById('world').dataset.mascotCount === '1');
  }
  await preview.clock.pauseAt(await preview.evaluate(() => Date.now() + 1000));
  assert.equal(await preview.locator('#interaction-lab').isVisible(), true); assert.equal(await overlay.locator('#interaction-lab').isVisible(), false);
  const initialXP = runtime.game.creatures[0].xp, battleAt = runtime.chat.battleAt;
  for (const mood of EMOTIONS) for (const intent of ACTION_INTENTS) {
    await preview.locator('#test-mood').selectOption(mood); await preview.locator('#test-intent').selectOption(intent);
    const responsePromise = preview.waitForResponse(r => r.url() === base + '/api/demo/interaction' && r.request().method() === 'POST');
    await preview.locator('#test-interaction').click(); const response = await responsePromise; assert.equal(response.status(), 200);
    const { sequence } = await response.json();
    const duration = variantDuration(resolveActionVariant(mood, intent));
    for (const page of [preview, overlay]) await page.locator(`#world[data-last-received="${sequence}"]`).waitFor({ state: 'attached' });
    // Playwright's clock is shared by pages in this context: advance once, then inspect both.
    await preview.clock.runFor(40);
    if(await preview.locator('#world').getAttribute('data-evolution-phase')!=='idle')await preview.clock.runFor(3300);
    for (const page of [preview, overlay]) {
      assert.equal(await page.locator('#world').getAttribute('data-variant'), `${mood}:${intent}`, JSON.stringify({ errors, mood, intent }));
    }
    await preview.clock.runFor(duration * .5);
    for (const page of [preview, overlay]) {
      const sample = await page.locator('#world').evaluate((canvas, bodyColors) => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let bodyPixels = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] && bodyColors.some(c => data[i] === c[0] && data[i + 1] === c[1] && data[i + 2] === c[2])) bodyPixels++;
        return { bodyPixels, variant: canvas.dataset.variant, emotion: canvas.dataset.emotion, primitive: canvas.dataset.primitive,
          renderer: canvas.dataset.spriteRenderer, charts: JSON.parse(canvas.dataset.activityBuckets), topAlpha: data[3], frameErrors: canvas.dataset.frameErrors || '0' };
      }, nibBodyColors);
      trace.push({ mood, intent, view: page === overlay ? 'overlay' : 'preview', ...sample });
      assert.ok(sample.bodyPixels > 50); assert.equal(sample.variant, `${mood}:${intent}`); assert.equal(sample.emotion, mood);
      assert.equal(sample.renderer, 'pixel-spans-v2'); assert.equal(sample.frameErrors, '0'); assert.equal(sample.charts.length, 12);
      if (page === overlay) { assert.equal(sample.topAlpha, 0); await page.locator('#world').screenshot({ path: `artifacts/personality-${mood}-${intent}.png`, omitBackground: true }); }
    }
    await preview.clock.runFor(duration + 500);
    for (const page of [preview, overlay]) {
      const completed = JSON.parse(await page.locator('#world').getAttribute('data-completed'));
      const done = completed.find(t => t.sequence === sequence); assert.ok(done); assert.equal(done.cancelled, false);
      if (intent === 'eat') assert.equal(done.consumed, true);
      assert.equal(await page.locator('#world').getAttribute('data-variant'), '');
    }
  }
  assert.equal(runtime.game.creatures[0].xp - initialXP, 20); assert.equal(runtime.chat.battleAt, battleAt);
  const resetResponse = preview.waitForResponse(r => r.url() === base + '/api/demo/interaction/reset');
  await preview.locator('#use-pulse').click(); await resetResponse;
  assert.equal(runtime.snapshot().demoMood, null);
  await preview.screenshot({ path: 'artifacts/personality-dashboard.png', fullPage: true });
  const small = await context.newPage(); await small.setViewportSize({ width: 250, height: 430 }); await small.goto(base + '/?overlay=1');
  await preview.clock.runFor(100); await small.locator('#world[data-mascot-count="1"]').waitFor({ state: 'attached' });
  const smallResponse = await context.request.post(base + '/api/demo/interaction', { data: { mood: 'confusion', intent: 'eat' } });
  const smallSequence = (await smallResponse.json()).sequence;
  await small.locator(`#world[data-last-received="${smallSequence}"]`).waitFor({ state: 'attached' });
  await preview.clock.runFor(450); assert.equal(await small.locator('#world').getAttribute('data-variant'), 'confusion:eat');
  await small.screenshot({ path: 'artifacts/personality-small.png', omitBackground: true });
  assert.ok(await small.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(sdk, 0); assert.equal(jobs, 0); assert.equal(sockets, 0); assert.deepEqual(errors, []); assert.deepEqual(external, []);
  fs.writeFileSync('artifacts/personality-trace.json', JSON.stringify(trace, null, 2));
  console.log('Personality production-browser checks passed: 20 mood/action combinations in preview + OBS, visible CPU sprites, consumption/cleanup, XP, chart history, alpha, demo reset, 250px fit, zero SDK/AI jobs/Twitch/external calls.');
} catch (error) {
  fs.writeFileSync('artifacts/personality-failure.json', JSON.stringify({ errors, external, trace }, null, 2));
  throw error;
} finally {
  await browser?.close(); runtime.stop(); await new Promise(r => server.close(r));
  assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true });
}
