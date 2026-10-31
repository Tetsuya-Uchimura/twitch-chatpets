import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performanceCue, classify } from '../../src/server/chat.js';
import { Game } from '../../src/server/game.js';
import { Store } from '../../src/server/store.js';
import { loadConfig } from '../../src/server/config.js';
import { stageDefaults } from '../../src/server/stage-settings.js';
import { StageDirector, DURATIONS, actionPose } from '../../src/client/stage-model.js';
import { generateSprite, compileSprite, SPRITE_STATES, FRAME_COUNTS } from '../../src/client/mascot-sprites.js';
import { capsuleGeometry, habitatLayout } from '../../src/client/stage.js';

const settings = { ...stageDefaults };

test('Nib walk preview prepares, travels in both directions, brakes and completes cleanup', () => {
  assert.equal(performanceCue('!walk').performance, 'walk');
  assert.equal(actionPose('walk', 100).x, actionPose('walk', 0).x);
  assert.equal(actionPose('walk', 100).primitive, 'gait-start');
  assert.equal(actionPose('walk', 1500).action, 'walk'); assert.equal(actionPose('walk', 3500).facing, -1);
  assert.equal(actionPose('walk', 4800).primitive, 'gait-stop');
  const director = new StageDirector(); director.reset(1000);
  director.receive({ sequence: 1, text: '!walk', performance: 'walk' }, 1000, { tempo: 112 });
  director.tick(1000 + DURATIONS.walk + 10, { tempo: 112, ambient: false });
  assert.ok(director.completed.some(value => value.sequence === 1 && !value.cancelled));
});
test('semantic local cues map support/laughter/hype/question/battle to game actions', () => {
  for (const [text, act] of [['!jump hi', 'jump'], ['ジャンプして', 'jump'], ['おやすみ zzz', 'sleep'], ['good night', 'sleep'],
    ['お腹すいた 🍜', 'eat'], ['pizza time', 'eat'], ['!dance', 'happy'], ['!powerup', 'powerup'], ['bruh…', 'recoil'],
    ['LOL 😂', 'play'], ['どうして？', 'inspect'], ['GG ❤', 'eat'], ['POG 🔥', 'dash'], ['!battle', 'attack']]) {
    assert.equal(performanceCue(text).performance, act, text);
    assert.ok(['neutral', 'laughter', 'hype', 'question', 'support', 'battle'].includes(classify(text)));
  }
});
test('one mascot receives all messages and retains its identity through evolution', () => {
  const game = new Game(() => 1000);
  for (let i = 0; i < 20; i++) assert.equal(game.accept({ sequence: i + 1, category: 'laughter', text: 'LOL' }).creatureId, 0);
  assert.equal(game.creatures.length, 1); assert.equal(game.creatures[0].name, 'Nib');
  assert.equal(game.creatures[0].xp, 20); assert.equal(game.creatures[0].type, 'cozy', 'instant chat reactions no longer decide evolution');
});
test('combo stickers require evidence and a per-type cooldown', () => {
  let now = 1000, sequence = 0; const game = new Game(() => now);
  const accept = (category, performance) => game.accept({ sequence: ++sequence, category, performance, text: 'test' });
  assert.equal(accept('laughter', 'play').emote, null); now += 1000;
  assert.equal(accept('laughter', 'play').emote, null); now += 1000;
  assert.equal(accept('laughter', 'play').emote, 'kekw'); assert.equal(accept('laughter', 'play').emote, null);
  now += 17000; accept('laughter', 'play'); now += 1000; accept('laughter', 'play'); now += 1000;
  assert.equal(accept('laughter', 'play').emote, 'kekw');
  accept('neutral', 'recoil'); accept('neutral', 'recoil'); assert.equal(accept('neutral', 'recoil').emote, 'bruh');
  for (let i = 0; i < 200; i++) accept('neutral', 'eat'); assert.ok(game.burst.length <= 40);
});
test('sparse moods never complete a combo', () => {
  let now = 1000; const game = new Game(() => now);
  for (let i = 0; i < 3; i++) { assert.equal(game.accept({ sequence: i + 1, category: 'hype', text: 'Pog' }).emote, null); now += 13000; }
});
test('notice, chase, bite, result and return form a short readable interaction', () => {
  const director = new StageDirector(); director.reset(1000);
  director.receive({ sequence: 1, performance: 'eat', text: 'GG' }, 1000, settings);
  for (const [elapsed, action, phase] of [[100, 'notice', 'notice'], [400, 'walk', 'chase'], [850, 'eat', 'interact'], [1500, 'happy', 'result'], [2000, 'walk', 'return']]) {
    const [actor] = director.tick(1000 + elapsed, settings); assert.equal(actor.action, action); assert.equal(actor.phase, phase);
  }
  assert.equal(director.tick(1000 + DURATIONS.eat + 1, settings)[0].action, 'idle');
});
test('jump clears the low capsule; another message does not reset the current act', () => {
  const director = new StageDirector(); director.reset(1000);
  director.receive({ sequence: 1, performance: 'jump', text: 'hop' }, 1000, settings);
  director.receive({ sequence: 2, performance: 'eat', text: 'GG' }, 1100, settings);
  const mid = director.tick(1000 + 985, settings)[0]; assert.equal(mid.performance, 'jump'); assert.ok(mid.jump < -40, 'Calm uses a gentler arc while still clearing the capsule.');
  assert.ok(184 + mid.jump < mid.capsuleY - 15);
  const next = director.tick(1001 + DURATIONS.jump, settings)[0]; assert.equal(next.performance, 'eat'); assert.equal(next.progress, 0);
});
test('sleep wakes on chat; legacy cast identifiers never create extra actors', () => {
  const director = new StageDirector(); director.reset(1000);
  director.receive({ sequence: 1, creatureId: 2, performance: 'sleep', text: 'zzz' }, 1000, settings);
  assert.equal(director.tick(1800, settings)[0].action, 'sleep');
  director.receive({ sequence: 2, creatureId: 1, performance: 'dash', text: 'POG' }, 1900, settings);
  const actors = director.tick(2000, { ...settings, cast: 'trio' }); assert.equal(actors.length, 1); assert.equal(actors[0].performance, 'dash');
});
test('quiet life patrols and naps, without decorative actors or API work', () => {
  const director = new StageDirector(); director.reset(1000);
  for (const [elapsed, action] of [[0, 'idle'], [5000, 'walk'], [9500, 'notice'], [13000, 'sleep'], [20000, 'notice'], [23000, 'walk']]) {
    assert.equal(director.tick(1000 + elapsed, settings)[0].action, action);
  }
  assert.equal(director.tick(30000, { ...settings, ambient: false })[0].action, 'idle');
});
test('text, queued work, stickers and impact effects remain bounded under load', () => {
  const director = new StageDirector(); director.reset(1000);
  for (let i = 1; i < 201; i++) director.receive({ sequence: i, creatureId: i % 3, performance: 'eat', text: 'hi', emote: 'kekw' }, 1000 + i, settings);
  assert.ok(director.notes.length <= 8); assert.ok(director.stickers.length <= 2); assert.ok(director.actors[0].queue.length <= 3);
  director.tick(2100, settings); const count = director.effects.length;
  for (let i = 0; i < 20; i++) director.tick(2110 + i, settings);
  assert.equal(director.effects.length, count, 'Impact must be emitted once, not every animation frame.');
  director.tick(2500, { ...settings, emotes: false }); assert.equal(director.stickers.length, 0);
  director.tick(20000, settings); assert.equal(director.notes.length, 0); assert.equal(director.actors[0].current, null);
});
test('unknown animations fall back to a safe action, and duplicates are ignored', () => {
  const director = new StageDirector(); director.reset(1000);
  director.receive({ sequence: 1, performance: 'execute code', text: '<b>hello</b>', emote: 'evil' }, 1000, settings);
  assert.equal(director.tick(1100, settings)[0].performance, 'eat'); assert.equal(director.stickers.length, 0);
  assert.equal(director.receive({ sequence: 1, performance: 'attack' }, 1200, settings), false);
});
test('all eleven pixel animation states produce small valid limited-palette frames', () => {
  for (const state of SPRITE_STATES) for (let frame = 0; frame < FRAME_COUNTS[state]; frame++) {
    const sprite = generateSprite(state, frame); assert.equal(sprite.width, 40); assert.equal(sprite.height, 36);
    assert.equal(sprite.pixels.length, 1440); assert.ok(sprite.palette.length <= 10);
    assert.ok([...sprite.pixels].every(index => index >= 0 && index < sprite.palette.length));
    assert.ok(sprite.pixels.filter(n => n > 0).length > 300, state);
  }
  const frames = Array.from({ length: 4 }, (_, f) => Buffer.from(generateSprite('run', f).pixels).toString('hex'));
  assert.equal(new Set(frames).size, 4, 'Run must contain distinct readable frames.');
});
test('evolution preserves more than 95% of sprite pixels and the mint body palette', () => {
  const original = generateSprite('idle', 0);
  for (const form of ['chaos', 'mystic']) {
    const evolved = generateSprite('idle', 0, form);
    const changes = evolved.pixels.reduce((sum, pixel, i) => sum + (pixel !== original.pixels[i] ? 1 : 0), 0);
    assert.ok(changes / original.pixels.length < .05); assert.equal(evolved.palette[2], original.palette[2]); assert.notEqual(evolved.palette[7], original.palette[7]);
  }
});
test('CPU pixel spans reproduce every sprite frame exactly without a canvas cache', () => {
  for (const form of ['cozy', 'chaos', 'mystic']) for (const action of SPRITE_STATES) for (let frame = 0; frame < FRAME_COUNTS[action]; frame++) {
    const expected = generateSprite(action, frame, form), compiled = compileSprite(action, frame, form);
    const actual = new Uint8Array(compiled.width * compiled.height);
    for (const [color, spans] of compiled.colors) for (const span of spans) {
      for (let x = span.x; x < span.x + span.width; x++) actual[span.y * compiled.width + x] = color;
    }
    assert.deepEqual(actual, expected.pixels); assert.ok(actual.some(pixel => pixel === 2));
  }
});
test('corner layout uses integer sprite pixels at regular and fractional DPR', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) for (const scale of [.65, 1, 1.4]) for (const anchor of ['left', 'center', 'right']) {
    const layout = habitatLayout(1280 * dpr, 720 * dpr, dpr, { ...settings, scale, anchor }, true);
    assert.ok(Number.isInteger(layout.unit)); assert.ok(Number.isInteger(layout.x)); assert.ok(Number.isInteger(layout.y));
    assert.ok(layout.x >= 0); assert.ok(layout.y >= 0); assert.ok(layout.x + layout.width <= 1280 * dpr); assert.ok(layout.y + layout.height <= 720 * dpr);
    assert.ok(layout.width / dpr <= 448); assert.ok(layout.height / dpr <= 532);
  }
});
test('capsules keep a 40–100% body-width ratio and truncate long Japanese/emoji text', () => {
  const ctx = { font: '', measureText(text) { const size = Number(this.font.match(/(\d+)px/)[1]); return { width: [...text].reduce((n, ch) => n + size * (ch.charCodeAt(0) > 127 ? 1 : .6), 0) }; } };
  for (const body of [80, 120, 240]) for (const text of ['GG', '頑張れ！😂'.repeat(30), 'a'.repeat(240)]) {
    const capsule = capsuleGeometry(ctx, text, body, body / 120, 1);
    assert.ok(capsule.ratio >= .4 && capsule.ratio <= 1); assert.ok(capsule.fontSize >= 12);
    assert.ok(capsule.width <= body); if (text.length > 100) assert.ok(capsule.label.endsWith('…'));
  }
});
test('all actions remain within the compact habitat and attack/recoil/power-up are distinct', () => {
  for (const action of Object.keys(DURATIONS)) for (let t = 0; t < DURATIONS[action]; t += 100) {
    const pose = actionPose(action, t); assert.ok(Number.isFinite(pose.x)); assert.ok(pose.x >= 62 && pose.x <= 298);
    assert.ok(pose.jump >= -70 && pose.jump <= 0);
  }
  assert.equal(actionPose('attack', 1050).action, 'attack'); assert.equal(actionPose('recoil', 1050).action, 'hurt'); assert.equal(actionPose('powerup', 1050).action, 'evolve');
});
test('old trio settings migrate to one mascot without changing billing records or AI settings', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'critters-pixel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const record = { id: 'prior', timestamp: Date.now(), model: 'gpt-6-luna', inputTokens: 100, outputTokens: 10, estimatedCost: .00015, reservedCost: .01, status: 'success' };
  const original = { version: 1, settings: { enabled: false, intervalSeconds: 180, dailyBudget: .1 }, records: [record], stageSettings: { ...settings, cast: 'trio', scale: 1.2 } };
  fs.writeFileSync(path.join(directory, 'ai-state.json'), JSON.stringify(original));
  const store = new Store(directory, loadConfig({})); assert.equal(store.state.stageSettings.cast, 'solo'); assert.equal(store.state.stageSettings.scale, 1.2);
  assert.deepEqual(store.state.records, [record]); assert.deepEqual(store.state.settings, {...original.settings,dailyBudgetEnabled:true});
  store.stageSettings({ ...settings, tempo: 140, anchor: 'left' });
  const reopened = new Store(directory, loadConfig({})); assert.equal(reopened.state.stageSettings.cast, 'solo'); assert.equal(reopened.state.stageSettings.tempo, 140);
  assert.deepEqual(reopened.state.records, [record]); assert.deepEqual(reopened.state.settings, {...original.settings,dailyBudgetEnabled:true});
});
