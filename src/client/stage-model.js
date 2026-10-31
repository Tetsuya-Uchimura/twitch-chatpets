import { interactionIntent, normalizeMood, resolveActionVariant, variantDuration } from '../shared/action-variants.js';
import { variantPose } from './action-motion.js';
// Single-mascot gameplay choreography. Coordinates are local to a compact 360 × 224 habitat.
export const PLAY_WIDTH = 360, PLAY_HEIGHT = 224, FLOOR = 184, HOME = 88;
export const DURATIONS = Object.freeze({ walk: 5000, eat: 2300, play: 2400, dash: 2100, inspect: 2600,
  jump: 2300, attack: 2400, happy: 2000, sleep: 5000, recoil: 1900, powerup: 2100 });
const aliases = { snack: 'eat', laugh: 'play', dance: 'happy', cheer: 'eat', think: 'inspect',
  hop: 'jump', bonk: 'recoil', duel: 'attack', evolve: 'powerup' };
export const clamp = (v, low, high) => Math.min(high, Math.max(low, v));
export const smooth = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
export const names = ['Nib'];
export const actLabels = { eat: 'bite & snack', play: 'bounce & play', dash: 'speed burst', inspect: 'inspect',
  jump: 'jump', attack: 'headbutt', happy: 'celebrate', sleep: 'nap', recoil: 'recoil', powerup: 'power-up',
  idle: 'idle', notice: 'notice', walk: 'patrol', run: 'chase', hurt: 'recoil', evolve: 'power-up' };

export function actionPose(action, elapsed, target = 232, startX = HOME, duration = DURATIONS[action]) {
  const speed = duration / DURATIONS[action];
  const t = elapsed / speed;
  const approach = Math.max(HOME + 15, target - 89);
  const p = { action: 'notice', x: startX, jump: 0, facing: 1, frame: 0, phase: 'notice', impact: false, capsuleY: FLOOR - 17, capsuleVisible: true };
  if(action==='walk'){
    const goal=HOME+140;
    if(t<260)return{...p,capsuleVisible:false,primitive:'gait-start'};
    if(t<2360)return{...p,action:'walk',phase:'walk',capsuleVisible:false,x:startX+(goal-startX)*smooth((t-260)/2100),frame:Math.floor(t/100)%4};
    if(t<2560)return{...p,x:goal,phase:'turn',facing:t<2460?1:-1,capsuleVisible:false,primitive:'gait-stop'};
    if(t<4660)return{...p,action:'walk',phase:'walk',facing:-1,capsuleVisible:false,x:goal+(HOME-goal)*smooth((t-2560)/2100),frame:Math.floor(t/100)%4};
    return{...p,x:HOME,phase:'settle',capsuleVisible:false,primitive:'gait-stop'};
  }
  if (t < 210) return { ...p, frame: Math.floor(t / 105) % 2 };
  if (action === 'sleep') {
    return { ...p, x: HOME, action: t < 550 ? 'notice' : t < 4500 ? 'sleep' : 'notice',
      phase: t < 550 ? 'settle' : t < 4500 ? 'sleep' : 'wake', frame: Math.floor(t / 650) % 2, capsuleY: FLOOR - 14 };
  }
  if (action === 'powerup') return { ...p, x: HOME, action: 'evolve', phase: 'powerup', frame: Math.floor(t / 140) % 4, capsuleVisible: t < 900, impact: t >= 900 };
  if (t < 620) return { ...p, x: startX + (approach - startX) * clamp((t - 210) / 410, 0, 1), action: 'run', phase: 'chase', frame: Math.floor(t / 75) % 4 };
  if (t < 1350) {
    const q = clamp((t - 620) / 730, 0, 1);
    const impact = t >= 1020;
    if (action === 'jump' || action === 'play') {
      const hop = Math.sin(Math.PI * q);
      return { ...p, x: action === 'jump' ? approach + q * 132 : approach + q * 22,
        jump: -hop * (action === 'jump' ? 68 : 33), action: 'jump', phase: 'interact',
        frame: q < .15 ? 0 : q < .85 ? 1 : 2, impact,
        capsuleY: FLOOR - 17 - (action === 'play' ? Math.abs(Math.sin(q * Math.PI * 2)) * 14 : 0), capsuleVisible: !impact || action === 'jump' };
    }
    if (action === 'dash' || action === 'attack') return { ...p, x: approach + q * (action === 'dash' ? 125 : 58),
      action: action === 'attack' ? 'attack' : 'run', phase: 'interact', frame: Math.floor(t / 65) % (action === 'attack' ? 3 : 4), impact, capsuleVisible: !impact };
    if (action === 'recoil') return { ...p, x: approach - smooth(clamp((t - 900) / 200, 0, 1)) * 23,
      jump: t > 900 ? -Math.sin(clamp((t - 900) / 450, 0, 1) * Math.PI) * 9 : 0,
      action: t < 900 ? 'notice' : 'hurt', phase: 'interact', frame: Math.floor(t / 130) % 2, impact: t >= 900, capsuleVisible: t < 900 };
    if (action === 'inspect') return { ...p, x: approach - 10, action: 'notice', phase: 'inspect', frame: Math.floor(t / 260) % 2, capsuleVisible: true };
    return { ...p, x: approach, action: action === 'happy' ? 'happy' : 'eat', phase: 'interact',
      jump: action === 'happy' ? -Math.abs(Math.sin(q * Math.PI * 2)) * 14 : 0,
      frame: Math.floor(t / 105) % 4, impact, capsuleVisible: !impact };
  }
  const end = action === 'jump' ? approach + 132 : action === 'dash' ? approach + 125 : action === 'attack' ? approach + 58 : action === 'recoil' ? approach - 23 : approach;
  const returnAt = Math.min(1700, DURATIONS[action] - 350);
  if (t < returnAt) return { ...p, x: end, action: action === 'recoil' ? 'hurt' : 'happy', phase: 'result',
    frame: Math.floor(t / 120) % (action === 'recoil' ? 2 : 4), impact: action !== 'inspect', capsuleVisible: action === 'inspect',
    jump: action === 'recoil' ? 0 : -Math.abs(Math.sin((t - 1350) / 280 * Math.PI)) * 9 };
  const back = clamp((t - returnAt) / Math.max(1, DURATIONS[action] - returnAt), 0, 1);
  return { ...p, x: end + (HOME - end) * back, action: back > .95 ? 'idle' : 'run', facing: -1,
    frame: Math.floor(t / 90) % 4, phase: 'return', impact: action !== 'inspect', capsuleVisible: false };
}

export class StageDirector {
  constructor() { this.reset(); }
  reset(epoch = 0) {
    this.epoch = epoch; this.lastSequence = 0; this.notes = []; this.stickers = []; this.effects = [];
    this.completed = []; this.battleStreak = 0;
    this.actors = [{ id: 0, name: 'Nib', x: HOME, current: null, queue: [], lastActivity: epoch, lastAction: 'idle', emotion: 'calm' }];
  }
  start(ticket, now, settings) {
    const actor = this.actors[0];
    actor.emotion = normalizeMood(ticket.demoMood || settings.emotion || actor.emotion);
    const variant = ticket.intent ? resolveActionVariant(actor.emotion, ticket.intent) : null;
    const tempo = clamp(112 / (settings.tempo || 112), .7, 1.5);
    actor.current = { ...ticket, variant, duration: variant ? variantDuration(variant, tempo) : DURATIONS[ticket.action] * tempo,
      start: now, fromX: actor.x };
    this.battleStreak = ticket.intent === 'battle' ? this.battleStreak + 1 : 0;
  }
  impact(ticket, now, pose, emit = true) {
    if (ticket.impacted) return;
    ticket.impacted = true;
    if (ticket.intent === 'eat') ticket.consumed = true;
    if (ticket.intent === 'eat' || ticket.intent === 'battle') this.notes = this.notes.filter(n => n.sequence !== ticket.sequence);
    if (emit) {
      this.effects.push({ at: now, x: ticket.intent === 'jump' ? pose.x : ticket.target,
        kind: ticket.variant?.effectType || (ticket.action === 'attack' ? 'hit' : ticket.action === 'recoil' ? 'ouch' : 'bits'),
        strength: ticket.variant?.mood === 'excitement' || ticket.variant?.mood === 'anger' ? 1.3 : .7, seed: ticket.sequence });
      this.effects = this.effects.slice(-6);
    }
  }
  finish(ticket, now, cancelled = false) {
    // Complete collision/consumption even if a hidden tab skipped every interaction frame.
    if (!cancelled) this.impact(ticket, now, { x: ticket.target }, false);
    this.notes = this.notes.filter(n => n.sequence !== ticket.sequence);
    this.completed.push({ sequence: ticket.sequence, intent: ticket.intent, consumed: Boolean(ticket.consumed), cancelled,
      cancelRequested: Boolean(ticket.cancelRequested) });
    this.completed = this.completed.slice(-16);
  }
  advance(now, settings) {
    const actor = this.actors[0];
    if (actor.current && now - actor.current.start >= actor.current.duration) {
      this.finish(actor.current, now); actor.current = null; actor.lastActivity = now;
    }
    if (!actor.current && !settings.holdActions) {
      actor.emotion = normalizeMood(settings.emotion || actor.emotion);
      while (actor.queue.length && !actor.current) {
        // Battle has priority, but an aging oldest action and a two-battle limit prevent starvation.
        let index = 0;
        if (now - actor.queue[0].enqueuedAt < 2500 && this.battleStreak < 2) {
          for (let i = 1; i < actor.queue.length; i++) if (actor.queue[i].priority > actor.queue[index].priority) index = i;
        }
        const [ticket] = actor.queue.splice(index, 1);
        if (now - ticket.enqueuedAt < 6000 && (!ticket.demoMood || ticket.demoGeneration === settings.demoGeneration)) this.start(ticket, now, settings);
        else this.finish(ticket, now, true);
      }
    }
  }
  cancel(sequence, now) {
    const actor = this.actors[0], index = actor.queue.findIndex(t => t.sequence === sequence);
    if (index >= 0) { const [ticket] = actor.queue.splice(index, 1); this.finish(ticket, now, true); return true; }
    // Active interactions finish their cleanup before cancellation takes effect.
    if (actor.current?.sequence === sequence) { actor.current.cancelRequested = true; return true; }
    return false;
  }
  enqueue(ticket) {
    const queue = this.actors[0].queue;
    if (queue.length < 3) { queue.push(ticket); return; }
    // Protect the oldest waiting action. Coalesce the newest eligible lower-priority work.
    let replace = -1;
    for (let i = queue.length - 1; i >= 1; i--) if (queue[i].priority <= ticket.priority &&
      (replace < 0 || queue[i].priority < queue[replace].priority)) replace = i;
    if (replace >= 0) { this.finish(queue[replace], ticket.enqueuedAt, true); queue[replace] = ticket; }
  }
  receive(value, now, settings) {
    if (!Number.isInteger(value.sequence) || value.sequence <= this.lastSequence) return false;
    this.lastSequence = value.sequence;
    const actor = this.actors[0];
    this.advance(now, settings);
    const action = Object.hasOwn(DURATIONS, value.performance) ? value.performance : aliases[value.performance] || 'eat';
    const intent = interactionIntent({ ...value, performance: action });
    const ticket = { ...value, actorId: 0, action, intent, priority: intent === 'battle' ? 30 : 20,
      enqueuedAt: now, start: now, arrived: now, fromX: actor.x, target: 211 + value.sequence * 17 % 44, impacted: false };
    this.notes.push(ticket); this.notes = this.notes.slice(-8);
    if ((!actor.current || actor.current.action === 'sleep') && !settings.holdActions) {
      if (actor.current) this.finish(actor.current, now, true);
      this.start(ticket, now, settings);
    }
    else this.enqueue(ticket);
    actor.lastActivity = now;
    if (settings.emotes && ['kekw', 'pog', 'bruh', 'love'].includes(value.emote)) {
      this.stickers.push({ kind: value.emote, start: now }); this.stickers = this.stickers.slice(-2);
    }
    return true;
  }
  tick(now, settings) {
    if (!this.epoch) { this.epoch = now; this.actors[0].lastActivity = now; }
    this.notes = this.notes.filter(note => now - note.arrived < 6500);
    this.stickers = settings.emotes ? this.stickers.filter(s => now - s.start < 2400) : [];
    this.effects = this.effects.filter(effect => now - effect.at < 650);
    const actor = this.actors[0];
    this.advance(now, settings);
    let pose;
    if (actor.current) {
      const ticket = actor.current;
      pose = ticket.variant ? variantPose(ticket.variant, now - ticket.start,
        { target: ticket.target, startX: ticket.fromX, duration: ticket.duration, home: HOME, floor: FLOOR }) :
        actionPose(ticket.action, now - ticket.start, ticket.target, ticket.fromX, ticket.duration);
      if (pose.impact && !ticket.impacted) {
        this.impact(ticket, now, pose);
      }
    } else {
      const quiet = Math.max(0, now - actor.lastActivity), t = quiet % 24000;
      let action = !settings.ambient ? 'idle' : t < 4500 ? 'idle' : t < 8500 ? 'walk' : t < 11000 ? 'notice' : t < 19000 ? 'sleep' : t < 20800 ? 'notice' : 'walk';
      if (settings.ambient && actor.emotion === 'laughter') action = t % 5000 < 1900 ? 'happy' : 'walk';
      if (settings.ambient && actor.emotion === 'excitement') action = t % 4500 < 2300 ? 'run' : 'happy';
      if (settings.ambient && actor.emotion === 'anger') action = t % 4000 < 1700 ? 'walk' : 'notice';
      if (settings.ambient && actor.emotion === 'confusion') action = t % 6000 < 4700 ? 'notice' : 'walk';
      const patrol = action === 'walk' ? Math.sin(t / 700) * 26 : 0;
      const lively = actor.emotion === 'laughter' || actor.emotion === 'excitement';
      pose = { action, x: HOME + patrol + (action === 'run' ? Math.sin(t / 320) * 24 : 0),
        jump: lively && action === 'happy' ? -Math.abs(Math.sin(t / 200)) * 10 : actor.emotion === 'anger' && action === 'walk' ? -Math.abs(Math.sin(t / 140)) * 3 : 0,
        facing: action === 'walk' && Math.cos(t / 700) < 0 ? -1 : 1,
        frame: action === 'idle' ? Math.floor(t / 600) % 4 : action === 'sleep' ? Math.floor(t / 800) % 2 : Math.floor(t / 150) % 4,
        phase: 'idle', capsuleVisible: false, impact: false };
    }
    actor.x = clamp(pose.x, 62, PLAY_WIDTH - 62); actor.lastAction = pose.action;
    return [{ ...actor, ...pose, x: actor.x, active: Boolean(actor.current), performance: actor.current?.action || null,
      progress: actor.current ? clamp((now - actor.current.start) / actor.current.duration, 0, 1) : 0,
      intent: actor.current?.intent || null, variantId: actor.current?.variant?.id || '',
      text: actor.current?.text || '', note: actor.current }];
  }
}
