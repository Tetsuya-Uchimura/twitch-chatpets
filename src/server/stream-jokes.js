import {randomUUID} from 'node:crypto';
import {safeConversationText, privateTopic} from './conversation-ai.js';
import {TwitchFrame} from './twitch-frame.js';

export const STREAM_JOKE_INTERVAL = 600000;
const captureErrors = new Set(['twitch_credentials_missing','twitch_auth_failed','twitch_unavailable','stream_offline','invalid_frame_url','frame_unavailable','invalid_frame','frame_too_large']);
/** A separate, ephemeral ten-minute window; it never reads the one-minute chat buffer. */
export class StreamJokes {
  constructor({config, store, conversation, now = Date.now, fetch, frame}) {
    Object.assign(this, {config, store, conversation, now}); this.frame = frame ?? new TwitchFrame({config, now, fetch});
    this.connected = false; this.buffer = []; this.nextAt = null; this.generation = 0; this.controller = null;
    this.inFlight = false; this.status = 'waiting'; this.lastWindow = null;
  }
  enabled() { const s = this.conversation.settings; return !this.config.demo && s.streamJokesEnabled && s.enabled && s.liveAIEnabled && s.jokesEnabled && s.memoryEnabled && Boolean(this.config.apiKey); }
  reset() {
    this.generation++; this.controller?.abort(); this.buffer = [];
    this.conversation.queue = this.conversation.queue.filter(c => c.kind !== 'stream_joke');
    this.nextAt = this.connected ? this.now() + STREAM_JOKE_INTERVAL : null; this.status = 'waiting';
  }
  setConnected(value) { this.connected = value; this.reset(); }
  prune() { this.buffer = this.buffer.filter(m => m.at > this.now() - STREAM_JOKE_INTERVAL && m.at <= this.now()).slice(-1000); }
  ingest(message, {excluded = false} = {}) {
    if (!this.enabled() || excluded || message.text.startsWith('!') || !safeConversationText(message.text, this.config.blockedTerms) || privateTopic(message.text)) return;
    this.buffer.push({at: message.at, text: message.text}); this.prune();
  }
  result(status) { this.status = status; }
  async tick() {
    if (!this.enabled() || !this.connected) { if (this.buffer.length || this.controller) this.reset(); return false; }
    this.prune();
    if (this.nextAt === null) this.nextAt = this.now() + STREAM_JOKE_INTERVAL;
    if (this.inFlight || this.now() < this.nextAt) return false;
    const end = this.now(); this.nextAt = end + STREAM_JOKE_INTERVAL;
    if (!this.frame.configured) { this.status = 'twitch_credentials_missing'; return false; }
    if (this.config.hourlyLimit > 0 && this.store.totals(end).hourlyCalls >= this.config.hourlyLimit) { this.status = 'hourly_limit'; return false; }
    const selected = this.buffer.filter(m => m.at > end - STREAM_JOKE_INTERVAL && m.at <= end);
    const count = Math.min(selected.length, this.config.maxMessages), evidence = []; let chars = 0;
    for (let i = 0; i < count; i++) {
      const m = selected[Math.floor(i * selected.length / count)];
      if (chars + m.text.length > this.config.maxInputChars) break;
      evidence.push({id: `window-${i}`, role: 'viewer', text: m.text, offset_seconds: Math.round((m.at - end) / 1000)}); chars += m.text.length;
    }
    const generation = this.generation, controller = new AbortController();
    this.controller = controller; this.inFlight = true; this.status = 'capturing';
    try {
      const image = await this.frame.capture(controller.signal);
      if (generation !== this.generation || controller.signal.aborted || !this.enabled() || !this.connected || this.now() - end > 30000) return false;
      const context = {start: end - STREAM_JOKE_INTERVAL, end, retained_comments: selected.length, sampled_comments: evidence.length,
        buffer_limit: 1000, screenshot_fetched_at: image.fetchedAt, screenshot_max_age_seconds: image.maxAgeSeconds};
      this.lastWindow = {...context};
      this.conversation.enqueue({id: `stream-joke-${randomUUID()}`, kind: 'stream_joke', text: 'A playful observation about the last ten minutes of stream and chat.',
        at: end, priority: 85, evidence, streamContext: context, image: image.dataURL});
      this.status = 'queued'; return true;
    } catch (error) {
      this.status = controller.signal.aborted ? 'cancelled' : captureErrors.has(error.message) ? error.message : 'capture_failed'; return false;
    } finally { this.inFlight = false; if (this.controller === controller) this.controller = null; }
  }
  snapshot() {
    this.prune(); const settings = this.conversation.settings;
    const mode = this.config.demo ? 'demo' : !settings.streamJokesEnabled ? 'disabled' : !this.enabled() ? 'conversation_disabled' : !this.frame.configured ? 'twitch_credentials_missing' : !this.connected ? 'disconnected' : this.status;
    return {enabled: settings.streamJokesEnabled, configured: this.frame.configured, intervalSeconds: 600,
      status: mode, nextAt: this.enabled() && this.connected ? this.nextAt : null, bufferedComments: this.buffer.length,
      inFlight: this.inFlight, lastWindow: this.lastWindow, apiCalls: this.store.state.records.filter(r => r.purpose === 'stream_joke').length};
  }
  stop() { this.connected = false; this.reset(); this.frame.token = null; }
}
