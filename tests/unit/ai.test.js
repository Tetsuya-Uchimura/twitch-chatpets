import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/server/config.js';
import { Store } from '../../src/server/store.js';
import { ChatWindow, classify } from '../../src/server/chat.js';
import { AIAnalysis } from '../../src/server/ai.js';
import { Game } from '../../src/server/game.js';
import { createApp } from '../../src/server/app.js';

const valid = { dominantMood: 'playful', creatureType: 'chaos', energyLevel: 85, recommendedEvent: 'none', expression: 'happy', reason: 'Frequent laughter.' };
const response = value => ({ status: 'completed', output_text: JSON.stringify(value), usage: { input_tokens: 120, output_tokens: 45 } });
test('AI contextual emotion echoes the exact analysis window and rejects stale or mismatched output', async t => {
  for (const mode of ['matching', 'mismatch', 'stale']) {
    const f = fixture(t); f.add('this sucks 😡');
    f.client.responses.create = async request => {
      const window = JSON.parse(request.input[0].content).analysisWindow;
      if (mode === 'stale') f.advance(61000);
      return response({ ...valid, pulse: { windowId: mode === 'mismatch' ? 'other-window' : window.id, emotion: 'anger', confidence: .9 } });
    };
    assert.equal(await f.ai.analyze(), mode === 'matching');
    assert.equal(f.ai.lastError, mode === 'matching' ? null : 'stale_response');
    if (mode !== 'matching') { assert.equal(f.ai.lastRecommendation, null); assert.equal(f.store.state.records[0].inputTokens, 120); }
  }
});
test('unsupported model or reasoning configuration reports an error without fallback', async t => {
  const f = fixture(t); f.add(); let attempts = 0;
  f.client.responses.create = async () => { attempts++; throw Object.assign(new Error('sensitive provider error'), { status: 400 }); };
  assert.equal(await f.ai.analyze(), false); assert.equal(attempts, 1);
  assert.equal(f.ai.lastError, 'unsupported_configuration'); assert.equal(f.config.model, 'gpt-6-luna');
  f.add('Why', 'second'); assert.equal(f.game.activity, 2);
});
function fixture(t, env = {}, overrides = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'critters-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let clock = Date.UTC(2026, 9, 27, 10);
  const config = loadConfig({ DEMO_MODE: 'false', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'test-sentinel-not-real', OPENAI_ANALYSIS_INTERVAL_SECONDS:'180', ...env });
  const store = new Store(directory, config); const now = () => clock;
  const chat = new ChatWindow({ ...config }, now); const game = new Game(now);
  const calls = []; let constructed = 0;
  const client = { responses: { create: async (...args) => { calls.push(args); return response(valid); } } };
  const clientFactory = async () => { constructed++; return client; };
  const timers = new Map(); let timerId = 0;
  const ai = new AIAnalysis({ config, store, chat, now, clientFactory,
    apply: (value, evidence) => game.recommend(value, evidence),
    schedule: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    unschedule: id => timers.delete(id), ...overrides });
  t.after(() => ai.stop());
  ai.setConnected(true);
  return { ai, config, store, chat, game, calls, client, directory, timers, now,
    constructed: () => constructed,
    advance: (ms = 180000) => { clock += ms; },
    add: (text = 'LOL 😂', userId = 'viewer') => { const m = chat.accept({ text, userId }); if (m) game.accept(m); return m; },
  };
}
for (const flags of [{}, { OPENAI_API_KEY: 'present-but-unused' }, { OPENAI_API_ENABLED: 'true' }, { OPENAI_API_KEY: 'present', OPENAI_API_ENABLED: 'true' }]) {
  test(`demo never constructs SDK, schedules analysis, or calls API: ${JSON.stringify(flags)}`, async t => {
    const f = fixture(t, { DEMO_MODE: 'true', ...flags }); f.add('You got this! 😂');
    assert.equal(await f.ai.analyze(), false);
    assert.equal(f.constructed(), 0); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
    assert.equal(f.ai.snapshot().estimatedCost, 0); assert.equal(f.game.activity, 1);
    assert.throws(() => f.ai.updateSettings({ enabled: true }));
    f.ai.updateSettings({ intervalSeconds: 30, dailyBudget: .2 });
    assert.equal(f.store.state.settings.intervalSeconds, 30);
    assert.equal(f.timers.size, 0); assert.equal(await f.ai.analyze(), false);
  });
}
test('defaults disable paid AI and select Luna', () => {
  const c = loadConfig({}); assert.equal(c.enabled, false); assert.equal(c.demo, true); assert.equal(c.model, 'gpt-6-luna');
  assert.equal(c.hourlyLimit,20);assert.equal(loadConfig({OPENAI_MAX_CALLS_PER_HOUR:'0'}).hourlyLimit,0);
  assert.equal(c.dailyBudgetEnabled,true);assert.equal(loadConfig({OPENAI_DAILY_BUDGET_ENABLED:'false'}).dailyBudgetEnabled,false);
  assert.throws(()=>loadConfig({OPENAI_MAX_CALLS_PER_HOUR:'-1'}));
  assert.throws(() => loadConfig({ OPENAI_API_ENABLED: 'yes' }));
});
test('explicit zero hourly cap allows calls after twenty records while the daily budget still blocks',async t=>{
  const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0'});
  for(let i=0;i<20;i++)f.store.reserve({id:'prior-'+i,timestamp:f.now(),model:f.config.model,purpose:'reaction',inputTokens:1,outputTokens:1,estimatedCost:.00001,reservedCost:0,status:'success'});
  f.add();assert.equal(await f.ai.analyze(),true);assert.equal(f.calls.length,1);
  f.ai.updateSettings({dailyBudget:0});f.advance();f.add('LOL again');assert.equal(await f.ai.analyze(),false);assert.equal(f.calls.length,1);
});
test('disabled daily budget permits inference above the stored amount and keeps accounting/persistence',async t=>{
  const f=fixture(t,{OPENAI_MAX_CALLS_PER_HOUR:'0',OPENAI_DAILY_BUDGET_ENABLED:'false'});
  f.store.reserve({id:'spent',timestamp:f.now(),model:f.config.model,purpose:'reaction',inputTokens:1,outputTokens:1,estimatedCost:.5,reservedCost:0,status:'success'});
  f.add();assert.equal(await f.ai.analyze(),true);assert.equal(f.calls.length,1);assert.ok(f.store.totals(f.now()).dailySpent>.5);assert.equal(f.ai.snapshot().dailyBudgetEnabled,false);
  assert.equal(new Store(f.directory,f.config).state.settings.dailyBudgetEnabled,false);
  f.ai.updateSettings({dailyBudgetEnabled:true});f.advance();f.add('LOL next');assert.equal(await f.ai.analyze(),false);assert.equal(f.calls.length,1);
});
test('live disabled, disconnected, no key and empty windows cause no calls', async t => {
  for (const env of [{ OPENAI_API_ENABLED: 'false' }, { OPENAI_API_KEY: '' }, {}]) {
    const f = fixture(t, env); if (env.OPENAI_API_ENABLED) f.add();
    assert.equal(await f.ai.analyze(), false); assert.equal(f.constructed(), 0);
    f.add(); f.ai.setConnected(false); assert.equal(await f.ai.analyze(), false);
    assert.equal(f.calls.length, 0);
  }
});
test('live batches messages with aggregate-only input, Responses schema and no retries', async t => {
  const f = fixture(t); f.add('LOL 😂', 'a'); f.add('GG', 'b'); f.add('nice, you got this!', 'c');
  assert.equal(f.calls.length, 0); assert.equal(f.game.activity, 3);
  assert.equal(await f.ai.analyze(), true); assert.equal(f.calls.length, 1);
  const [request, options] = f.calls[0]; const payload = JSON.parse(request.input[0].content);
  assert.equal(payload.totalMessages, 3); assert.equal(payload.uniqueParticipants, 3);
  assert.equal(payload.localCategoryCounts.support, 2); assert.deepEqual(payload.representativeMessages, []);
  assert.equal(request.model, 'gpt-6-luna'); assert.equal(request.reasoning.effort, 'none');
  assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true);
  assert.equal(request.max_output_tokens, 250); assert.equal(options.maxRetries, 0); assert.equal(request.store, false);
  assert.equal(f.store.totals(f.now()).inputTokens, 120); assert.equal(f.store.totals(f.now()).outputTokens, 45);
  assert.equal(f.store.state.records[0].estimatedCost, .000345);
});
test('official OpenAI SDK serializes Responses requests with a fully mocked fetch transport', async t => {
  const { default: OpenAI } = await import('openai');
  const requests = [];
  const client = new OpenAI({ apiKey: 'fake-sdk-key', maxRetries: 0, fetch: async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ id: 'resp_mock', object: 'response', status: 'completed',
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(valid), annotations: [] }] }],
      usage: { input_tokens: 120, output_tokens: 45, total_tokens: 165 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const f = fixture(t, {}, { clientFactory: async () => client }); f.add();
  assert.equal(await f.ai.analyze(), true); assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].body.model, 'gpt-6-luna'); assert.equal(requests[0].body.reasoning.effort, 'none');
  assert.equal(f.ai.lastRecommendation.creatureType, 'chaos');
});
test('configured timer runs once, no catch-up calls or duplicate batch', async t => {
  const f = fixture(t, { OPENAI_ANALYSIS_INTERVAL_SECONDS: '10' });
  assert.equal([...f.timers.values()][0].ms, 10000); f.add();
  const timer = [...f.timers.values()][0]; f.advance(10000); await timer.fn();
  assert.equal(f.calls.length, 1);
  assert.equal(await f.ai.analyze(), false);
  f.advance(60000); assert.equal(await f.ai.analyze(), false);
  assert.equal(f.calls.length, 1);
  f.ai.updateSettings({ intervalSeconds: 20 }); assert.equal([...f.timers.values()].at(-1).ms, 20000);
});
test('rolling window prunes old messages and bounds Unicode input', t => {
  const f = fixture(t, { OPENAI_INCLUDE_REPRESENTATIVES: 'true', OPENAI_MAX_INPUT_CHARS: '512' });
  for (let i = 0; i < 110; i++) { f.add('頑張れ😂' + 'あ'.repeat(300), `id${i}`); f.advance(1000); }
  const batch = f.chat.aggregate(); assert.ok(batch.payload.totalMessages <= 100);
  assert.ok(JSON.stringify(batch.payload).length <= 512);
  assert.ok(!JSON.stringify(batch.payload).includes('participant'));
  f.advance(180001); assert.equal(f.chat.aggregate(), null);
});
test('Japanese, emotes, emoji, safety, duplicates and battle authorization', t => {
  const f = fixture(t);
  assert.equal(classify('頑張れ！'), 'support'); assert.equal(classify('草 😂'), 'laughter');
  assert.equal(classify('どうして？'), 'question'); assert.equal(classify('最高🔥'), 'hype');
  assert.equal(f.add('死ね'), null); assert.equal(f.add('https://spam.example'), null);
  assert.ok(f.add('LOL 😂')); f.advance(1000); assert.equal(f.add('LOL 😂'), null);
  assert.equal(f.chat.accept({ text: '!battle', userId: 'a', authorized: false }), null);
  assert.ok(f.chat.accept({ text: '!battle', userId: 'mod', authorized: true }));
  assert.equal(f.chat.accept({ text: '!battle', userId: 'mod2', authorized: true }), null);
  const clean = f.chat.accept({ text: 'hello @Alice 123456789 alice@example.com', userId: 'z' });
  assert.ok(clean.text.includes('[viewer]')); assert.ok(!clean.text.includes('123456789')); assert.ok(!clean.text.includes('@'));
});
test('hourly limits persist across restart and reset only with time', async t => {
  const f = fixture(t, { OPENAI_MAX_CALLS_PER_HOUR: '2' });
  for (let i = 0; i < 2; i++) { f.add('GG ' + i, 'a' + i); await f.ai.analyze(); f.advance(); }
  f.add('LOL', 'c'); assert.equal(await f.ai.analyze(), false); assert.equal(f.calls.length, 2);
  const reopened = new Store(f.directory, f.config); assert.equal(reopened.totals(f.now()).hourlyCalls, 2);
  const another = new AIAnalysis({ config: f.config, store: reopened, chat: f.chat, apply() {}, now: f.now,
    clientFactory: async () => { throw new Error('must not construct'); }, schedule: () => 0, unschedule() {} });
  another.setConnected(true); assert.equal(await another.analyze(), false); another.stop();
  f.advance(3600000); f.add('GG later', 'd'); assert.equal(await f.ai.analyze(), true);
});
test('daily worst-case preflight blocks small budgets and survives restart', async t => {
  const f = fixture(t, { OPENAI_DAILY_BUDGET_USD: '0.000001' }); f.add();
  assert.equal(await f.ai.analyze(), false); assert.equal(f.constructed(), 0);
  f.ai.updateSettings({ dailyBudget: .01 });
  f.client.responses.create = async (...args) => { f.calls.push(args); throw new Error('contains secret test-sentinel-not-real'); };
  assert.equal(await f.ai.analyze(), false);
  const spent = f.store.totals(f.now()).dailySpent; assert.ok(spent > 0);
  const reopened = new Store(f.directory, f.config); assert.equal(reopened.totals(f.now()).dailySpent, spent);
  assert.equal(reopened.state.settings.dailyBudget, .01); assert.ok(!JSON.stringify(reopened.state).includes('test-sentinel'));
  f.ai.updateSettings({ dailyBudget: spent }); f.advance(); f.add('another GG', 'b');
  assert.equal(await f.ai.analyze(), false); assert.equal(f.calls.length, 1);
  f.advance(86400000); f.add('tomorrow', 'c'); await f.ai.analyze(); assert.equal(f.calls.length, 2);
});
test('invalid, incomplete and arbitrary AI output rejected without changing valid state', async t => {
  const f = fixture(t); f.add(); await f.ai.analyze(); const previous = f.ai.lastRecommendation;
  for (const value of [{ ...valid, energyLevel: 101 }, { ...valid, creatureType: 'execute' }, { ...valid, recommendedEvent: '!battle' }, { ...valid, expression: 'run command' }, { ...valid, command: 'shell' }]) {
    f.advance(); f.add('another message ' + f.now(), 'b'); f.client.responses.create = async () => response(value);
    assert.equal(await f.ai.analyze(), false); assert.equal(f.ai.lastRecommendation, previous); assert.equal(f.ai.lastError, 'invalid_response');
  }
  f.advance(); f.add('more'); f.client.responses.create = async () => ({ ...response(valid), status: 'incomplete' });
  assert.equal(await f.ai.analyze(), false);
});
test('failures retain reservations; local animation interactions continue', async t => {
  const f = fixture(t); f.add(); f.client.responses.create = async () => { throw new Error('secret'); };
  assert.equal(await f.ai.analyze(), false); const initial = f.game.activity;
  f.add('GG', 'new'); assert.equal(f.game.activity, initial + 1); assert.equal(f.game.lastInteraction.action, 'eat');
  assert.equal(f.ai.lastError, 'request_failed'); assert.ok(f.store.totals(f.now()).dailySpent > 0);
});
test('missing usage and crash-pending reservations fail closed', async t => {
  const f = fixture(t); f.add(); f.client.responses.create = async () => ({ ...response(valid), usage: undefined });
  assert.equal(await f.ai.analyze(), false); assert.equal(f.ai.lastError, 'usage_missing');
  f.store.reserve({ id: 'crashed', timestamp: f.now(), model: f.config.model, inputTokens: 0, outputTokens: 0, estimatedCost: 0, reservedCost: .1, status: 'pending' });
  const reopened = new Store(f.directory, f.config); assert.ok(reopened.totals(f.now()).dailySpent >= .1);
});
test('concurrent requests prevented and disabling aborts request without applying response', async t => {
  const f = fixture(t); f.add(); let resolve;
  f.client.responses.create = (...args) => { f.calls.push(args); return new Promise(r => { resolve = r; }); };
  const first = f.ai.analyze(); await new Promise(r => setImmediate(r));
  assert.equal(f.ai.inFlight, true); assert.equal(await f.ai.analyze(), false); assert.equal(f.calls.length, 1);
  f.ai.updateSettings({ enabled: false }); assert.equal(f.calls[0][1].signal.aborted, true);
  resolve(response(valid)); await first; assert.equal(f.ai.lastRecommendation, null); assert.equal(f.ai.inFlight, false);
  assert.equal(f.ai.nextAnalysis, null);
});
test('timeouts abort SDK signal; no retry or fallback', async t => {
  const f = fixture(t, { OPENAI_TIMEOUT_MS: '100' }); f.add();
  f.client.responses.create = (...args) => { f.calls.push(args); return new Promise((resolve, reject) => {
    args[1].signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
  }); };
  // Keep the mocked transport alive while testing the unref'd cancellation timer.
  const keeper = setTimeout(() => {}, 1000);
  try { assert.equal(await f.ai.analyze(), false); } finally { clearTimeout(keeper); }
  assert.equal(f.calls.length, 1); assert.equal(f.ai.lastError, 'cancelled');
});
test('legacy AI advice cannot replace the minute emotion form; events still require evidence', t => {
  const f = fixture(t);
  f.game.recommend({ ...valid, recommendedEvent: 'hype_mode' }, { totalMessages: 2, localCategoryCounts: { laughter: 2, hype: 2 } });
  assert.equal(f.game.creatures[0].type, 'cozy'); assert.equal(f.game.event, 'none');
  const evidence = { totalMessages: 20, localCategoryCounts: { laughter: 12, support: 0, question: 0, hype: 10 } };
  f.game.recommend({ ...valid, recommendedEvent: 'hype_mode' }, evidence);
  assert.equal(f.game.creatures[0].type, 'cozy'); assert.equal(f.game.event, 'hype_mode');
  f.game.recommend({ ...valid, creatureType: 'mystic' }, { ...evidence, localCategoryCounts: { question: 15 } });
  assert.equal(f.game.creatures[0].type, 'cozy');
  f.advance(120001); f.game.recommend({ ...valid, creatureType: 'mystic' }, { ...evidence, localCategoryCounts: { question: 15 } });
  assert.equal(f.game.creatures[0].type, 'cozy');
});
test('demo runtime never opens Twitch or OpenAI and keeps local play', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'critters-demo-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = loadConfig({ DEMO_MODE: 'true', OPENAI_API_ENABLED: 'true', OPENAI_API_KEY: 'present' });
  const fail = () => { assert.fail('demo tried to create a remote client or AI timer'); };
  const runtime = createApp({ config, directory, clientFactory: fail, createSocket: fail, schedule: fail });
  runtime.start(); assert.equal(runtime.receive({ text: 'You got this! 😂', userId: 'demo' }), true);
  assert.equal(runtime.snapshot().game.activity, 1); assert.equal(runtime.snapshot().ai.estimatedCost, 0);
  runtime.stop();
});
