import express from 'express';
import path from 'node:path';
import { projectRoot as root } from './paths.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { ChatWindow } from './chat.js';
import { Game } from './game.js';
import { AIAnalysis } from './ai.js';
import { MinuteSentiment } from './minute-sentiment.js';
import { Twitch } from './twitch.js';
import { stageSettingsPatchSchema } from './stage-settings.js';
import { ChatPulse } from './pulse.js';
import { SCENARIOS, replayScenario } from './pulse-demo.js';
import { EMOTIONS } from '../shared/pulse-classifier.js';
import { ACTION_INTENTS } from '../shared/action-variants.js';
import {NibEvolution}from'./evolution.js';
import { Conversation } from './conversation.js';
import { StreamJokes } from './stream-jokes.js';
import { TwitchFrame } from './twitch-frame.js';
import { conversationPatch } from './conversation-settings.js';
import { EMOTION_FORM } from '../shared/nib-forms.js';

const local = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
export function controlGuard(req, res, next, { container = false } = {}) {
  const host = req.headers.host;
  // Check the actual socket, never forwarded headers. Prevent cross-site and DNS-rebinding writes.
  // Container clients arrive through Docker's bridge; Compose must publish only on host loopback.
  if ((!container && !local(req.socket.remoteAddress)) || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host || '')) return res.status(403).json({ error: 'Localhost control only.' });
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return res.status(403).json({ error: 'Same-origin control only.' });
  if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Same-origin control only.' });
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'JSON required.' });
  next();
}
export function createApp({ config, directory = path.join(root, 'data'), publicDirectory = path.join(root, 'src', 'client'), now = Date.now, clientFactory, schedule, unschedule, createSocket, fetchTwitch, streamFrame } = {}) {
  const store = new Store(directory, config);
  let replayAt = null;
  const chatClock = () => replayAt ?? now();
  const chat = new ChatWindow({ ...config, intervalSeconds: store.state.settings.intervalSeconds }, chatClock);
  const pulse = new ChatPulse({ ...config.pulse, aiDriven: !config.demo }, now);
  const game = new Game(now);
  const evolution = new NibEvolution();
  const ai = new (config.demo ? AIAnalysis : MinuteSentiment)({ config, store, chat, pulse, now, clientFactory, schedule, unschedule,
    apply: (value, evidence, window) => {
      if(config.demo){game.recommend(value,evidence);if(window)pulse.refine(value.pulse,window);}
      else broadcast('state',snapshot());
    } });
  const subscribers = new Set();
  const sessionId = randomUUID();
  const rotationEpoch = now();
  let demoCount = 0; let autoIndex = 0; let demoAutoplay = true; let demoTimer = null; let broadcastTimer = null;
  let demoMood = null, demoGeneration = 0;
  const frame = streamFrame ?? new TwitchFrame({config,now,fetch:fetchTwitch});
  const conversation = new Conversation({ config, store, directory, now, clientFactory, frame,
    onStreamJoke: status => streamJokes.result(status),
    getForm: () => config.demo && demoMood ? EMOTION_FORM[demoMood] : evolution.snapshot().form, emit: value => broadcast('conversation', value) });
  const streamJokes = new StreamJokes({config, store, conversation, now, frame});
  const snapshot = () => {const summary=pulse.snapshot();if(evolution.observe(summary))game.evolutions++;const form=evolution.snapshot();return ({ sessionId, serverTime: now(), rotationEpoch, demo: config.demo, channel: config.channel,
    stageSettings: store.state.stageSettings, demoAutoplay, demoMood: config.demo ? demoMood : null, demoGeneration,
    game: game.snapshot(), evolution:form, pulse: summary, ai: ai.snapshot(), conversation: conversation.snapshot(), streamJokes: streamJokes.snapshot(), twitch: twitch.snapshot() });};
  function broadcast(type, value) {
    const data = `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const res of subscribers) {
      if (res.writableLength > 65536) { res.end(); subscribers.delete(res); } else res.write(data);
    }
  }
  function receive(message, { historical = false, demoTest = null } = {}) {
    let text = message.text;
    const privacyCommand = typeof text === 'string' && /^!nib\s+(forget|optout|optin)$/iu.test(text.trim());
    // Known account names are removed in addition to mentions/IDs; raw Twitch data never goes to AI.
    for (const name of [message.username, message.displayName, message.userId].filter(Boolean)) {
      if (typeof text === 'string' && !privacyCommand) {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        text = text.replace(new RegExp(escaped, 'giu'), '[viewer]');
      }
    }
    const accepted = chat.accept({ ...message, text });
    if (!accepted) return false;
    if (config.demo && demoTest) {
      // Explicit animation practice, not a live battle command. Keep normal battle gates untouched.
      accepted.intent = demoTest.intent; accepted.demoMood = demoTest.mood; accepted.demoGeneration = demoGeneration;
      accepted.performance = { praise: 'eat', jump: 'jump', eat: 'eat', battle: 'attack' }[demoTest.intent];
      accepted.category = demoTest.intent === 'praise' ? 'support' : demoTest.intent === 'battle' ? 'battle' : 'neutral';
      accepted.explicit = true;
    }
    pulse.ingest(accepted);
    if (!historical) { const interaction = game.accept(accepted); broadcast('interaction', interaction); conversation.ingest(accepted, message.displayName); }
    if (!config.demo) {
      if(privacyCommand){ai.forget(accepted.participant);streamJokes.reset();}
      const excluded=privacyCommand||conversation.relationships.optedOut(accepted.participant);
      ai.ingest(accepted,{excluded}); streamJokes.ingest(accepted,{excluded});
    }
    return true;
  }
  const twitch = new Twitch({ config, now, onMessage: receive, onConnected: connected => { ai.setConnected(connected); conversation.setConnected(connected); streamJokes.setConnected(connected); }, createSocket });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', (req, res, next) => controlGuard(req, res, next, { container: config.networkMode === 'container' }));
  app.use(express.json({ limit: '4kb' }));
  app.get('/api/state', (req, res) => res.json(snapshot()));
  app.get('/api/conversation/logs', (req,res) => {
    const parsed=z.object({limit:z.coerce.number().int().min(1).max(5000).default(5000)}).strict().safeParse(req.query);
    if(!parsed.success)return res.status(400).json({error:'Invalid log limit.'});
    res.json(conversation.responseLog.snapshot(parsed.data.limit));
  });
  app.get('/api/events', (req, res) => {
    if (subscribers.size >= 20) return res.status(429).end();
    res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'Cache-Control': 'no-cache' });
    res.flushHeaders(); res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
    subscribers.add(res); req.on('close', () => subscribers.delete(res));
  });
  const settingsPatch = z.object({ enabled: z.boolean().optional(), intervalSeconds: z.number().int().min(10).max(86400).optional(), dailyBudget: z.number().min(0).max(100).optional(), dailyBudgetEnabled: z.boolean().optional() }).strict();
  app.patch('/api/ai/settings', (req, res) => {
    const result = settingsPatch.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid AI settings.' });
    try { ai.updateSettings(result.data); broadcast('state', snapshot()); res.json(ai.snapshot()); }
    catch { res.status(config.demo ? 409 : 503).json({ error: config.demo ? 'AI cannot be enabled in demo mode.' : 'Settings could not be saved.' }); }
  });
  app.post('/api/visuals/reset', (req, res) => { game.resetVisuals(); res.json(snapshot()); });
  app.patch('/api/conversation/settings', (req, res) => {
    const parsed = conversationPatch.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Check the conversation setting values.' });
    try { const value = conversation.updateSettings(parsed.data); streamJokes.reset(); broadcast('state', snapshot()); res.json(value); }
    catch { res.status(config.demo && parsed.data.liveAIEnabled ? 409 : 503).json({ error: config.demo ? 'Paid AI cannot be enabled in demo mode.' : 'Conversation settings could not be saved.' }); }
  });
  app.post('/api/demo/conversation', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    const parsed = z.object({ userId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), displayName: z.string().max(32).optional(), text: z.string().min(1).max(240) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid demo conversation.' });
    const accepted = receive({ ...parsed.data, userId: `conversation-${parsed.data.userId}`, authorized: false });
    res.json({ accepted });
  });
  app.post('/api/conversation/event', (req, res) => {
    const parsed = z.object({ kind: z.enum(['question', 'poll', 'close']) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid event.' });
    const result = parsed.data.kind === 'close' ? { accepted: conversation.closeEvent() } : conversation.requestEvent(parsed.data.kind);
    broadcast('state', snapshot()); res.json(result);
  });
  app.post('/api/conversation/privacy', (req, res) => {
    const parsed = z.object({ viewerId: z.string().min(1).max(100) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid viewer ID.' });
    conversation.deleteViewer(parsed.data.viewerId); streamJokes.reset();
    // Admin deletion can use a salted profile ID, so conservatively discard the pending sentiment context too.
    if(!config.demo){ai.buffer=[];ai.generation++;ai.controller?.abort();}
    broadcast('state', snapshot()); res.json({ deleted: true });
  });
  app.patch('/api/stage/settings', (req, res) => {
    const result = stageSettingsPatchSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid stage settings.' });
    try {
      store.stageSettings({ ...store.state.stageSettings, ...result.data });
      broadcast('state', snapshot()); res.json(store.state.stageSettings);
    } catch { res.status(503).json({ error: 'Stage settings could not be saved.' }); }
  });
  app.post('/api/demo/message', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    const result = z.object({ text: z.string().min(1).max(1000) }).strict().safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid message.' });
    const accepted = receive({ text: result.data.text, userId: `demo-${++demoCount}`, authorized: true });
    res.json({ accepted });
  });
  app.post('/api/demo/playback', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    const result = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid demo playback setting.' });
    demoAutoplay = result.data.enabled;
    if (demoAutoplay) { demoMood = null; demoGeneration++; }
    broadcast('state', snapshot()); res.json({ enabled: demoAutoplay });
  });
  app.post('/api/demo/pulse', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    const result = z.object({ scenario: z.enum(Object.keys(SCENARIOS)) }).strict().safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid demo scenario.' });
    demoAutoplay = false; demoMood = null; demoGeneration++;
    const replay = replayScenario({ scenario: result.data.scenario, end: now(), receive, chat, pulse, setTime: value => { replayAt = value; } });
    broadcast('state', snapshot()); res.json(replay);
  });
  app.post('/api/demo/interaction', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    const result = z.object({ mood: z.enum(EMOTIONS), intent: z.enum(ACTION_INTENTS) }).strict().safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: 'Invalid mood or action.' });
    const previous = demoMood; demoMood = result.data.mood; demoAutoplay = false;
    // State precedes the action on the same SSE stream. Current actions still finish normally.
    broadcast('state', snapshot());
    const text = { praise: 'GG 💖', jump: '!jump', eat: '🍙 snack', battle: 'Practice block' }[result.data.intent];
    const accepted = receive({ text, userId: `practice-${++demoCount}`, authorized: false }, { demoTest: result.data });
    if (!accepted) { demoMood = previous; broadcast('state', snapshot()); return res.status(429).json({ error: 'Practice chat is rate limited. Try again shortly.' }); }
    res.json({ accepted, sequence: game.lastInteraction.sequence, mood: demoMood, intent: result.data.intent });
  });
  app.post('/api/demo/interaction/reset', (req, res) => {
    if (!config.demo) return res.status(403).json({ error: 'Demo mode only.' });
    if (!z.object({}).strict().safeParse(req.body).success) return res.status(400).json({ error: 'Invalid reset.' });
    demoMood = null; demoGeneration++; broadcast('state', snapshot()); res.json({ demoMood });
  });
  app.use('/shared', express.static(path.join(root, 'src', 'shared'), { dotfiles: 'deny' }));
  app.use(express.static(publicDirectory, { dotfiles: 'deny', index: 'index.html' }));
  app.use((error, req, res, next) => { res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid request.' }); });
  let conversationTimer;
  return { app, ai, store, chat, game, pulse, conversation, streamJokes, receive, snapshot,
    start() {
      if (config.demo) {
        // Deliberate breathing room: every act can finish, and repeated moods occasionally form a combo.
        const messages = ['GG 💖', 'LOL 😂', 'LUL www', 'KEKW 😂', 'POG 🔥', '!jump HOP!',
          'Why?', '!battle', 'bruh…', '!powerup', 'good night zzz', 'nice, you got this!'];
        demoTimer = setInterval(() => {
          if (demoAutoplay) receive({ text: messages[autoIndex++ % messages.length], userId: `auto-${autoIndex}` });
        }, 3000);
        demoTimer.unref?.();
      } else { twitch.connect(); }
      broadcastTimer = setInterval(() => broadcast('state', snapshot()), 1000);
      broadcastTimer.unref?.();
      conversationTimer = setInterval(() => { streamJokes.tick().catch(() => {}); conversation.tick().catch(() => {}); }, 150);
      conversationTimer.unref?.();
    },
    stop() { clearInterval(demoTimer); clearInterval(broadcastTimer); clearInterval(conversationTimer); streamJokes.stop(); conversation.stop(); twitch.stop(); ai.stop(); for (const res of subscribers) res.end(); },
  };
}
