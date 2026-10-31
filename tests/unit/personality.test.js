import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { EMOTIONS } from '../../src/shared/pulse-classifier.js';
import { ACTION_INTENTS, resolveActionVariant, variantDuration } from '../../src/shared/action-variants.js';
import { variantPose } from '../../src/client/action-motion.js';
import { StageDirector, FLOOR, HOME } from '../../src/client/stage-model.js';
import { generateSprite, compileSprite } from '../../src/client/mascot-sprites.js';
import { ChatWindow } from '../../src/server/chat.js';
import { Game } from '../../src/server/game.js';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

const settings = { tempo: 112, ambient: true, emotes: true, emotion: 'calm' };
const performance = { praise: 'eat', jump: 'jump', eat: 'eat', battle: 'attack' };
function samples(mood, intent) {
  const v = resolveActionVariant(mood, intent), duration = variantDuration(v);
  return Array.from({ length: 151 }, (_, i) => variantPose(v, duration * i / 150,
    { target: 232, startX: HOME, duration, home: HOME, floor: FLOOR }));
}
for (const intent of ACTION_INTENTS) for (const mood of EMOTIONS) {
  test(`mood + ${intent}: ${mood} resolves and completes a distinct bounded sequence`, () => {
    const variant = resolveActionVariant(mood, intent), poses = samples(mood, intent);
    assert.equal(variant.mood, mood); assert.equal(variant.intent, intent); assert.equal(variant.id, `${mood}:${intent}`);
    assert.ok(variantDuration(variant) > 1200 && variantDuration(variant) < 3000);
    assert.ok(poses.every(p => Number.isFinite(p.x) && p.x >= 62 && p.x <= 298 && p.jump <= 0 && p.jump >= -69));
    assert.deepEqual(new Set(poses.map(p => p.phase)), new Set(['notice', 'chase', 'interact', 'result', 'return']));
    assert.equal(poses.at(-1).x, HOME); assert.equal(poses.at(-1).capsuleVisible, false);
    const d = new StageDirector(); d.reset(1000); d.receive({ sequence: 1, intent, performance: performance[intent], text: 'test' }, 1000, { ...settings, emotion: mood });
    const duration = d.actors[0].current.duration;
    const middle = d.tick(1000 + duration * .5, { ...settings, emotion: mood })[0];
    assert.equal(middle.variantId, `${mood}:${intent}`); assert.equal(middle.emotion, mood);
    const idle = d.tick(1001 + duration, { ...settings, emotion: mood })[0]; assert.equal(idle.active, false); assert.equal(idle.phase, 'idle');
    assert.equal(d.notes.length, 0); assert.equal(d.completed.length, 1);
  });
}
test('the same intent produces five different motion signatures, not just palette changes', () => {
  for (const intent of ACTION_INTENTS) {
    const signatures = EMOTIONS.map(mood => JSON.stringify(samples(mood, intent).map(p => [p.x, p.jump, p.facing, p.action, p.primitive, p.headTilt, p.tailFrame, p.squat])));
    assert.equal(new Set(signatures).size, 5, intent);
  }
});
test('praise conveys a gentle smile, double bounce, big celebration, reluctant wag or thinking hop', () => {
  const calm = samples('calm', 'praise'), laugh = samples('laughter', 'praise'), hype = samples('excitement', 'praise');
  const angry = samples('anger', 'praise'), confused = samples('confusion', 'praise');
  assert.ok(calm.some(p => p.softSmile)); assert.ok(calm.some(p => p.primitive === 'tail-wag' && p.tailFrame === 1));
  assert.ok(laugh.some(p => p.primitive === 'double-bounce')); assert.ok(Math.min(...hype.map(p => p.jump)) < -60);
  assert.ok(angry.some(p => p.primitive === 'turn-away' && p.facing === -1 && p.arms));
  assert.ok(angry.some(p => p.primitive === 'secret-wag' && p.tailFrame === 1 && p.facing === -1));
  assert.ok(angry.every(p => !p.softSmile)); assert.ok(confused.some(p => p.headTilt));
});
test('jumps have a soft calm arc, two laugh arcs, fast hype dash, angry stomp and clumsy confusion landing', () => {
  const calm = samples('calm', 'jump'), laugh = samples('laughter', 'jump'), hype = samples('excitement', 'jump');
  const angry = samples('anger', 'jump'), confused = samples('confusion', 'jump');
  assert.ok(Math.min(...hype.map(p => p.jump)) < Math.min(...calm.map(p => p.jump)) - 10);
  assert.ok(hype.some(p => p.primitive === 'dash')); assert.ok(angry.some(p => p.primitive === 'stomp'));
  assert.ok(confused.some(p => p.primitive === 'diagonal-jump')); assert.ok(confused.some(p => p.primitive === 'clumsy-land'));
  const jumps = laugh.filter(p => p.phase === 'interact'); let peaks = 0;
  for (let i = 1; i < jumps.length - 1; i++) if (jumps[i].jump < jumps[i - 1].jump && jumps[i].jump < jumps[i + 1].jump) peaks++;
  assert.equal(peaks, 2); assert.ok(laugh.some(p => FLOOR + p.jump < p.capsuleY - 15));
});
test('eat preserves exactly-once consumption/cleanup in every mood, even across a suspended-tab gap', () => {
  for (const mood of EMOTIONS) for (const skip of [false, true]) {
    const d = new StageDirector(); d.reset(1000); const s = { ...settings, emotion: mood };
    d.receive({ sequence: 1, intent: 'eat', performance: 'eat', text: '🍙' }, 1000, s);
    const duration = d.actors[0].current.duration;
    if (!skip) {
      let consumed = false;
      for (let elapsed = 0; elapsed < duration; elapsed += 30) {
        const actor = d.tick(1000 + elapsed, s)[0];
        if (actor.note?.consumed) { consumed = true; assert.equal(actor.capsuleVisible, false); }
      }
      assert.equal(consumed, true);
    }
    d.tick(1000 + duration + 1, s); d.tick(1000 + duration + 100, s);
    assert.equal(d.completed.length, 1); assert.equal(d.completed[0].consumed, true); assert.equal(d.notes.length, 0);
    assert.ok(d.effects.length <= 1, 'No duplicate bite effect per frame.');
  }
});
test('mid-action mood changes are deferred; variants are selected once at activation', () => {
  const d = new StageDirector(); d.reset(1000);
  d.receive({ sequence: 1, intent: 'eat', performance: 'eat' }, 1000, settings);
  const first = d.actors[0].current.variant, duration = d.actors[0].current.duration;
  const angry = { ...settings, emotion: 'anger' };
  d.receive({ sequence: 2, intent: 'jump', performance: 'jump' }, 1100, angry);
  for (let t = 1200; t < 1000 + duration; t += 100) {
    assert.equal(d.tick(t, angry)[0].emotion, 'calm'); assert.equal(d.actors[0].current.variant, first);
  }
  const actor = d.tick(1001 + duration, angry)[0]; assert.equal(actor.variantId, 'anger:jump'); assert.equal(actor.progress, 0);
});
test('battle priority, aging, bounded coalescing and cancellation cannot starve or interrupt an active bite', () => {
  const d = new StageDirector(); d.reset(1000);
  const receive = (sequence, intent, at) => d.receive({ sequence, intent, performance: performance[intent] }, at, settings);
  receive(1, 'eat', 1000); receive(2, 'praise', 1100); receive(3, 'battle', 1200); receive(4, 'jump', 1300);
  for (let seq = 5; seq < 50; seq++) receive(seq, 'battle', 1300 + seq);
  assert.equal(d.actors[0].current.sequence, 1); assert.equal(d.actors[0].queue.length, 3);
  assert.ok(d.actors[0].queue.some(t => t.sequence === 2), 'Oldest waiting action is protected under load.');
  const afterEat = d.tick(3301, settings)[0]; assert.equal(afterEat.intent, 'battle');
  const battleEnd = d.actors[0].current.start + d.actors[0].current.duration;
  assert.equal(d.tick(battleEnd + 1, settings)[0].intent, 'praise', 'Aged chat action gets its turn.');
  const current = d.actors[0].current; assert.equal(d.cancel(current.sequence, battleEnd + 2), true);
  assert.equal(d.actors[0].current, current, 'Active cancellation waits for cleanup.');
  for (const ticket of [...d.actors[0].queue]) d.cancel(ticket.sequence, battleEnd + 3);
  d.tick(current.start + current.duration + 1, settings); assert.equal(d.actors[0].current, null); assert.equal(d.actors[0].queue.length, 0);
  assert.ok(d.completed.some(t => t.cancelRequested)); assert.ok(d.completed.length <= 16);
});
test('resetting demo mood cancels old queued practices at the next safe boundary', () => {
  const d = new StageDirector(); d.reset(1000); const s = { ...settings, demoGeneration: 1 };
  d.receive({ sequence: 1, performance: 'eat', intent: 'eat', demoMood: 'anger', demoGeneration: 1 }, 1000, s);
  d.receive({ sequence: 2, performance: 'jump', intent: 'jump', demoMood: 'excitement', demoGeneration: 1 }, 1100, s);
  const duration = d.actors[0].current.duration;
  assert.equal(d.tick(1200, { ...s, demoGeneration: 2 })[0].emotion, 'anger');
  const actor = d.tick(1001 + duration, { ...s, demoGeneration: 2 })[0];
  assert.equal(actor.active, false); assert.equal(actor.emotion, 'calm'); assert.ok(d.completed.some(t => t.sequence === 2 && t.cancelled));
});
test('pose primitives stay original mint pixel art and CPU spans reproduce all tilted/arm/wag poses', () => {
  for (const mood of EMOTIONS) for (const intent of ACTION_INTENTS) for (const pose of samples(mood, intent).filter((_, i) => i % 10 === 0)) {
    const gesture = { headTilt: pose.headTilt, tailFrame: pose.tailFrame, arms: pose.arms, softSmile: pose.softSmile, squat: pose.squat };
    const sprite = generateSprite(pose.action, pose.frame, 'cozy', mood, gesture), compiled = compileSprite(pose.action, pose.frame, 'cozy', mood, gesture);
    assert.equal(sprite.palette[2], '#a8e77a'); assert.ok(sprite.pixels.filter(p => p > 0).length > 300);
    const actual = new Uint8Array(1440);
    for (const [color, spans] of compiled.colors) for (const span of spans) actual.fill(color, span.y * 40 + span.x, span.y * 40 + span.x + span.width);
    assert.deepEqual(actual, sprite.pixels);
  }
});
test('chat intent classification preserves explicit food commands, battle authorization and one XP per accepted message', () => {
  let now = 1000; const chat = new ChatWindow(loadConfig({}), () => now), game = new Game(() => now);
  for (const [text, intent] of [['GG', 'praise'], ['!jump', 'jump'], ['!eat GG', 'eat'], ['ordinary text', 'eat'], ['!battle', 'battle']]) {
    now += 31000; const accepted = chat.accept({ text, userId: text, authorized: true });
    assert.equal(accepted.intent, intent); assert.equal(game.accept(accepted).intent, intent);
  }
  assert.equal(game.creatures[0].xp, 5); assert.equal(game.activity, 5);
  now += 31000; assert.equal(chat.accept({ text: '!battle', userId: 'untrusted', authorized: false }), null);
});
test('twenty practice combinations are demo-only, count accepted input and never construct AI or alter battle cooldowns', async t => {
  for (const demo of [true, false]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-personality-')); let sdk = 0, jobs = 0;
    const runtime = createApp({ directory, config: loadConfig({ DEMO_MODE: String(demo), OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'sentinel' }),
      clientFactory: () => { sdk++; throw new Error('forbidden'); }, schedule: () => { jobs++; return 1; }, unschedule() {} });
    const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { runtime.stop(); await new Promise(r => server.close(r)); assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const pulseBefore = runtime.snapshot().pulse.counts, battleAt = runtime.chat.battleAt;
    for (const mood of EMOTIONS) for (const intent of ACTION_INTENTS) {
      const response = await post('/api/demo/interaction', { mood, intent }); assert.equal(response.status, demo ? 200 : 403);
      if (demo) { assert.equal(runtime.game.lastInteraction.intent, intent); assert.equal(runtime.game.lastInteraction.demoMood, mood); }
    }
    assert.equal(runtime.game.creatures[0].xp, demo ? 20 : 0); assert.equal(runtime.chat.battleAt, battleAt);
    assert.deepEqual(runtime.snapshot().pulse.counts, pulseBefore, 'Manual mood never fabricates a sentiment distribution.');
    assert.equal(runtime.snapshot().pulse.activity.reduce((sum, b) => sum + b.count, 0), demo ? 20 : 0);
    assert.equal((await post('/api/demo/interaction', { mood: 'cozy', intent: 'execute' })).status, demo ? 400 : 403);
    assert.equal((await post('/api/demo/interaction/reset', {})).status, demo ? 200 : 403);
    assert.equal(runtime.snapshot().demoMood, null); assert.equal(sdk, 0); assert.equal(jobs, 0);
    if (demo) { runtime.ai.setConnected(true); assert.equal(await runtime.ai.analyze(), false); assert.equal(sdk, 0); assert.equal(jobs, 0); }
  }
});
