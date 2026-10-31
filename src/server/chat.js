import { createHash } from 'node:crypto';
import { classifyEmotion } from '../shared/pulse-classifier.js';

export function classify(text) {
  if (/^(?:!battle)\b/i.test(text)) return 'battle';
  if (/(?:lol|lmao|kekw|lul|草|笑|😂|🤣|ｗ{2,}|w{2,})/iu.test(text)) return 'laughter';
  if (/(?:\bgg\b|good game|頑張|がんば|ありがとう|応援|nice|thanks|❤|💖)/iu.test(text)) return 'support';
  if (/(?:pog|hype|let'?s go|すご|最高|🔥|🎉|!!)/iu.test(text)) return 'hype';
  if (/[?？]|どう|なぜ|何|why|how/iu.test(text)) return 'question';
  return 'neutral';
}
// Local performance cues are independent of the AI atmosphere categories.
export function performanceCue(text, category = classify(text)) {
  if (category === 'battle') return { performance: 'attack', explicit: true };
  if (/!walk\b/iu.test(text)) return { performance: 'walk', explicit: true };
  if (/!jump\b|\bjump\b|ジャンプ|飛び越|ぴょん/iu.test(text)) return { performance: 'jump', explicit: true };
  if (/!sleep\b|\bgood\s*night\b|\bgn\b|\bzzz+\b|おやすみ|眠い|寝よう/iu.test(text)) return { performance: 'sleep', explicit: true };
  if (/!powerup\b|!evolve\b|パワーアップ/iu.test(text)) return { performance: 'powerup', explicit: true };
  if (/!feed\b|!eat\b|\b(?:snack|hungry|noodles|pizza)\b|もぐ|お腹|ごはん|食べ|🍜|🍕|🍔|🍙|🍪/iu.test(text)) return { performance: 'eat', explicit: true };
  if (/!dance\b|!happy\b|\b(?:dance|dancing|party|vibing|vibe)\b|踊|ダンス/iu.test(text)) return { performance: 'happy', explicit: true };
  if (/\b(?:bruh|bonk|oops)\b|やらか|なんでやねん/iu.test(text)) return { performance: 'recoil', explicit: true };
  return { performance: category === 'laughter' ? 'play' : category === 'hype' ? 'dash' : category === 'question' ? 'inspect' : 'eat', explicit: false };
}
// Intent is separate from legacy performance names and Chat Pulse sentiment.
export function chatIntent(text, category, performance, explicit = false) {
  if (performance === 'attack') return 'battle';
  if (performance === 'jump') return 'jump';
  if (performance === 'eat') return category === 'support' && !explicit ? 'praise' : 'eat';
  return null;
}
export function sanitize(text, config) {
  if (typeof text !== 'string') return null;
  let clean = [...text.normalize('NFKC')].slice(0, 240).join('').replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  if (!clean || /https?:\/\/|www\.|<script|kill yourself|死ね/iu.test(clean)) return null;
  if (config.blockedTerms.some(word => clean.toLowerCase().includes(word))) return null;
  // Strip account mentions, emails, identifiers and long numerical IDs before storage or display.
  clean = clean.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]')
    .replace(/@[\p{L}\p{N}_]+/gu, '[viewer]').replace(/\b\d{6,}\b/gu, '[id]');
  return clean;
}
export class ChatWindow {
  constructor(config, now = Date.now) { this.config = config; this.now = now; this.messages = []; this.rates = new Map(); this.sequence = 0; this.battleAt = -Infinity; }
  prune() {
    const cutoff = this.now() - this.config.intervalSeconds * 1000;
    this.messages = this.messages.filter(m => m.at >= cutoff).slice(-this.config.maxMessages);
    for (const [key, value] of this.rates) if (value.at < this.now() - 60000) this.rates.delete(key);
  }
  accept({ text, userId = 'anonymous', authorized = false }) {
    this.prune();
    const clean = sanitize(text, this.config);
    if (!clean) return null;
    const participant = createHash('sha256').update(String(userId)).digest('hex');
    const last = this.rates.get(participant);
    if (last && this.now() - last.at < 900) return null;
    if (this.rates.size >= 5000 && !last) return null;
    const recent = this.messages.filter(m => m.at > this.now() - 10000);
    if (recent.length >= 80 || recent.some(m => m.participant === participant && m.text.toLowerCase() === clean.toLowerCase())) return null;
    const category = classify(clean);
    if (category === 'battle' && (!authorized || this.now() - this.battleAt < 30000)) return null;
    if (category === 'battle') this.battleAt = this.now();
    this.rates.set(participant, { at: this.now() });
    const cue = performanceCue(clean, category);
    const message = { sequence: ++this.sequence, at: this.now(), participant, text: clean, category, authorized, ...cue,
      intent: chatIntent(clean, category, cue.performance, cue.explicit) };
    this.messages.push(message);
    this.prune();
    return message;
  }
  aggregate(afterSequence = 0) {
    this.prune();
    const messages = this.messages.filter(m => m.sequence > afterSequence);
    if (!messages.length) return null;
    const counts = { support: 0, laughter: 0, hype: 0, question: 0, neutral: 0 };
    const emotions = { calm: 0, laughter: 0, excitement: 0, anger: 0, confusion: 0, unknown: 0 };
    for (const m of messages) counts[m.category === 'battle' ? 'neutral' : m.category]++;
    for (const m of messages) emotions[classifyEmotion(m.text).emotion || 'unknown']++;
    const expressions = new Map();
    // Whitelist only: free-form text is omitted by default.
    for (const m of messages) for (const expression of ['LOL', 'GG', '草', 'Pog', '😂', '🔥', '頑張れ']) {
      if (m.text.toLowerCase().includes(expression.toLowerCase())) expressions.set(expression, (expressions.get(expression) || 0) + 1);
    }
    const lastSequence = messages.at(-1).sequence;
    const window = { id: `${messages[0].sequence}:${lastSequence}:${this.now()}`, start: messages[0].at, end: this.now() };
    const payload = {
      analysisWindow: window,
      windowSeconds: this.config.intervalSeconds, totalMessages: messages.length,
      uniqueParticipants: new Set(messages.map(m => m.participant)).size,
      localCategoryCounts: counts,
      localEmotionCounts: emotions,
      commonExpressions: [...expressions].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count),
      representativeMessages: this.config.representatives ? [...new Set(messages.map(m => m.text))].slice(0, 5).map(s => [...s].slice(0, 100).join('')) : [],
    };
    while (JSON.stringify(payload).length > this.config.maxInputChars && payload.representativeMessages.length) payload.representativeMessages.pop();
    while (JSON.stringify(payload).length > this.config.maxInputChars && payload.commonExpressions.length) payload.commonExpressions.pop();
    if (JSON.stringify(payload).length > this.config.maxInputChars) return null;
    return { payload, lastSequence, window };
  }
  clearDemoWindow() { this.messages = []; this.rates.clear(); this.battleAt = -Infinity; }
}
