import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { classifyEmotion, EMOTIONS } from '../../src/shared/pulse-classifier.js';
import { ChatPulse } from '../../src/server/pulse.js';
import { ChatWindow } from '../../src/server/chat.js';
import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { StageDirector, DURATIONS } from '../../src/client/stage-model.js';
import { generateSprite, SPRITE_STATES } from '../../src/client/mascot-sprites.js';
import { activityHeight } from '../../src/client/pulse-view.js';

const base = Date.UTC(2026, 9, 27, 12);
function fixture(options = {}) {
  let clock = base, sequence = 0;
  const pulse = new ChatPulse(options, () => clock);
  return { pulse, at: offset => { clock = base + offset; }, now: () => clock,
    add(text, participant = `user-${sequence}`) { return pulse.ingest({ at: clock, sequence: ++sequence, text, participant }); } };
}
for (const [emotion, texts] of Object.entries({ calm: ['こんにちは', 'まったり', 'いい感じ', 'hello cozy chat'],
  laughter: ['LOL', '草', 'ｗｗｗ', '😂', 'LMAO', '最悪www'], excitement: ['すごい', 'やった', "LET’S GO", 'HYPE', '🔥'],
  anger: ['ひどい', '最悪', 'ふざけんな', 'This is frustrating', '😡'], confusion: ['どういうこと', 'わからない', 'Why', "I'm confused", '🤔'] })) {
  test(`contextual EN/JA/emoji classification: ${emotion}`, () => {
    for (const text of texts) assert.equal(classifyEmotion(text).emotion, emotion, text);
  });
}
test('ambiguous, negated and ordinary punctuation stay unknown', () => {
  for (const text of ['one two three', '!', '123', '!jump', 'not angry', '怒ってない']) assert.equal(classifyEmotion(text).emotion, null, text);
});
test('60s proportions count only classified accepted messages; expiry clears real data', () => {
  const f = fixture(); f.at(1000);
  for (const text of ['LOL', '草', 'hello', 'Why', 'unclassified', '123']) f.add(text);
  f.at(59000); assert.equal(f.pulse.snapshot().classified, 0, 'Summary is not updated on every message.');
  f.at(60000); let p = f.pulse.snapshot();
  assert.equal(p.classified, 4); assert.equal(p.unknown, 2); assert.equal(p.accepted, 6);
  assert.deepEqual(p.fractions, { calm: .25, laughter: .5, excitement: 0, anger: 0, confusion: .25 });
  assert.equal(Object.values(p.fractions).reduce((a, b) => a + b), 1);
  assert.equal(p.insufficient, true); assert.equal(p.emotion, 'calm');
  f.at(120000); p = f.pulse.snapshot(); assert.equal(p.classified, 0); assert.equal(p.unknown, 0);
  assert.ok(Object.values(p.fractions).every(v => v === 0)); assert.equal(p.confidence, 0);
});
test('activity has twelve aligned actual-count buckets with a distinct partial current minute', () => {
  const f = fixture(); f.at(1000); f.add('unknown'); f.add('LOL');
  f.at(61000); f.add('hello'); f.at(125000);
  const p = f.pulse.snapshot(); assert.equal(p.activity.length, 12);
  assert.deepEqual(p.activity.slice(-3).map(b => b.count), [2, 1, 0]);
  assert.equal(p.activity.filter(b => b.partial).length, 1); assert.equal(p.activity.at(-1).partial, true);
  assert.equal(p.activity[0].available, false); assert.equal(p.activity.at(-1).available, true);
  assert.equal(p.activity.at(-1).start, base + 120000);
  f.at(13 * 60000); assert.ok(f.pulse.snapshot().activity.every(b => b.count === 0));
});
test('one shared log scale preserves quiet bars and actual ratios beside a spike', () => {
  const h1 = activityHeight(1, 256), h10 = activityHeight(10, 256), h180 = activityHeight(180, 256);
  assert.ok(h1 > .1); assert.ok(h10 > h1 && h180 > h10 && h180 <= 1); assert.equal(activityHeight(0, 256), 0);
});
test('local demo ties keep the mood, and five messages from one viewer can change it', () => {
  const f = fixture(); f.at(1000); for (let i = 0; i < 8; i++) f.add('😡');
  f.at(60000); assert.equal(f.pulse.snapshot().emotion, 'anger');
  f.at(61000); for (const text of ['LOL', 'LOL', '🔥', '🔥', 'hello', 'hello']) f.add(text);
  f.at(120000); assert.equal(f.pulse.snapshot().emotion, 'anger');
  f.at(121000); for (let i = 0; i < 8; i++) f.add('LOL', 'one-person');
  f.at(180000); assert.equal(f.pulse.snapshot().emotion, 'laughter'); assert.equal(f.pulse.snapshot().insufficient, false);
});
test('configurable cooldown prevents oscillation across successive 60s summaries', () => {
  const f = fixture({ cooldownSeconds: 180 }); f.at(1000); for (let i = 0; i < 6; i++) f.add('LOL');
  f.at(60000); assert.equal(f.pulse.snapshot().emotion, 'laughter');
  f.at(61000); for (let i = 0; i < 6; i++) f.add('Why');
  f.at(120000); assert.equal(f.pulse.snapshot().emotion, 'laughter');
  f.at(181000); for (let i = 0; i < 6; i++) f.add('Why');
  f.at(240000); assert.equal(f.pulse.snapshot().emotion, 'confusion');
});
test('deduplication and anti-spam happen before either chart accepts a message', () => {
  const f = fixture(), chat = new ChatWindow(loadConfig({}), f.now);
  const accept = (text, userId) => { const m = chat.accept({ text, userId }); if (m) f.pulse.ingest(m); return m; };
  f.at(1000); const first = accept('LOL', 'one'); assert.ok(first);
  assert.equal(accept('LOL', 'one'), null); assert.equal(accept('Why', 'one'), null);
  assert.equal(accept('https://spam.example', 'two'), null); assert.equal(f.pulse.ingest(first), false);
  f.at(60000); const p = f.pulse.snapshot(); assert.equal(p.classified, 1); assert.equal(p.activity.at(-2).count, 1);
});
test('high angry activity stays anger, and every immediate action retains that underlying expression', () => {
  const f = fixture(); f.at(1000); for (let i = 0; i < 180; i++) f.add('frustrating 😡');
  f.at(60000); const p = f.pulse.snapshot(); assert.equal(p.emotion, 'anger'); assert.equal(p.counts.excitement, 0);
  assert.equal(p.activity.at(-2).count, 180);
  for (const performance of Object.keys(DURATIONS)) {
    const director = new StageDirector(), settings = { tempo: 112, ambient: true, emotes: true, emotion: 'anger' };
    director.reset(1000); director.receive({ sequence: 1, performance, text: '!action' }, 1000, settings);
    const actor = director.tick(2000, settings)[0]; assert.equal(actor.performance, performance); assert.equal(actor.emotion, 'anger');
  }
});
test('emotion changes wait for a safe action boundary, including a queued action', () => {
  for (const performance of ['eat', 'dash', 'attack']) {
    const d = new StageDirector(), calm = { tempo: 112, ambient: true, emotes: true, emotion: 'calm' }, angry = { ...calm, emotion: 'anger' };
    d.reset(1000); d.receive({ sequence: 1, performance, text: 'test' }, 1000, calm);
    d.receive({ sequence: 2, performance: 'jump', text: 'test2' }, 1100, angry);
    assert.equal(d.tick(1800, angry)[0].emotion, 'calm');
    const actor = d.tick(1001 + DURATIONS[performance], angry)[0];
    assert.equal(actor.emotion, 'anger'); assert.equal(actor.performance, 'jump');
  }
});
test('all emotion sprites retain the mint identity and anger/confusion/laughter alter actual facial pixels', () => {
  const original = generateSprite();
  for (const emotion of EMOTIONS) for (const state of SPRITE_STATES) {
    const sprite = generateSprite(state, 0, 'cozy', emotion);
    assert.equal(sprite.palette[2], '#a8e77a'); assert.ok(sprite.pixels.filter(p => p === 2).length > 100);
    if (state === 'idle' && ['anger', 'confusion', 'laughter'].includes(emotion)) assert.notDeepEqual(sprite.pixels, original.pixels);
  }
});
test('AI advice is window-bound, expires, and never changes measured counts or activity', () => {
  const f = fixture(); f.at(1000); for (let i = 0; i < 8; i++) f.add('😡'); f.at(60000);
  const before = f.pulse.snapshot(), window = { id: 'window-a', end: f.now() };
  assert.equal(f.pulse.refine({ windowId: 'wrong', emotion: 'excitement', confidence: 1 }, window), false);
  assert.equal(f.pulse.refine({ windowId: 'window-a', emotion: 'excitement', confidence: 1 }, window), true);
  const after = f.pulse.snapshot(); assert.deepEqual(after.counts, before.counts); assert.deepEqual(after.activity, before.activity);
  assert.equal(after.emotion, 'anger');
  assert.equal(f.pulse.refine({ windowId: 'window-a', emotion: 'calm', confidence: 1 }, window), false);
  f.at(121000); assert.equal(f.pulse.refine({ windowId: 'window-b', emotion: 'calm', confidence: 1 }, { id: 'window-b', end: base + 60000 }), false);
});
test('failed minute AI preserves activity and immediate actions without fabricating sentiment', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-failure-')); let clock = base, attempts = 0;
  const runtime = createApp({ directory, now: () => clock,
    config: loadConfig({ DEMO_MODE: 'false', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'sentinel' }),
    schedule: () => 1, unschedule: () => {}, clientFactory: () => ({ responses: { create: async () => { attempts++; throw new Error('simulated failure'); } } }) });
  t.after(() => { runtime.stop(); assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  runtime.ai.setConnected(true); clock += 1000;
  for (let i = 0; i < 6; i++) runtime.receive({ text: '😡', userId: `angry-${i}` });
  assert.equal(await runtime.ai.analyze(), false); assert.equal(attempts, 0);
  clock = base + 60000; assert.equal(await runtime.ai.analyze(),false);assert.equal(attempts,1);assert.equal(runtime.snapshot().pulse.emotion,'calm');
  clock += 1000; for (let i = 0; i < 6; i++) runtime.receive({ text: 'LOL', userId: `laugh-${i}` });
  runtime.receive({ text: '!jump', userId: 'action' }); assert.equal(runtime.game.lastInteraction.performance, 'jump');
  clock = base + 120000; const state = runtime.snapshot();
  assert.equal(state.pulse.emotion, 'calm'); assert.equal(state.pulse.classified, 6); assert.equal(state.pulse.unknown, 1);
  assert.equal(state.pulse.activity.reduce((sum, b) => sum + b.count, 0), 13); assert.equal(attempts, 1);
});
test('all demo scenarios replay twelve real accepted-count buckets with zero SDK/timers/Twitch calls', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'critters-pulse-'));
  let sdk = 0, timers = 0, sockets = 0;
  const runtime = createApp({ directory, now: () => base + 30000, config: loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'sentinel' }),
    clientFactory: () => { sdk++; throw new Error('forbidden'); }, schedule: () => { timers++; }, createSocket: () => { sockets++; throw new Error('forbidden'); } });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening'); runtime.start();
  t.after(async () => { runtime.stop(); await new Promise(r => server.close(r));
    assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const scenario of [...EMOTIONS, 'spike']) {
    const res = await fetch(url + '/api/demo/pulse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) });
    assert.equal(res.status, 200); const result = await res.json(), state = runtime.snapshot();
    assert.equal(state.pulse.emotion, scenario === 'spike' ? 'calm' : scenario);
    assert.equal(state.pulse.simulated, true); assert.equal(state.pulse.activity.length, 12);
    assert.ok(state.pulse.activity.every(b => b.available && b.count > 0));
    assert.equal(state.pulse.activity.reduce((sum, b) => sum + b.count, 0), result.accepted);
    assert.equal(state.pulse.insufficient, false); assert.equal(state.ai.estimatedCost, 0); assert.equal(state.demoAutoplay, false);
    assert.equal(await runtime.ai.analyze(), false);
    if (scenario === 'spike') assert.equal(Math.max(...state.pulse.activity.map(b => b.count)), 180);
  }
  assert.equal(sdk, 0); assert.equal(timers, 0); assert.equal(sockets, 0); assert.equal(runtime.store.state.records.length, 0);
});
