import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { once, EventEmitter } from 'node:events';
import http from 'node:http';
import dotenv from 'dotenv';
import { loadConfig } from '../../src/server/config.js';
import { createApp, controlGuard } from '../../src/server/app.js';
import { parseIRC, Twitch } from '../../src/server/twitch.js';
import { acquireLock, Store } from '../../src/server/store.js';

async function serve(t, env = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'critters-http-'));
  const config = loadConfig({ OPENAI_API_KEY: 'sentinel-test-key-never-publish', DEMO_MODE: 'true', ...env });
  const runtime = createApp({ config, directory, clientFactory() { assert.fail('HTTP test attempted API access'); }, createSocket() { assert.fail('HTTP test attempted Twitch access'); } });
  const server = runtime.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { runtime.stop(); await new Promise(r => server.close(r)); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', value, headers = {}) => fetch(base + url, { method,
    headers: { ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: value === undefined ? undefined : JSON.stringify(value) });
  return { runtime, config, directory, base, request };
}
test('localhost dashboard, offline assets, SSE messages and demo controls', async t => {
  const f = await serve(t);
  const page = await f.request('/'); assert.equal(page.status, 200); assert.ok((await page.text()).includes('Chat Critters'));
  assert.ok(page.headers.get('content-security-policy').includes("connect-src 'self'"));
  for (const asset of ['/app.js', '/style.css', '/tokens.css']) assert.equal((await f.request(asset)).status, 200);
  const stream = await fetch(f.base + '/api/events'); const reader = stream.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); assert.ok(first.includes('event: state'));
  const result = await f.request('/api/demo/message', 'POST', { text: 'You got this! 😂' }); assert.equal((await result.json()).accepted, true);
  const next = new TextDecoder().decode((await reader.read()).value); assert.ok(next.includes('interaction')); assert.ok(next.includes('😂'));
  await reader.cancel();
  assert.equal((await f.request('/api/ai/settings', 'PATCH', { enabled: true })).status, 409);
  assert.equal((await f.request('/api/ai/settings', 'PATCH', { intervalSeconds: 30, dailyBudget: .2 })).status, 200);
  const reopened = new Store(f.directory, f.config); assert.equal(reopened.state.settings.intervalSeconds, 30); assert.equal(reopened.state.settings.dailyBudget, .2);
  assert.equal((await f.request('/api/ai/settings', 'PATCH', { intervalSeconds: 0 })).status, 400);
  assert.equal((await f.request('/api/ai/settings', 'PATCH', { model: 'expensive' })).status, 400);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { tempo: 136, cast: 'solo', anchor: 'left' })).status, 200);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { tempo: 999 })).status, 400);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { animationURL: 'remote' })).status, 400);
  assert.equal(new Store(f.directory, f.config).state.stageSettings.tempo, 136);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { rotationSeconds: 120 })).status, 200);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { tempo: 130 })).status, 200);
  assert.equal(new Store(f.directory, f.config).state.stageSettings.rotationSeconds, 120);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { rotationSeconds: 14 })).status, 400);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { castMode: 'fixed', selectedCast: 'bront' })).status, 200);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { rotationSeconds: 30 })).status, 200);
  const fixed = new Store(f.directory, f.config).state.stageSettings;
  assert.equal(fixed.castMode, 'fixed'); assert.equal(fixed.selectedCast, 'bront');
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { selectedCast: 'sena' })).status, 400);
  assert.equal((await f.request('/api/stage/settings', 'PATCH', { castMode: 'random' })).status, 200);
  const random = new Store(f.directory, f.config).state.stageSettings;
  assert.equal(random.castMode, 'random'); assert.equal(random.selectedCast, 'bront');
  assert.equal((await f.request('/api/demo/playback', 'POST', { enabled: false })).status, 200);
  assert.equal(f.runtime.snapshot().demoAutoplay, false);
  const reset = await f.request('/api/visuals/reset', 'POST', {}); assert.equal((await reset.json()).game.activity, 0);
});
test('daily budget enforcement can be disabled and restored through saved settings without deleting the amount',async t=>{
  const f=await serve(t);
  assert.equal((await f.request('/api/ai/settings','PATCH',{dailyBudgetEnabled:false})).status,200);
  let saved=new Store(f.directory,f.config);assert.equal(saved.state.settings.dailyBudgetEnabled,false);assert.equal(saved.state.settings.dailyBudget,.1);
  const ai=(await(await f.request('/api/state')).json()).ai;assert.equal(ai.dailyBudgetEnabled,false);assert.equal(typeof ai.dailyBudgetRemaining,'number');
  assert.equal((await f.request('/api/ai/settings','PATCH',{dailyBudgetEnabled:'false'})).status,400);
  assert.equal((await f.request('/api/ai/settings','PATCH',{dailyBudgetEnabled:true})).status,200);saved=new Store(f.directory,f.config);assert.equal(saved.state.settings.dailyBudgetEnabled,true);
});
test('settings reject cross-site requests, spoofed host and non-local sockets', async t => {
  const f = await serve(t);
  assert.equal((await f.request('/api/ai/settings', 'PATCH', { enabled: false }, { Origin: 'https://evil.example' })).status, 403);
  const spoofedHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(f.base + '/api/ai/settings', { method: 'PATCH', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(JSON.stringify({ enabled: false }));
  });
  assert.equal(spoofedHostStatus, 403);
  const res = { code: 200, status(code) { this.code = code; return this; }, json() {} };
  controlGuard({ socket: { remoteAddress: '192.168.1.5' }, headers: { host: 'localhost', 'x-forwarded-for': '127.0.0.1' } }, res, () => assert.fail('allowed remote socket'));
  assert.equal(res.code, 403);
  const wrongType = await fetch(f.base + '/api/ai/settings', { method: 'PATCH', body: 'enabled=false' }); assert.equal(wrongType.status, 415);
});
test('live rejects demo messages and a Twitch connection alone never enables AI', async t => {
  const f = await serve(t, { DEMO_MODE: 'false', OPENAI_API_ENABLED: 'false' });
  f.runtime.ai.setConnected(true);
  assert.equal((await f.request('/api/demo/message', 'POST', { text: 'hi' })).status, 403);
  f.runtime.receive({ text: 'GG', username: 'Alice', displayName: 'Alice', userId: '1234567' });
  assert.equal(await f.runtime.ai.analyze(), false);
  const state = await (await f.request('/api/state')).json(); assert.equal(state.ai.mode, 'OFF'); assert.equal(state.game.activity, 1);
  f.runtime.receive({ text: 'GG ALICE 1234567', username: 'Alice', displayName: 'Alice', userId: 'other' });
  assert.ok(!f.runtime.game.lastInteraction.text.includes('ALICE'));
});
test('no credentials in browser assets, API responses, or static file routes', async t => {
  const f = await serve(t);
  let secrets = ['sentinel-test-key-never-publish'];
  const envFile = path.resolve('.env');
  if (fs.existsSync(envFile)) { const key = dotenv.parse(fs.readFileSync(envFile)).OPENAI_API_KEY; if (key) secrets.push(key); }
  const publicFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name); return entry.isDirectory() ? publicFiles(file) : [file];
  });
  for (const file of [...publicFiles('src/client'), ...publicFiles('src/shared')]) {
    const asset = fs.readFileSync(file);
    for (const secret of secrets) assert.ok(!asset.includes(secret), 'Public asset must not contain an API credential.');
    if (/\.(?:html|js|css|json|svg)$/i.test(file)) assert.ok(!/https?:\/\//.test(asset.toString('utf8').replaceAll('http://www.w3.org/2000/svg', '')), 'Assets must load only local resources.');
  }
  const state = await (await f.request('/api/state')).text();
  for (const secret of secrets) assert.ok(!state.includes(secret), 'API state must not include credentials.');
  assert.equal((await f.request('/shared/nib-forms.js')).status, 200);
  for (const file of ['/.env', '/.git/config', '/src/server/config.js', '/server/config.js', '/data/ai-state.json', '/node_modules/openai/package.json']) assert.equal((await f.request(file)).status, 404);
});
test('Twitch parsing honors trusted moderator tags and rejects forged text commands', () => {
  const mod = parseIRC('@badges=moderator/1;mod=1;user-id=123;display-name=Alice :alice!alice@alice.tmi.twitch.tv PRIVMSG #channel :!battle', 'channel');
  assert.equal(mod.authorized, true); assert.equal(mod.userId, '123');
  assert.equal(parseIRC(':alice!a@a PRIVMSG #channel :mod=1 !battle', 'channel').authorized, false);
  assert.equal(parseIRC(':alice!a@a PRIVMSG #other :GG', 'channel'), null);
  assert.equal(parseIRC('@badges=broadcaster/1;mod=0 :owner!a@a PRIVMSG #channel :!battle', 'channel').authorized, true);
});
test('Twitch mocked transport joins, handles ping, and emits immediate messages', () => {
  const socket = new EventEmitter(); const sent = []; const messages = []; const connections = [];
  socket.send = text => sent.push(text); socket.close = () => {};
  const twitch = new Twitch({ config: loadConfig({ DEMO_MODE: 'false', TWITCH_CHANNEL: 'channel' }),
    createSocket: () => socket, onMessage: m => messages.push(m), onConnected: v => connections.push(v) });
  twitch.connect(); socket.emit('open'); assert.ok(sent.includes('JOIN #channel'));
  const nickname = sent.find(line => line.startsWith('NICK ')).slice(5);
  socket.emit('message', Buffer.from(`PING :tmi.twitch.tv\r\n:${nickname}!a@a JOIN #channel\r\n:alice!a@a PRIVMSG #channel :草 😂\r\n`));
  assert.ok(sent.includes('PONG :tmi.twitch.tv')); assert.ok(connections.includes(true)); assert.equal(messages[0].text, '草 😂');
  twitch.stop(); assert.equal(connections.at(-1), false);
});
test('corrupt budget file fails closed; second server cannot share a ledger', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critters-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = acquireLock(dir); assert.throws(() => acquireLock(dir)); release();
  fs.writeFileSync(path.join(dir, 'ai-state.json'), '{bad json'); assert.throws(() => new Store(dir, loadConfig({})));
});

test('container network mode is explicit and retains localhost Host, origin and JSON controls', async t => {
  assert.equal(loadConfig({}).bindHost,'127.0.0.1');
  assert.equal(loadConfig({APP_NETWORK_MODE:'container'}).bindHost,'0.0.0.0');
  assert.throws(()=>loadConfig({APP_NETWORK_MODE:'public'}));
  const req={method:'PATCH',socket:{remoteAddress:'172.20.0.1'},headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'},is:type=>type==='application/json'};
  const res={code:200,status(code){this.code=code;return this;},json(){}};
  let accepted=0;
  controlGuard(req,res,()=>accepted++,{container:true});assert.equal(accepted,1);
  for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}]){
    res.code=200;controlGuard({...req,headers:{...req.headers,...headers}},res,()=>assert.fail('container allowed invalid origin/host'),{container:true});assert.equal(res.code,403);
  }
  controlGuard(req,res,()=>assert.fail('local mode accepted bridge socket'));assert.equal(res.code,403);
  const f=await serve(t,{APP_NETWORK_MODE:'container'});
  const health=await f.request('/healthz');assert.deepEqual(await health.json(),{status:'ok'});
});

test('locks never clear another runtime namespace or host, even when its PID looks stale',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nib-namespaced-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'server.lock'),release=acquireLock(dir),original=fs.readFileSync(file,'utf8');
  assert.throws(()=>acquireLock(dir,{namespace:'container'}));assert.equal(fs.readFileSync(file,'utf8'),original);
  const other={...JSON.parse(original),host:'another-runtime',pid:2147483647};fs.writeFileSync(file,JSON.stringify(other));
  assert.throws(()=>acquireLock(dir));release();assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),other);
  fs.writeFileSync(file,String(process.pid));assert.throws(()=>acquireLock(dir,{namespace:'container'}));assert.equal(fs.readFileSync(file,'utf8'),String(process.pid));
  fs.unlinkSync(file);const done=acquireLock(dir);done();done();assert.equal(fs.existsSync(file),false);
});
