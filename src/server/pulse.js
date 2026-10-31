// @ts-check
import { classifyEmotion, EMOTIONS } from '../shared/pulse-classifier.js';
/** @typedef {import('../shared/pulse-classifier.js').Emotion} Emotion */
const MINUTE = 60000;
/** @returns {Record<Emotion,number>} */
const emptyCounts = () => ({ calm: 0, laughter: 0, excitement: 0, anger: 0, confusion: 0 });

/** Accepted-message analytics only. No AI/network/storage dependency. */
export class ChatPulse {
  /** @param {{minMessages?:number,minUsers?:number,cooldownSeconds?:number,dominance?:number,aiDriven?:boolean}} options
   * @param {()=>number} now */
  constructor(options = {}, now = Date.now) {
    this.now = now;
    this.options = { minMessages: options.minMessages ?? 5, minUsers: options.minUsers ?? 1,
      cooldownSeconds: options.cooldownSeconds ?? 30, dominance: options.dominance ?? .4 };
    this.aiDriven = options.aiDriven ?? false;
    this.analysisStatus = this.aiDriven ? 'collecting' : 'local';
    this.analysisRevision = 0; this.analyzedMessages = 0;
    /** @type {{at:number,participant:string,emotion:Emotion|null,confidence:number}[]} */
    this.messages = [];
    /** @type {Map<number,number>} */ this.minutes = new Map();
    this.startedAt = now(); this.lastSummary = now(); this.lastSequence = 0;
    /** @type {Emotion} */ this.emotion = 'calm';
    this.changedAt = -Infinity; this.simulated = false; this.scenario = '';
    this.lastAIEnd = -Infinity;
    this.generation = 0;
    this.evolutionEligible = false;
    /** @type {{emotion:Emotion,confidence:number,expires:number}|null} */ this.advisory = null;
    this.summary = this.measure(now());
  }
  /** @param {{at:number,sequence:number,text:string,participant:string}} message */
  ingest(message) {
    if (message.sequence <= this.lastSequence || !Number.isFinite(message.at)) return false;
    this.lastSequence = message.sequence;
    const result = classifyEmotion(message.text);
    this.messages.push({ at: message.at, participant: message.participant, ...result });
    const minute = Math.floor(message.at / MINUTE) * MINUTE;
    this.minutes.set(minute, (this.minutes.get(minute) || 0) + 1);
    this.prune(message.at);
    return true;
  }
  /** @param {number} at */
  prune(at) {
    this.messages = this.messages.filter(m => m.at > at - MINUTE && m.at <= at);
    const first = Math.floor(at / MINUTE) * MINUTE - 11 * MINUTE;
    for (const key of this.minutes.keys()) if (key < first) this.minutes.delete(key);
  }
  /** @param {number} at */
  measure(at) {
    this.prune(at);
    const counts = emptyCounts(); let unknown = 0, confidence = 0;
    const users = new Set(), allUsers = new Set();
    for (const m of this.messages) {
      allUsers.add(m.participant);
      if (m.emotion) { counts[m.emotion]++; confidence += m.confidence; users.add(m.participant); }
      else unknown++;
    }
    const classified = Object.values(counts).reduce((a, b) => a + b, 0);
    const fractions = emptyCounts();
    for (const emotion of EMOTIONS) fractions[emotion] = classified ? counts[emotion] / classified : 0;
    const participants = this.aiDriven ? allUsers.size : users.size;
    const insufficient = (this.aiDriven ? classified + unknown : classified) < this.options.minMessages || participants < this.options.minUsers;
    return { windowStart: at - MINUTE, windowEnd: at, counts, fractions, classified, unknown,
      accepted: classified + unknown, participants, insufficient,
      confidence: classified ? confidence / classified : 0 };
  }
  /** @param {number} [at] */
  tick(at = this.now()) {
    if (at - this.lastSummary < MINUTE) return false;
    this.lastSummary = at; this.summary = this.measure(at);
    if (this.aiDriven) {
      this.analysisRevision++; this.analyzedMessages = 0;
      this.analysisStatus = this.summary.insufficient ? 'insufficient' : 'pending';
      this.summary.fractions = emptyCounts(); this.evolutionEligible = false;
      if (this.summary.insufficient) this.emotion = 'calm';
      return true;
    }
    const s = this.summary;
    const ranked = [...EMOTIONS].sort((a, b) => s.fractions[b] - s.fractions[a]);
    const candidate = ranked[0], share = s.fractions[candidate], margin = share - s.fractions[ranked[1]];
    // AI can slightly reduce hysteresis for a future locally supported winner. Counts never change.
    const agrees = this.advisory && this.advisory.expires >= at && this.advisory.emotion === candidate && this.advisory.confidence >= .75;
    const gap = agrees ? .08 : .12;
    this.evolutionEligible = Boolean(!s.insufficient && s.confidence >= .7 && share >= this.options.dominance && margin >= gap &&
      (candidate === this.emotion || share - s.fractions[this.emotion] >= gap) &&
      at - this.changedAt >= this.options.cooldownSeconds * 1000);
    if (this.evolutionEligible) {
      if (candidate !== this.emotion) { this.emotion = candidate; this.changedAt = at; }
    }
    return true;
  }
  /** @param {Record<Emotion,number>} scores @param {number} end @param {number} generation @param {number} analyzed */
  applyAI(scores, end, generation, analyzed) {
    if (!this.aiDriven || end !== this.summary.windowEnd || generation !== this.generation || this.summary.insufficient || this.now() - end >= MINUTE) return false;
    const sum = EMOTIONS.reduce((n, e) => n + scores[e], 0);
    if (!Number.isFinite(sum) || sum <= 0 || EMOTIONS.some(e => !Number.isFinite(scores[e]) || scores[e] < 0)) return false;
    for (const e of EMOTIONS) this.summary.fractions[e] = scores[e] / sum;
    this.emotion = [...EMOTIONS].sort((a,b)=>scores[b]-scores[a])[0];
    this.summary.confidence = this.summary.fractions[this.emotion];
    this.analysisStatus = 'ready'; this.analysisRevision++; this.analyzedMessages = analyzed;
    this.evolutionEligible = true; this.changedAt = end;
    return true;
  }
  /** @param {string} status @param {number} end */
  markAnalysis(status, end) {
    if (this.aiDriven && this.summary.windowEnd === end) { this.analysisStatus = status; this.analysisRevision++; }
  }
  /** @param {{windowId:string,emotion:Emotion,confidence:number}|null} value
   * @param {{id:string,end:number}} window */
  refine(value, window) {
    const at = this.now();
    if (!value || value.windowId !== window.id || window.end <= this.lastAIEnd || at < window.end || at - window.end > MINUTE ||
      !EMOTIONS.includes(value.emotion) || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return false;
    this.lastAIEnd = window.end;
    this.advisory = { emotion: value.emotion, confidence: value.confidence, expires: at + MINUTE };
    return true;
  }
  /** Demo-only caller resets analytics, never the budget ledger or mascot progression.
   * @param {number} start @param {string} scenario */
  beginDemo(start, scenario) {
    this.generation++;
    this.evolutionEligible=false;
    this.messages = []; this.minutes.clear(); this.startedAt = start; this.lastSummary = start;
    this.changedAt = -Infinity; this.simulated = true; this.scenario = scenario; this.advisory = null;
    this.summary = this.measure(start);
  }
  /** An explicitly labelled demo replay can render its final simulated minute immediately.
   * @param {number} at */
  completeDemo(at) { if (this.simulated) { this.lastSummary = at - MINUTE; this.tick(at); } }
  /** @param {number} [at] */
  snapshot(at = this.now()) {
    this.tick(at);
    const current = Math.floor(at / MINUTE) * MINUTE;
    const activity = Array.from({ length: 12 }, (_, i) => {
      const start = current - (11 - i) * MINUTE;
      return { start, count: this.minutes.get(start) || 0, partial: i === 11,
        available: start + MINUTE > this.startedAt };
    });
    // A single shared logarithmic scale keeps quiet minutes legible beside spikes.
    const max = Math.max(1, ...activity.map(b => b.count));
    const ceiling = 2 ** Math.ceil(Math.log2(max + 1));
    const collecting=this.messages.filter(m=>m.at>at-MINUTE&&m.at<=at);
    return { ...this.summary, currentAccepted:collecting.length,analysisMode:this.aiDriven?'ai':'local',analysisStatus:this.analysisStatus,analysisRevision:this.analysisRevision,analyzedMessages:this.analyzedMessages,generation:this.generation, evolutionEligible:this.evolutionEligible, emotion: this.emotion, changedAt: Number.isFinite(this.changedAt) ? this.changedAt : null,
      nextSummary: this.lastSummary + MINUTE, activity, activityCeiling: ceiling,
      simulated: this.simulated, scenario: this.scenario, minMessages: this.options.minMessages,
      minUsers: this.options.minUsers, source: this.aiDriven?'AI minute sentiment scores':'accepted participating messages', scale: 'shared log1p' };
  }
}
