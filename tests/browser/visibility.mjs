import { chromium } from '@playwright/test';
import { browserOptions } from './browser-options.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-visibility-'));
const runtime = createApp({ directory, config: loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'unused-test-key' }),
  clientFactory() { assert.fail('Demo constructed OpenAI'); }, createSocket() { assert.fail('Demo connected to Twitch'); } });
const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.start();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(browserOptions());
const errors = [], trace = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  await context.request.post(base + '/api/demo/playback', { data: { enabled: false } });
  for (const overlay of [false, true]) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      // Simulate silently discarded cached sprite canvases, without throwing a paint exception.
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      window.cachedSpriteBlits = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
        if (source instanceof HTMLCanvasElement && source.width === 40 && source.height === 36) {
          window.cachedSpriteBlits++;
          source.getContext('2d').clearRect(0, 0, source.width, source.height);
        }
        return draw.call(this, source, ...args);
      };
    });
    await page.clock.install(); await page.goto(base + (overlay ? '/?overlay=1' : '/'));
    await page.waitForFunction(() => document.getElementById('world').dataset.mascotCount === '1');
    async function visible(label) {
      const sample = await page.locator('#world').evaluate(canvas => {
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let green = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] === 168 && data[i + 1] === 231 && data[i + 2] === 122) green++;
        return { green, action: canvas.dataset.actions, phase: canvas.dataset.phase, width: canvas.width, height: canvas.height };
      });
      trace.push({ overlay, label, ...sample });
      assert.ok(sample.green > 50, `Mascot disappeared at ${label}: ${JSON.stringify({ sample, errors })}`);
      assert.deepEqual(errors, []);
      assert.equal(await page.locator('#world').getAttribute('data-sprite-renderer'), 'pixel-spans-v2');
      assert.equal(await page.evaluate(() => window.cachedSpriteBlits), 0);
    }
    await visible('initial');
    // Multiple complete patrol/sleep cycles, plus long hidden-tab-like gaps.
    for (let i = 0; i < 30; i++) { await page.clock.runFor(2000); await visible(`quiet-${(i + 1) * 2}s`); }
    await page.clock.fastForward(3600000); await page.clock.runFor(100); await visible('after-one-hour-gap');
    for (const text of ['GG', 'LOL 😂', 'POG 🔥', 'Why?', '!jump', '!battle', 'bruh', '!powerup', 'good night zzz']) {
      if (text === '!battle') runtime.chat.battleAt = -Infinity;
      await context.request.post(base + '/api/demo/message', { data: { text } });
      await page.waitForTimeout(20);
      for (let i = 0; i < 9; i++) { await page.clock.runFor(350); await visible(`${text}-${i}`); }
    }
    const burstCues = ['GG 💖', 'LOL 😂', 'POG 🔥', 'Why?', '!jump', 'bruh', '!powerup', 'good night zzz', '頑張れ！😂'.repeat(40)];
    for (let batch = 0; batch < 12; batch++) {
      await Promise.all(Array.from({ length: 5 }, (_, index) => context.request.post(base + '/api/demo/message', { data: { text: burstCues[(batch + index) % burstCues.length] } })));
      await page.waitForTimeout(10); await page.clock.runFor(450); await visible(`burst-${batch}`);
    }
    for (let i = 0; i < 12; i++) { await page.clock.runFor(750); await visible(`after-burst-${i}`); }
    await page.evaluate(() => {
      const canvas = document.getElementById('world'), ctx = canvas.getContext('2d'), draw = ctx.drawImage;
      ctx.drawImage = function (...args) { ctx.drawImage = draw; throw new Error('simulated one-frame drawing failure'); };
    });
    await page.clock.runFor(20); await visible('during-transient-paint-failure');
    await page.clock.runFor(200); await visible('after-paint-recovery');
    assert.equal(Number(await page.locator('#world').getAttribute('data-frame-errors')), 1);
    const paint = Number(await page.locator('#world').getAttribute('data-last-paint'));
    await page.clock.runFor(250); assert.ok(Number(await page.locator('#world').getAttribute('data-last-paint')) > paint);
    await page.locator('#world').evaluate(c => c.dispatchEvent(new Event('contextrestored')));
    await page.clock.runFor(50); await visible('after-context-restore');
    await page.close();
  }
  console.log(JSON.stringify({ checkedFrames: trace.length, errors, result: 'visible throughout idle and all actions' }));
} catch (error) {
  fs.mkdirSync('artifacts', { recursive: true }); fs.writeFileSync('artifacts/visibility-trace.json', JSON.stringify({ errors, trace }, null, 2));
  throw error;
} finally {
  await browser.close(); runtime.stop(); await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
}
