import { randomUUID } from 'node:crypto';
import { ConversationAI, ANIMATIONS, safeConversationText, privateTopic } from './conversation-ai.js';
import { conversationSettingsSchema } from './conversation-settings.js';
import { Relationships } from './relationships.js';
import {ResponseLog} from './response-log.js';
import {needsScreenContext,visualFailure} from './visual-question.js';

const direct = text => /(?:\bnib\b|ニブ|にぶ)/iu.test(text);
const trivial = text => /^(?:gg|www|草|lol|kekw|pog|[!\s🔥❤💖😂👍])+$/iu.test(text);
const decorate = { base: ['Interesting!', 'curious'], bloom: ['Okay, let\'s take it slow.', 'shy'], giggle: ['That could become a chat classic!', 'laugh'], blaze: ['Alright, let\'s go, everyone!', 'cheer'], bulwark: ['I-it\'s not like I was curious or anything!', 'comic_angry'], astral: ['Hmm… did that reach outer space?', 'curious'] };
const quote = (text, n) => `"${text.replaceAll('"', '').slice(0, n).trim()}"`;
// Explicitly local, deterministic demo provider. It never calls an API or impersonates live AI.
export function demoReply(payload, settings) {
  const c = payload.candidate, form = settings.personalityEnabled ? payload.form : 'base';
  const [tone, animation] = decorate[form] || decorate.base;
  const source = c.text.replace(/^!(?:answer|vote)\s+/iu, ''), familiar = payload.relationship.level > 0 ? 'Welcome back! ' : '';
  let reply = `${familiar}${quote(source, 40)}, huh? ${tone}`, followup = null;
  if (c.kind === 'followup') {
    const prior = payload.evidence.find(v => v.id === c.reply_to);
    reply = `${prior ? `Following up on ${quote(prior.text, 24)}: ` : ''}${quote(source, 40)}? ${tone}`;
  }
  // publish() already prefixes the authoritative result text.
  if (c.kind === 'result') reply = tone;
  else if (c.kind === 'answer') reply = `${quote(source, 40)} — got it! ${tone}`;
  else if (c.kind === 'question_request' || c.kind === 'poll_request') {
    followup = c.kind === 'poll_request' ? { kind: 'choice', question: `About ${quote(source, 24)}: should Nib pick cheers or snacks?`, options: ['Cheers', 'Snacks'] } : { kind: 'rating', question: `About ${quote(source, 24)}: chat energy from 0-100?`, options: [] };
    reply = followup.question;
  } else if (direct(c.text)) {
    followup = { kind: 'open', question: `${quote(source, 24)} — what would you do? Tell me with !answer.`, options: [] };
    reply = `${familiar}${quote(source, 40)}? ${settings.jokesEnabled ? tone : 'I\'m listening.'} What would you do?`;
  }
  return { should_reply: true, candidate_id: c.id, reply: reply.slice(0, 140), animation,
    evidence_ids: payload.evidence.slice(-3).map(e => e.id), followup };
}

export class Conversation {
  constructor({ config, store, directory, now = Date.now, clientFactory, emit = () => {}, getForm = () => 'base', demoProvider = demoReply, onStreamJoke = () => {}, frame }) {
    Object.assign(this, { config, store, now, emit, getForm, demoProvider, onStreamJoke, frame });
    this.ai = new ConversationAI({ config, store, now, clientFactory });
    this.relationships = new Relationships(directory, config.channel);
    this.responseLog=new ResponseLog({directory,now});this.frameCache=null;
    this.connected = false; this.memory = []; this.queue = []; this.errors = [];
    this.seen = new Set(); this.recent = new Map(); this.names = new Map(); this.responded = new Map();
    this.lastCall = -Infinity; this.lastEvent = now(); this.lastForm = getForm(); this.controller = null;
    this.inFlight = false; this.activeEvent = null; this.speech = null; this.generation = 0;
    this.stats = { candidates: 0, replies: 0, filtered: 0, discarded: 0, events: 0, answers: 0, apiCalls: 0 };
  }
  get settings() { return this.store.state.conversationSettings; }
  get logs(){return this.responseLog.entries;}
  emitEvent(type, data = {}) { this.emit({ type, at: this.now(), ...data }); }
  prune() {
    this.responseLog.prune();
    const cutoff = this.now() - this.settings.memorySeconds * 1000;
    this.memory = this.memory.filter(e => e.at >= cutoff).slice(-120);
    this.recent = new Map([...this.recent].filter(([, e]) => e.at >= cutoff).slice(-80));
    const active = new Set([...this.recent.values()].map(e => e.participant));
    for (const id of this.names.keys()) if (!active.has(id)) this.names.delete(id);
    for (const [id, at] of this.responded) if (at < cutoff) this.responded.delete(id);
    this.queue = this.queue.filter(e => { if (this.now() > e.expires) { this.stats.discarded++; if(e.kind==='stream_joke')this.onStreamJoke('expired'); return false; } return true; });
    if (this.speech && this.now() > this.speech.expires) this.speech = null;
  }
  remember(entry) { if (this.settings.memoryEnabled) this.memory.push({ ...entry, at: this.now() }); this.prune(); }
  setConnected(value) { this.connected = value; if (!value) this.clearSession(); }
  clearSession() {
    this.generation++; this.controller?.abort(); this.memory = []; this.queue = []; this.recent.clear();
    this.names.clear(); this.responded.clear(); this.seen.clear(); this.activeEvent = null; this.speech = null;
    this.frameCache=null;this.emitEvent('clear');
  }
  updateSettings(patch) {
    if (this.config.demo && patch.liveAIEnabled === true) throw new Error('Demo cannot enable paid AI.');
    const value = conversationSettingsSchema.parse({ ...this.settings, ...patch });
    this.store.conversationSettings(value);
    this.generation++; this.controller?.abort(); this.queue = [];
    this.frameCache=null;
    if (!value.memoryEnabled) { this.memory = []; this.recent.clear(); }
    if (!value.enabled) { this.activeEvent = null; this.speech = null; this.emitEvent('clear'); }
    else if (!value.emotesEnabled) this.emitEvent('settings', { emotesEnabled: false });
    this.prune(); return this.snapshot();
  }
  privacy(participant, action) {
    const key = this.relationships.privacy(participant, action);
    if (action !== 'optin') this.forgetKey(key);
  }
  deleteViewer(id) { const { key } = this.relationships.deleteViewer(id); this.forgetKey(key); }
  forgetKey(key) {
    this.generation++; this.controller?.abort(); this.queue = this.queue.filter(e => this.relationships.key(e.participant || '') !== key);
    // Clear shared callbacks too: another viewer's reply may quote the deleted viewer.
    this.memory = []; this.responseLog.clear();this.frameCache=null;
    for (const [id, e] of this.recent) if (this.relationships.key(e.participant) === key) { this.recent.delete(id); this.names.delete(e.participant); this.responded.delete(e.participant); }
    if (this.activeEvent) { this.activeEvent.answers.delete(key); this.activeEvent=null; this.emitEvent('event',{event:null}); }
    this.recent.clear(); this.names.clear(); this.responded.clear(); this.queue=[];
    this.speech = null; this.emitEvent('clear_speech');
  }
  ingest(message, displayName = '') {
    const { participant, text, sequence } = message;
    const command = /^!nib\s+(forget|optout|optin)$/iu.exec(text.trim());
    if (command) { this.privacy(participant, command[1].toLowerCase()); return; }
    if (!this.settings.enabled || this.seen.has(sequence) || this.relationships.optedOut(participant)) return;
    this.seen.add(sequence); if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    if (!safeConversationText(text, this.config.blockedTerms) || privateTopic(text)) { this.stats.filtered++; return; }
    this.prune();
    const entry = { id: `chat-${sequence}`, role: 'viewer', participant, profile: this.relationships.key(participant), text, at: this.now() };
    this.recent.set(entry.id, entry); this.remember(entry);
    if (this.settings.showNames && displayName) this.names.set(participant, displayName.replace(/[^\p{L}\p{N}_ -]/gu, '').slice(0, 24));
    if (this.collectAnswer(entry)) return;
    if (trivial(text) || text.startsWith('!')) return;
    const previous = this.responded.get(participant), isFollowup = previous && this.now() - previous < 90000;
    const kind = isFollowup ? 'followup' : direct(text) ? 'direct' : 'topic';
    const comicMoment = this.settings.jokesEnabled && /(?:落下|やらか|転ん|また.{0,10}(?:ミス|負け)|\b(?:fell|fall|missed|oops|clutch)\b|plot twist)/iu.test(text);
    if (kind === 'topic' && !comicMoment && !needsScreenContext(text) && (text.length < (this.settings.frequency === 'high' ? 10 : this.settings.frequency === 'low' ? 35 : 18) || !/[?？!！]|おやつ|眠|好き|勝|負|snack|sleep|love|win|lose/iu.test(text))) return;
    this.enqueue({ ...entry, kind, priority: isFollowup ? 80 : kind === 'direct' ? 70 : 40 });
  }
  enqueue(candidate) {
    this.stats.candidates++;
    this.queue.push({ ...candidate, expires: this.now() + this.settings.candidateTTLSeconds * 1000 });
    this.queue.sort((a, b) => b.priority - a.priority || a.at - b.at); this.queue = this.queue.slice(0, 12);
  }
  eventView() {
    const e = this.activeEvent; if (!e) return null;
    return { id: e.id, kind: e.kind, prompt: e.prompt, options: e.options, closes: e.closes,
      participants: e.answers.size, counts: e.options.map((_, i) => [...e.answers.values()].filter(a => a.value === i).length),
      command: e.kind === 'poll' ? '!vote 1 / !vote 2' : e.kind === 'rating' ? '!answer 0-100' : '!answer your answer' };
  }
  openEvent(followup, kind, participant, personal = false) {
    if (this.activeEvent) return false;
    const options = kind === 'poll' || followup.kind === 'choice' ? [...new Set(followup.options)].slice(0, 3) : [];
    if ((kind === 'poll' || followup.kind === 'choice') && options.length < 2) return false;
    if (!safeConversationText(followup.question, this.config.blockedTerms) || options.some(v => !safeConversationText(v, this.config.blockedTerms))) return false;
    this.activeEvent = { id: randomUUID(), kind: kind === 'poll' ? 'poll' : followup.kind, prompt: followup.question,
      options, participant, personal, answers: new Map(), closes: this.now() + this.settings.voteSeconds * 1000 };
    this.lastEvent = this.now(); this.stats.events++; this.emitEvent('event', { event: this.eventView() }); return true;
  }
  collectAnswer(entry) {
    const e = this.activeEvent; if (!e || this.now() >= e.closes) return false;
    let value, answer = entry.text.trim(), explicit = /^!(?:vote|answer)\s+/iu.test(answer);
    if (e.kind === 'poll') { const m = /^!vote\s+([1-3])$/iu.exec(answer); if (!m) return false; value = Number(m[1]) - 1; if (value >= e.options.length) return true; }
    else {
      answer = answer.replace(/^!answer\s+/iu, '');
      if (e.kind === 'rating') { const m=/^(\d{1,3})(?:\s*(?:点|pts?|points?))?[!！wｗ笑]*$/iu.exec(answer); if(!m)return false; value = Number(m[1]); if (value > 100) return true; }
      else if (e.kind === 'choice') { value = e.options.findIndex((v, i) => answer === v || answer === String(i + 1)); if (value < 0) return false; }
      else { if (!explicit && e.participant !== entry.participant) return false; value = answer.slice(0, 100); }
    }
    if (e.answers.has(entry.profile) || e.answers.size >= 500) return true;
    e.answers.set(entry.profile, { value, text: answer, participant: entry.participant }); this.stats.answers++;
    this.relationships.award(entry.participant, e.kind === 'poll' ? 'vote' : 'answer', this.now(), this.settings);
    this.emitEvent('event', { event: this.eventView() });
    if (e.kind === 'open' && e.personal) { this.activeEvent = null; this.enqueue({ ...entry, kind: 'answer', priority: 100 }); this.emitEvent('event', { event: null }); }
    return true;
  }
  requestEvent(kind, manual = true) {
    if (!this.eligible()) return { accepted:false, reason:'Turn conversation on. Live mode also needs AI replies enabled and a Twitch connection.' };
    if (!this.settings.enabled || this.activeEvent) return { accepted: false, reason: 'An event is already running, or conversation is off.' };
    this.prune(); const topic = [...this.recent.values()].findLast(e => !e.text.startsWith('!') && !trivial(e.text));
    if (!topic) return { accepted: false, reason: 'Send a comment with a topic first.' };
    if (this.queue.some(e => /_request$/u.test(e.kind))) return { accepted: false, reason: 'Nib is preparing a question.' };
    this.enqueue({ ...topic, id: `${kind}-${randomUUID()}`, kind: `${kind}_request`, manual, priority: 110, at: this.now() });
    return { accepted: true };
  }
  closeEvent() {
    const e = this.activeEvent; if (!e) return false; this.activeEvent = null;
    const values = [...e.answers.values()], n = values.length;
    let result = `${quote(e.prompt, 24)}: ${n} ${n === 1 ? 'answer' : 'answers'}. `;
    if (n < this.settings.minParticipants) result += 'Not enough players this time. Let\'s play again soon.';
    else if (e.kind === 'rating') result += `Average: ${Math.round(values.reduce((s, v) => s + v.value, 0) / n)}!`;
    else if (e.options.length) { const counts = e.options.map((option, i) => ({ option:option.slice(0,12), count: values.filter(v => v.value === i).length })); const max = Math.max(...counts.map(v => v.count)); const winners = counts.filter(v => v.count === max); result += counts.map(v => `${v.option}: ${v.count}`).join(', ') + (winners.length > 1 ? ' — a tie!' : ` — ${winners[0].option} wins!`); }
    else result += values.map(v => v.text.slice(0, 15)).slice(0, 3).join(', ');
    const record = { id: `result-${e.id}`, role: 'event', text: result, at: this.now() };
    this.remember(record); this.emitEvent('event', { event: null }); this.emitEvent('result', { text: result, participants: n });
    if (n >= this.settings.minParticipants) this.enqueue({ ...record, kind: 'result', priority: 100 });
    else this.publish({ reply: result, animation: 'shy', followup: null }, { id: record.id, kind: 'result', priority: 100 }, this.getForm(), 'local');
    return true;
  }
  payload(candidate, form) {
    const recent_nib_lines = this.settings.memoryEnabled ? this.memory.filter(e=>e.role==='nib'&&e.at>=this.now()-this.settings.memorySeconds*1000).slice(-5).map(e=>e.text) : [];
    if (candidate.kind === 'stream_joke') return {form, candidate: {id: candidate.id, kind: candidate.kind, text: candidate.text},
      relationship: {level: 0}, evidence: candidate.evidence, streamContext: candidate.streamContext, image: candidate.image, recent_nib_lines};
    let chars = 0; const evidence = [];
    for (const e of (this.settings.memoryEnabled ? this.memory : [candidate]).toReversed()) {
      if (chars + e.text.length > 3500) break;
      evidence.unshift({ id: e.id, role: e.role, text: e.text, speaker:e.profile?'viewer-'+e.profile.slice(0,6):'community' }); chars += e.text.length;
    }
    const profile=candidate.participant?this.relationships.key(candidate.participant):null;
    return { form, candidate: { id: candidate.id, kind: candidate.kind, text: candidate.text,
      speaker:profile?'viewer-'+profile.slice(0,6):'community', reply_to:this.memory.findLast(e=>e.role==='nib'&&e.profile===profile)?.id||null },
      relationship: candidate.participant && this.settings.relationshipsEnabled ? this.relationships.level(candidate.participant) : { level: 0 }, evidence, recent_nib_lines };
  }
  eligible() { return this.settings.enabled && !this.ai.failed && (this.config.demo || (this.connected && this.settings.liveAIEnabled && Boolean(this.config.apiKey))); }
  async addVisualContext(payload,signal) {
    try{
      if(!this.frame?.configured)throw new Error('twitch_credentials_missing');
      let image=this.frameCache;
      if(!image||this.now()-image.fetchedAt>30000){image=await this.frame.capture(signal,{width:1280,height:720});if(signal.aborted)throw new Error('cancelled');this.frameCache=image;}
      payload.image=image.dataURL;
      payload.visual_context={status:'available',fetchedAt:image.fetchedAt,maxAgeSeconds:300+Math.max(0,Math.ceil((this.now()-image.fetchedAt)/1000))};
    }catch(error){if(signal.aborted)throw error;payload.visual_context={status:visualFailure(error),fetchedAt:null,maxAgeSeconds:null};}
  }
  async tick() {
    this.prune(); const form = this.getForm();
    if (this.lastForm !== form) { this.lastForm = form; this.remember({ id: `form-${randomUUID()}`, role: 'form', text: `Nib evolved to ${form}.` }); this.speech = null; this.emitEvent('clear_speech'); }
    if (this.activeEvent && this.now() >= this.activeEvent.closes) this.closeEvent();
    if (!this.eligible() || this.inFlight) return false;
    const delay = this.config.demo ? 3000 : this.settings.minIntervalSeconds * 1000;
    if (this.now() - this.lastCall < delay || (this.speech && this.now() < this.speech.at + this.speech.displayMs + 1800)) return false;
    if (!this.activeEvent && this.now() - this.lastEvent >= this.settings.eventIntervalSeconds * 1000 && (this.settings.autoQuestions || this.settings.autoPolls)) {
      const topics = [...this.recent.values()]; if (topics.length >= 3 && new Set(topics.map(e => e.participant)).size >= 2) this.requestEvent(this.settings.autoPolls && (!this.settings.autoQuestions || this.stats.events % 2 === 0) ? 'poll' : 'question', false);
    }
    if (!this.queue.length) return false;
    // A poll owns the audience's attention; a scheduled joke waits for it to finish.
    if (this.activeEvent && this.queue.every(c => c.kind === 'stream_joke')) return false;
    let index = this.activeEvent ? Math.max(0, this.queue.findIndex(c => c.kind !== 'stream_joke')) : 0;
    if (this.settings.fairness && this.queue[0].priority < 100) { const alternate = this.queue.findIndex(e => !this.responded.has(e.participant) && e.priority >= 40 && (!this.activeEvent || e.kind !== 'stream_joke')); if (alternate >= 0) index = alternate; }
    const [candidate] = this.queue.splice(index, 1), generation = this.generation;
    if (candidate.kind === 'stream_joke' && (!this.settings.streamJokesEnabled || !this.settings.jokesEnabled || !this.settings.memoryEnabled)) return false;
    this.inFlight = true; this.controller = new AbortController(); const controller = this.controller;
    const visualQuestion=!this.config.demo&&['direct','followup','topic','answer'].includes(candidate.kind)&&needsScreenContext(candidate.text);
    const totalTimeout=this.settings.timeoutMs+(visualQuestion?10000:0);
    this.emitEvent('thinking', { id: candidate.id, expires: this.now() + totalTimeout });
    let timeout;
    try {
      const settings = { ...this.settings }, payload = this.payload(candidate, form);
      if (candidate.kind === 'stream_joke') this.onStreamJoke('generating');
      let output;
      if (this.config.demo) { this.lastCall = this.now(); output = await this.demoProvider(payload, settings); }
      else {
        // The timeout also guards providers that do not settle when aborted.
        const expiry = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, totalTimeout); timeout.unref?.(); });
        this.lastCall = this.now(); this.stats.apiCalls++;
        const generate=async()=>{
          if(visualQuestion){await this.addVisualContext(payload,controller.signal);candidate.visual=payload.visual_context;}
          if(controller.signal.aborted||generation!==this.generation||!this.eligible()||this.now()>candidate.expires||form!==this.getForm())throw new Error('stale_response');
          return this.ai.generate(payload,settings,controller.signal);
        };
        output = await Promise.race([generate(), expiry]);
      }
      if (controller.signal.aborted || generation !== this.generation || !this.eligible() || this.now() > candidate.expires || form !== this.getForm()) { this.stats.discarded++; if(candidate.kind==='stream_joke')this.onStreamJoke('stale_response'); return false; }
      if (!output.should_reply) { if (candidate.kind === 'stream_joke') this.onStreamJoke('no_joke'); return false; }
      if (/_request$/u.test(candidate.kind) && (!output.followup || !safeConversationText(output.followup.question,this.config.blockedTerms) ||
          ((candidate.kind==='poll_request'||output.followup.kind==='choice')&&new Set(output.followup.options).size<2) ||
          output.followup.options.some(v=>!safeConversationText(v,this.config.blockedTerms)))) throw new Error('invalid_response');
      if (/_request$/u.test(candidate.kind)) output.reply = output.followup.question;
      const manualEvent = /_request$/u.test(candidate.kind) && candidate.manual === true;
      if (!safeConversationText(output.reply, this.config.blockedTerms) || privateTopic(output.reply) || (!manualEvent && this.logs.slice(0,20).some(e => e.text === output.reply))) { this.stats.filtered++; if(candidate.kind==='stream_joke')this.onStreamJoke('filtered'); return false; }
      this.publish(output, candidate, form, this.config.demo ? 'demo' : 'ai');
      if (candidate.kind === 'stream_joke') this.onStreamJoke('spoken'); return true;
    } catch (error) {
      const code = controller.signal.aborted ? (generation !== this.generation ? 'cancelled' : 'timeout') : ['budget_limit', 'ai_busy', 'invalid_response', 'usage_missing', 'stale_response'].includes(error.message) ? error.message : 'request_failed';
      if (candidate.kind === 'stream_joke') this.onStreamJoke(code);
      this.errors.unshift({ at: this.now(), code }); this.errors = this.errors.slice(0, 12); this.emitEvent('error', { code }); return false;
    } finally { clearTimeout(timeout); this.inFlight = false; if (this.controller === controller) this.controller = null; this.emitEvent('thinking_done', { id: candidate.id }); }
  }
  publish(output, candidate, form, provider) {
    const animation = this.settings.emotesEnabled && ANIMATIONS.includes(output.animation) ? output.animation : this.settings.emotesEnabled ? 'curious' : 'none';
    const profile = candidate.participant ? this.relationships.key(candidate.participant) : null;
    const text=candidate.kind==='result'&&provider!=='local'?`${candidate.text} ${output.reply}`.slice(0,140):output.reply;
    const speech = { id: randomUUID(), text, animation, form, at: this.now(), expires: Math.min(candidate.expires ?? Infinity, this.now() + this.settings.candidateTTLSeconds * 1000),
      displayMs: this.settings.displayMs, priority: candidate.priority, provider,
      name: this.settings.showNames ? this.names.get(candidate.participant) || '' : '' };
    this.speech = speech; this.stats.replies++;
    this.responseLog.append({id:speech.id,at:speech.at,text:speech.text,animation,form,provider,source:candidate.text?.slice(0,240)||'',kind:candidate.kind||'unknown',
      ...(candidate.visual?{visual:candidate.visual}:candidate.kind==='stream_joke'?{visual:{status:'available',fetchedAt:candidate.streamContext?.screenshot_fetched_at??null,maxAgeSeconds:candidate.streamContext?.screenshot_max_age_seconds??300}}:{})});
    this.remember({ id: speech.id, role: 'nib', text: speech.text, profile });
    if (candidate.participant) { this.responded.set(candidate.participant, this.now()); this.relationships.award(candidate.participant, candidate.kind === 'followup' ? 'followup' : 'reply', this.now(), this.settings); }
    if (output.followup && !this.activeEvent && this.settings.enabled) this.openEvent(output.followup, candidate.kind === 'poll_request' ? 'poll' : 'question', candidate.participant, ['direct','followup'].includes(candidate.kind));
    this.emitEvent('speech', { speech });
  }
  snapshot() {
    this.prune(); this.relationships.prune(this.now(), this.settings.retentionDays);
    const records = this.store.state.records.filter(r => r.purpose === 'reaction');
    return { settings: this.settings, provider: this.config.demo ? 'LOCAL DEMO · NO API' : this.eligible() ? 'LIVE AI' : 'OFF',
      stats: { ...this.stats, apiCalls: records.length, inputTokens: records.reduce((n, r) => n + r.inputTokens, 0), outputTokens: records.reduce((n, r) => n + r.outputTokens, 0), estimatedCost: records.reduce((n, r) => n + (r.status === 'success' || r.inputTokens + r.outputTokens ? r.estimatedCost : r.reservedCost), 0) },
      inFlight: this.inFlight, queueLength: this.queue.length, memoryEntries: this.memory.length, event: this.eventView(), speech: this.speech,
      logs: this.logs.slice(0,20),logHistory:{retentionHours:6,totalEntries:this.logs.length,storageFailed:this.responseLog.storageFailed}, errors: this.errors, relationships: this.relationships.snapshot(), storageFailed: this.ai.failed };
  }
  stop() { this.connected = false; this.clearSession(); }
}
