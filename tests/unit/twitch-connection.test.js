import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Twitch } from '../../src/server/twitch.js';
import { loadConfig } from '../../src/server/config.js';
import { createApp } from '../../src/server/app.js';

class Socket extends EventEmitter {
  constructor() { super(); this.sent = []; this.pings = []; this.closed = false; }
  send(value) { if (this.closed) throw new Error('closed'); this.sent.push(value); }
  ping(value) { if (this.closed) throw new Error('closed'); this.pings.push(Buffer.from(value)); }
  terminate() { this.closed = true; this.emit('close'); }
  close() { this.terminate(); }
  line(value) { this.emit('message', Buffer.from(value + '\r\n')); }
  join() { this.emit('open'); const name = this.sent.find(value => value.startsWith('NICK ')).slice(5); this.line(`:${name}!a@a JOIN #channel`); }
}
function fixture(t, options = {}) {
  let time = 1000, id = 0; const timers = new Map(), sockets = [], connections = [], messages = [];
  const twitch = new Twitch({ config: loadConfig({ DEMO_MODE: 'false', TWITCH_CHANNEL: 'channel' }),
    now: () => time, heartbeatMs: 20, pongTimeoutMs: 10, joinTimeoutMs: 15, retryMs: 5,
    schedule: (fn, delay) => { timers.set(++id, { at: time + delay, fn }); return id; }, unschedule: key => timers.delete(key),
    createSocket: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    onConnected: value => connections.push(value), onMessage: message => { messages.push(message); return message.text !== 'filtered'; }, ...options });
  t.after(() => twitch.stop());
  const advance = ms => { const target = time + ms; for (;;) { const entry = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; const [key, value] = entry; timers.delete(key); time = value.at; value.fn(); } time = target; };
  twitch.connect();
  return { twitch, timers, sockets, connections, messages, advance };
}

test('silent dead connection loses connected status and reconnects without waiting for a TCP close', t => {
  const f = fixture(t), old = f.sockets[0]; old.join(); assert.equal(f.twitch.snapshot().connected, true);
  f.advance(20); assert.equal(old.pings.length, 1); assert.equal(f.twitch.snapshot().connected, true);
  f.advance(10); assert.equal(f.twitch.snapshot().connected, false); assert.equal(f.twitch.snapshot().lastError, 'heartbeat_timeout'); assert.ok(old.closed);
  f.advance(5); assert.equal(f.sockets.length, 2); f.sockets[1].join();
  assert.equal(f.twitch.snapshot().phase, 'joined'); assert.equal(f.twitch.snapshot().attempts, 2); assert.deepEqual(f.connections, [true, false, true]);
});
test('matching WebSocket pongs keep a healthy quiet channel alive; chat is not required', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.join();
  for (let i = 0; i < 6; i++) { f.advance(20); socket.emit('pong', socket.pings.at(-1)); assert.equal(f.twitch.snapshot().connected, true); }
  assert.equal(f.twitch.snapshot().probes, 6); assert.equal(f.twitch.snapshot().lastPongAt, 1120);
  assert.equal(f.sockets.length, 1); assert.deepEqual(f.connections, [true]);
});
test('incorrect pongs and ordinary traffic cannot acknowledge a heartbeat', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.join(); f.advance(20);
  socket.emit('pong', Buffer.from('wrong nonce')); socket.line(':a!a@a PRIVMSG #channel :hello');
  f.advance(10); assert.equal(f.twitch.snapshot().lastError, 'heartbeat_timeout'); assert.equal(f.twitch.snapshot().connected, false);
});
test('server join acknowledgement has a deadline; forged chat and other-channel room state do not connect', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.emit('open');
  socket.line(':a!a@a PRIVMSG #channel :pretend JOIN #channel'); socket.line(':tmi.twitch.tv ROOMSTATE #other');
  socket.line(':different!a@a JOIN #channel'); assert.equal(f.twitch.snapshot().connected, false);
  f.advance(15); assert.equal(f.twitch.snapshot().lastError, 'join_timeout'); assert.equal(f.twitch.snapshot().phase, 'reconnecting');
});
test('late old-socket events cannot disconnect or inject messages after a reconnect', t => {
  const f = fixture(t), old = f.sockets[0]; old.join(); old.emit('error', new Error('transport'));
  old.emit('close'); assert.equal(f.timers.size, 1); f.advance(5); const fresh = f.sockets[1]; fresh.join();
  old.line(':a!a@a PRIVMSG #channel :stale'); old.emit('close'); old.emit('error', new Error('late'));
  fresh.line(':a!a@a PRIVMSG #channel :current'); assert.deepEqual(f.messages.map(message => message.text), ['current']);
  assert.equal(f.twitch.snapshot().connected, true); assert.equal(f.sockets.length, 2);
});
test('IRC room updates do not repeatedly reset connection callbacks; PING gets the correct PONG', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.join();
  socket.line(':tmi.twitch.tv ROOMSTATE #channel'); socket.line('@slow=0 :tmi.twitch.tv ROOMSTATE #channel');
  socket.line('PING :tmi.twitch.tv'); assert.ok(socket.sent.includes('PONG :tmi.twitch.tv')); assert.deepEqual(f.connections, [true]);
});
test('diagnostics separate receipt, parsing, acceptance and failures without raw chat or IDs', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.join();
  socket.line(':private-login!a@a PRIVMSG #channel :hello'); socket.line(':private-login!a@a PRIVMSG #channel :filtered');
  const state = f.twitch.snapshot(); assert.equal(state.receivedMessages, 2); assert.equal(state.acceptedMessages, 1); assert.equal(state.rejectedMessages, 1);
  assert.equal(state.parseFailures, 0); assert.doesNotMatch(JSON.stringify(state), /private-login|hello|filtered/);
});
test('handler exceptions are counted and do not stop the receive loop', t => {
  const f = fixture(t, { onMessage: () => { throw new Error('private detail'); } }), socket = f.sockets[0]; socket.join();
  socket.line(':a!a@a PRIVMSG #channel :hello'); assert.equal(f.twitch.snapshot().handlerErrors, 1);
  assert.equal(f.twitch.snapshot().lastError, 'handler_failed'); assert.equal(f.twitch.snapshot().connected, true);
  assert.doesNotMatch(JSON.stringify(f.twitch.snapshot()), /private detail/);
});
test('RECONNECT or a transport-constructor failure schedules one retry; stopping cancels all future work', t => {
  const f = fixture(t), socket = f.sockets[0]; socket.join(); socket.line(':tmi.twitch.tv RECONNECT');
  assert.equal(f.twitch.snapshot().lastError, 'server_reconnect'); assert.equal(f.timers.size, 1);
  f.twitch.stop(); f.advance(1000); assert.equal(f.sockets.length, 1); assert.equal(f.timers.size, 0);
  const broken = fixture(t, { createSocket: () => { throw new Error('private network error'); } });
  assert.equal(broken.twitch.snapshot().lastError, 'connection_failed'); assert.equal(broken.timers.size, 1);
  broken.advance(5); assert.equal(broken.twitch.snapshot().attempts, 2); assert.equal(broken.timers.size, 1);
});
test('live app exposes real receive/accept/drop counters while retaining normal chat filters and AI OFF', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-twitch-routing-')), socket = new Socket();
  const runtime = createApp({ directory, config: loadConfig({ DEMO_MODE: 'false', TWITCH_CHANNEL: 'channel' }), createSocket: () => socket });
  t.after(() => { runtime.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  runtime.start(); socket.join();
  socket.line(':a!a@a PRIVMSG #channel :!jump RX27'); socket.line(':a!a@a PRIVMSG #channel :!jump RX27');
  socket.line(':b!a@a PRIVMSG #channel :https://example.com'); socket.line(':a!a@a PRIVMSG #other :hello');
  const state = runtime.snapshot(); assert.equal(state.twitch.connected, true); assert.equal(state.twitch.receivedMessages, 3);
  assert.equal(state.twitch.acceptedMessages, 1); assert.equal(state.twitch.rejectedMessages, 2);
  assert.equal(state.game.activity, 1); assert.equal(state.game.lastInteraction.performance, 'jump'); assert.equal(state.ai.totalRequests, 0);
});
