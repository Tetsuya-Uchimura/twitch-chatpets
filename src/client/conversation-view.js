export const SPEECH_MOTION_MS = 1100;
const poses = { happy: 'happy', laugh: 'happy', surprised: 'notice', curious: 'notice', shy: 'idle', proud: 'happy', sleepy: 'sleep', cheer: 'jump', comic_angry: 'attack', none: 'idle' };
export class SpeechSequence {
  constructor() { this.reset(); }
  reset() { this.pending = []; this.current = null; this.seen = new Set(); this.thinking = null; }
  receive(event, now) {
    if (event.type === 'settings' && event.emotesEnabled === false) { if(this.current)this.current.animation='none';return; }
    if (event.type === 'clear' || event.type === 'clear_speech') { this.pending = []; this.current = null; this.thinking = null; return; }
    if (event.type === 'thinking') { this.thinking = { id: event.id, expires: event.expires }; return; }
    if (event.type === 'thinking_done' || event.type === 'error') { if (!event.id || event.id === this.thinking?.id) this.thinking = null; return; }
    if (event.type !== 'speech') return;
    const s = event.speech;
    if (!s || this.seen.has(s.id) || s.expires <= now || typeof s.text !== 'string') return;
    this.seen.add(s.id); if (this.seen.size > 120) this.seen.delete(this.seen.values().next().value);
    this.pending.push(s); this.pending.sort((a, b) => (b.priority || 0) - (a.priority || 0)); this.pending = this.pending.slice(0, 3);
  }
  advance(now, form) {
    this.pending = this.pending.filter(s => s.expires > now && s.form === form);
    if (this.current && (now >= this.current.started + this.current.displayMs || this.current.form !== form)) this.current = null;
    if (this.thinking?.expires < now) this.thinking = null;
  }
  start(now, form, blocked) {
    if (blocked) return false;
    this.advance(now, form);
    if (this.current || !this.pending.length) return false;
    this.current = { ...this.pending.shift(), started: now }; this.thinking = null; return true;
  }
  emoting(now) { return this.current && this.current.animation !== 'none' && now - this.current.started < SPEECH_MOTION_MS; }
  pose(actor, now, reduced) {
    if (!this.emoting(now)) return actor;
    const s = this.current, elapsed = now - s.started, action = poses[s.animation] || 'notice';
    const lift = !reduced && ['cheer', 'happy', 'laugh', 'proud'].includes(s.animation) ? -Math.abs(Math.sin(elapsed / 180)) * 16 : 0;
    return { ...actor, x: 82, facing: 1, action, frame: Math.floor(elapsed / 140) % 4, jump: lift,
      headTilt: s.animation === 'curious' ? 1 : s.animation === 'shy' ? -1 : 0,
      squat: s.animation === 'comic_angry' ? 2 : 0, arms: ['cheer', 'proud'].includes(s.animation), softSmile: s.animation === 'shy',
      phase: 'speech', note: null, capsuleVisible: false, performance: null };
  }
}
function lines(ctx, text, width, maxLines) {
  const result = []; let line = '';
  for (const ch of [...text]) {
    if (ctx.measureText(line + ch).width > width && line) { result.push(line); line = ''; }
    if (result.length === maxLines) { result[maxLines - 1] = result[maxLines - 1].slice(0, -1) + '…'; return result; }
    line += ch;
  }
  if (line) result.push(line); return result;
}
export function drawSpeech(ctx, layout, speech, thinking, now) {
  if (!speech && !thinking) return;
  const s = layout.width / 320, x = layout.x + 142 * s, y = layout.y + 8 * s, w = 171 * s;
  ctx.save(); ctx.font = `600 ${Math.round(12 * s)}px 'Segoe UI',sans-serif`;
  const rows = lines(ctx, speech ? (speech.name ? `@${speech.name}: ` : '') + speech.text : '…', w - 18 * s, 6);
  const h = (rows.length * 17 + 27) * s;
  ctx.fillStyle = '#253c3f'; ctx.fillRect(Math.round(x - 2 * s), Math.round(y - 2 * s), Math.round(w + 4 * s), Math.round(h + 4 * s));
  ctx.fillStyle = '#f7f2dd'; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.beginPath(); ctx.moveTo(x + 8 * s, y + h); ctx.lineTo(x, y + h + 8 * s); ctx.lineTo(x + 21 * s, y + h); ctx.fill();
  ctx.fillStyle = '#263b40'; ctx.textAlign = 'left';
  rows.forEach((line, i) => ctx.fillText(line, Math.round(x + 9 * s), Math.round(y + (19 + i * 17) * s)));
  ctx.font = `700 ${Math.round(9 * s)}px 'Segoe UI',sans-serif`; ctx.fillStyle = '#56745e';
  ctx.fillText(speech ? 'NIB' : 'NIB · …', Math.round(x + 9 * s), Math.round(y + h - 7 * s)); ctx.restore();
}
export function drawConversationEvent(ctx, layout, event, now) {
  if (!event) return;
  const s = layout.width / 320, x = layout.x + 6 * s, y = layout.y + 195 * s, w = 308 * s;
  ctx.save(); ctx.fillStyle = '#172e32ef'; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(85 * s));
  ctx.textAlign = 'left'; ctx.fillStyle = '#c3e99b'; ctx.font = `700 ${Math.round(10 * s)}px 'Segoe UI',sans-serif`;
  ctx.fillText(`${event.kind === 'poll' ? 'NIB VOTE' : 'NIB ASKS'} · ${Math.max(0, Math.ceil((event.closes - now) / 1000))}s · ${event.participants} joined`, x + 8 * s, y + 14 * s);
  ctx.fillStyle = '#f0f4e5'; ctx.font = `600 ${Math.round(11 * s)}px 'Segoe UI',sans-serif`;
  lines(ctx, event.prompt, w - 16 * s, 2).forEach((line, i) => ctx.fillText(line, x + 8 * s, y + (29 + i * 14) * s));
  const choices = event.options.map((v, i) => `${i + 1}:${v} (${event.counts[i] || 0})`).join(' / ');
  ctx.fillText(choices.slice(0, 36), x + 8 * s, y + 60 * s);
  ctx.fillStyle = '#c3e99b'; ctx.fillText(event.command, x + 8 * s, y + 76 * s); ctx.restore();
}
