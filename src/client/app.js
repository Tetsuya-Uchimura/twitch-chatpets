import { mountStage } from './stage.js?v=nib-metamorph-v2';
import { actLabels } from './stage-model.js';
import {NIB_FORMS} from '../shared/nib-forms.js';
import{mountNibGallery}from'./nib-gallery.js';
import { mountConversationPanel } from './conversation-panel.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const overlay = params.get('overlay') === '1';
if(!overlay)mountNibGallery($('evolution-forms'));
document.body.classList.toggle('overlay', overlay);
document.body.classList.toggle('overlay-preview', overlay && params.get('preview') === '1');
let state, seen = 0, toastTimer, stageDirty = false;
const stage = mountStage($('world'), { overlay, onStatus: status => {
  $('current-act').textContent = status.paused ? 'Preview paused — chat stays connected' : status.label;
  $('queue-count').textContent = status.queue ? `${status.queue} queued` : 'ONE CRITTER. ONE LITTLE GAME.';
  const form=NIB_FORMS[status.form]||NIB_FORMS.base;
  $('cast-name').textContent=form.name;$('cast-summary').textContent=form.detail;
  $('habitat-name').textContent="NIB'S HABITAT";
  $('evolution-current').textContent= form.name+(state?.demoMood?' (motion test)':'');
  const explanation=status.transforming?({anticipate:'Evolution is coming · building up power',charge:'Light is gathering',morph:'The silhouette is changing',reveal:'A new Nib appears',land:'Evolution complete · landing'}[status.evolutionPhase]||'Evolving…'):status.pending?'Nib evolves once the current reaction ends':'Chat emotions evolve Nib\'s body and motion';
  $('rotation-status').textContent=explanation;
  document.querySelectorAll('[data-evolution-card]').forEach(card=>card.classList.toggle('current',card.dataset.evolutionCard===status.form));
  if (state?.demoMood) $('interaction-status').textContent = status.active ? `${status.variant || state.demoMood} · playing${status.queue ? ` · ${status.queue} queued` : ''}` : `${state.demoMood} · ready for another action`;
} });
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3300); }
async function api(url, method, data) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
}
const money = n => '$' + n.toFixed(n > 0 && n < .01 ? 5 : 2);
const time = n => n ? new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const conversationPanel = mountConversationPanel({ api, toast, stage, overlay });
function readStageForm() {
  return { tempo: Number($('tempo').value), scale: Number($('character-scale').value), cast: 'solo',
    anchor: $('anchor').value, emotes: $('stage-emotes').checked, ambient: $('stage-ambient').checked };
}
function updateStage(value) {
  const config = stageDirty ? { ...value.stageSettings, ...readStageForm() } : { ...value.stageSettings };
  if (overlay && ['left', 'center', 'right'].includes(params.get('anchor'))) config.anchor = params.get('anchor');
  config.cast = 'solo';
  stage.update({ ...value, stageSettings: config });
}
function render(value) {
  if (state && state.sessionId !== value.sessionId) { seen = 0; $('chat-log').replaceChildren(); }
  state = value; updateStage(value);
  conversationPanel.render(value);
  const { ai, game, demo } = value;
  $('connection').textContent = demo ? 'Demo world · offline ready' : ai.connected ? `Live · #${value.channel}` : value.channel ? 'Waiting for Twitch…' : 'Set TWITCH_CHANNEL to connect';
  const reception = value.twitch;
  $('connection').title = !demo && reception ? `Twitch: ${reception.phase} · received ${reception.receivedMessages} / accepted ${reception.acceptedMessages} / filtered ${reception.rejectedMessages} · last comment ${time(reception.lastMessageAt)} · last pong ${time(reception.lastPongAt)}` : '';
  $('mode-badge').textContent = demo ? 'LOCAL DEMO' : ai.connected ? 'TWITCH LIVE' : 'OFFLINE';
  $('activity').textContent = game.activity.toLocaleString(); $('energy').textContent = game.energy;
  $('energy-bar').style.width = `${game.energy}%`; $('evolutions').textContent = game.evolutions; $('emote-count').textContent = game.emotes || 0;
  const emotion = demo && value.demoMood ? value.demoMood : value.pulse?.emotion || 'calm';
  $('mood').textContent = emotion[0].toUpperCase() + emotion.slice(1);
  $('world-event').textContent = game.event === 'hype_mode' ? 'HYPE MODE' : game.event === 'feeding_frenzy' ? 'SNACK TIME' : 'LOCAL REACTIONS';
  const creature = game.creatures[0];
  $('xp-0').textContent = `${creature.xp} moments`; $('type-0').textContent = value.evolution?.name || 'Base Nib';
  $('ai-mode').textContent = ai.mode; $('ai-model').textContent = ai.modelLabel;
  $('ai-enabled').disabled = demo; $('ai-enabled').checked = !demo && ai.enabled;
  $('demo-panel').hidden = !demo;
  $('cast-motion-test').hidden = !demo;
  $('pulse-demo-controls').hidden = !demo;
  $('interaction-lab').hidden = !demo;
  if (!value.demoMood) $('interaction-status').textContent = 'Chat Pulse controls the mood. Choose a test above to compare.';
  $('autoplay').textContent = value.demoAutoplay ? 'Ⅱ Pause demo chat' : '▶ Resume demo chat';
  $('ai-note').textContent = demo ? '✓ Demo mode · zero API calls' : ai.storageFailed ? 'Storage error · AI stopped' : !ai.keyConfigured ? 'API key missing · local actions only' : ai.enabled ? `Batched emotion check every minute · 5+ messages · ${ai.hourlyLimit===0?'no hourly call limit':`max ${ai.hourlyLimit??20}/hour`}` : 'Emotion AI is OFF · regular reactions still work';
  $('interval').readOnly = true;
  if (!document.querySelector('#settings-form:focus-within')) { $('interval').value = 60; $('budget').value = ai.dailyBudget.toFixed(2); $('daily-budget-unlimited').checked=ai.dailyBudgetEnabled===false; $('budget').disabled=ai.dailyBudgetEnabled===false; }
  if (!stageDirty) {
    const s = value.stageSettings;
    $('tempo').value = s.tempo; $('character-scale').value = s.scale; $('anchor').value = s.anchor;
    $('stage-emotes').checked = s.emotes; $('stage-ambient').checked = s.ambient;

    $('tempo-value').textContent = Math.round(s.tempo / 112 * 100) + '%'; $('scale-value').textContent = Math.round(s.scale * 100) + '%';
  }
  $('evolution-next').textContent=time(value.pulse?.nextSummary);
  const statuses={pending:'AI is judging the last minute of comments…',hourly_limit:'Hourly limit reached · waiting for the next check',budget_limit:'Daily budget reached · AI checks stopped',disabled:'Emotion AI is OFF',no_key:'No AI key configured',ai_busy:'AI is busy · skipped this round',request_failed:'AI check failed · retrying next minute',timeout:'AI check timed out · retrying next minute',cancelled:'AI check cancelled',no_safe_context:'No message text is safe to send'};
  $('evolution-evidence').textContent=value.evolution?.reason==='insufficient'?`${value.pulse.currentAccepted??value.pulse.accepted}/${value.pulse.minMessages} messages · evolves at the next minute check; under 5 returns to the base form`:statuses[value.evolution?.reason]||(value.evolution?.reason==='mixed'?'Emotions are evenly split':value.pulse.analysisMode==='ai'?'Evolved by an AI check of the last minute of chat':'Last 60 seconds of comments, checked every minute');
  $('last-analysis').textContent = time(ai.lastAnalysis); $('next-analysis').textContent = ai.inFlight ? 'Analyzing…' : time(ai.nextAnalysis);
  $('requests').textContent = ai.totalRequests; $('tokens').textContent = `${ai.inputTokens.toLocaleString()} / ${ai.outputTokens.toLocaleString()}`;
  $('cost').textContent = demo ? '$0.00' : money(ai.estimatedCost); $('remaining').textContent = ai.dailyBudgetEnabled===false?'Unlimited':money(ai.dailyBudgetRemaining);
  $('recommendation').textContent = ai.lastError ? (statuses[ai.lastError]||`Analysis ${ai.lastError.replaceAll('_',' ')}.`) : ai.lastRecommendation ? ai.analysisMode==='minute'?`${ai.lastRecommendation.emotion} · ${ai.lastRecommendation.reason}`:`${ai.lastRecommendation.creatureType} · ${ai.lastRecommendation.recommendedEvent.replaceAll('_', ' ')} — ${ai.lastRecommendation.reason}` : 'Each minute with 5+ messages is judged as one batch.';
}
function interaction(value) {
  if (value.sequence <= seen) return; seen = value.sequence; stage.receive(value);
  const li = document.createElement('li'), text = document.createElement('span'), label = document.createElement('small');
  text.textContent = value.text; label.textContent = actLabels[value.performance] || value.category;
  li.append(text, label); const log = $('chat-log'); log.querySelector('.empty')?.remove(); log.prepend(li);
  while (log.children.length > 5) log.lastChild.remove();
  if (value.emote) $('last-emote').textContent = ({ kekw: 'KEKW', pog: 'POG!', bruh: 'BRUH.', love: 'BIG W' })[value.emote];
}
const stream = new EventSource('/api/events');
stream.addEventListener('state', event => render(JSON.parse(event.data)));
stream.addEventListener('interaction', event => interaction(JSON.parse(event.data)));
stream.addEventListener('conversation', event => stage.conversation(JSON.parse(event.data)));
stream.onerror = () => { $('connection').textContent = 'Reconnecting to local server…'; };
async function send(text) {
  if (!text.trim()) return;
  try { const result = await api('/api/demo/message', 'POST', { text }); if (!result.accepted) toast('Filtered or on cooldown. Try another little moment.'); }
  catch (error) { toast(error.message); }
}
$('chat-form').addEventListener('submit', event => { event.preventDefault(); send($('chat-input').value); $('chat-input').value = ''; });
document.querySelectorAll('[data-message]').forEach(button => button.addEventListener('click', () => send(button.dataset.message)));
$('interaction-form').addEventListener('submit', async event => {
  event.preventDefault(); $('test-interaction').disabled = true;
  try {
    await api('/api/demo/interaction', 'POST', { mood: $('test-mood').value, intent: $('test-intent').value });
  } catch (error) { toast(error.message); }
  finally { $('test-interaction').disabled = false; }
});
$('use-pulse').addEventListener('click', async () => {
  try { await api('/api/demo/interaction/reset', 'POST', {}); toast('Chat Pulse mood resumes after the current action.'); }
  catch (error) { toast(error.message); }
});
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', async () => {
  const buttons = [...document.querySelectorAll('[data-scenario]')]; buttons.forEach(b => { b.disabled = true; });
  try {
    const result = await api('/api/demo/pulse', 'POST', { scenario: button.dataset.scenario });
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    $('pulse-demo-note').textContent = `${result.label} · ${result.accepted} accepted simulated messages · 12 minutes. Nib changes mood when the current action finishes.`;
    toast(`${result.label} · simulated history ready`);
  } catch (error) { toast(error.message); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}));
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/api/ai/settings', 'PATCH', { intervalSeconds: Number($('interval').value), dailyBudget: Number($('budget').value), dailyBudgetEnabled: !$('daily-budget-unlimited').checked }); toast('Settings saved.'); }
  catch (error) { toast(error.message); }
});
$('daily-budget-unlimited').addEventListener('change',()=>{ $('budget').disabled=$('daily-budget-unlimited').checked; });
$('ai-enabled').addEventListener('change', async event => {
  try { await api('/api/ai/settings', 'PATCH', { enabled: event.target.checked }); toast(event.target.checked ? 'AI enabled for live Twitch chat.' : 'AI analysis disabled.'); }
  catch (error) { event.target.checked = false; toast(error.message); }
});
$('reset').addEventListener('click', async () => { try { render(await api('/api/visuals/reset', 'POST', {})); toast('Visual counters reset. API usage is retained.'); } catch (error) { toast(error.message); } });
$('stage-form').addEventListener('input', () => {
  stageDirty = true; $('tempo-value').textContent = Math.round(Number($('tempo').value) / 112 * 100) + '%'; $('scale-value').textContent = Math.round(Number($('character-scale').value) * 100) + '%';
  if (state) updateStage(state);
});
$('stage-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { const settings = await api('/api/stage/settings', 'PATCH', readStageForm()); stageDirty = false;
    if (state) render({ ...state, stageSettings: settings }); toast('Overlay saved. Nib follows your settings in OBS.'); }
  catch (error) { toast(error.message); }
});
$('pause-stage').addEventListener('click', () => { const paused = stage.togglePause(); $('pause-stage').textContent = paused ? '▶ Resume preview' : 'Ⅱ Pause preview'; });
$('autoplay').addEventListener('click', async () => { try { await api('/api/demo/playback', 'POST', { enabled: !state.demoAutoplay }); } catch (error) { toast(error.message); } });
$('backdrop').addEventListener('click', () => { const checker = $('world-wrap').classList.toggle('checker'); $('backdrop').textContent = checker ? '▰ Habitat backdrop' : '▦ Transparency check'; });
const overlayURL = new URL('/?overlay=1', location.href).href;
$('overlay-url').value = overlayURL;
$('copy-overlay').addEventListener('click', async () => { try { await navigator.clipboard.writeText(overlayURL); toast('OBS Browser Source URL copied.'); } catch { $('overlay-url').select(); toast('Select and copy the overlay URL.'); } });
