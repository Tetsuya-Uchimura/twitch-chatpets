// @ts-check
/** Reuse Chat Pulse's emotion type; this module has no mood controller or network dependency.
 * @typedef {import('./pulse-classifier.js').Emotion} Mood
 * @typedef {'praise'|'jump'|'eat'|'battle'} ActionIntent
 * @typedef {'notice'|'smile'|'laugh'|'squash'|'stomp'|'tilt'|'turn-away'|'pause'|'walk'|'bounce'|'dash'|'inspect'|'jump'|'double-jump'|'diagonal-jump'|'bite'|'nibble'|'headbutt'|'celebrate'|'tail-wag'|'double-bounce'|'secret-wag'|'chew'|'land'|'clumsy-land'} Primitive
 * @typedef {{id:string,mood:Mood,intent:ActionIntent,anticipation:Primitive,approach:Primitive,mainAction:Primitive,recovery:Primitive,speedMultiplier:number,jumpMultiplier:number,effectType:string,phases:readonly number[],priority:number}} ActionVariant
 */
/** @type {readonly ActionIntent[]} */
export const ACTION_INTENTS = Object.freeze(['praise', 'jump', 'eat', 'battle']);
/** @param {Mood} mood @param {ActionIntent} intent @param {Primitive} anticipation @param {Primitive} approach
 * @param {Primitive} mainAction @param {Primitive} recovery @param {number} speedMultiplier
 * @param {number} jumpMultiplier @param {string} effectType @returns {Readonly<ActionVariant>} */
function variant(mood, intent, anticipation, approach, mainAction, recovery, speedMultiplier, jumpMultiplier, effectType) {
  const lead = mood === 'confusion' ? 320 : mood === 'excitement' ? 120 : mood === 'laughter' ? 150 : mood === 'anger' ? 240 : 210;
  return Object.freeze({ id: `${mood}:${intent}`, mood, intent, anticipation, approach, mainAction, recovery,
    speedMultiplier, jumpMultiplier, effectType, priority: intent === 'battle' ? 30 : 20,
    phases: Object.freeze([lead, mood === 'confusion' ? 500 : 410, 730, intent === 'battle' ? 450 : 350, 600]) });
}
/** Data, not twenty physics engines. All variants use the same five-phase evaluator.
 * @type {Record<Mood,Record<ActionIntent,Readonly<ActionVariant>>>} */
const matrix = {
  calm: {
    praise: variant('calm', 'praise', 'smile', 'walk', 'celebrate', 'tail-wag', 1, .25, 'soft'),
    jump: variant('calm', 'jump', 'squash', 'walk', 'jump', 'land', 1, .76, 'soft'),
    eat: variant('calm', 'eat', 'notice', 'walk', 'bite', 'smile', 1, .12, 'crumbs'),
    battle: variant('calm', 'battle', 'notice', 'walk', 'headbutt', 'land', 1, .12, 'soft'),
  },
  laughter: {
    praise: variant('laughter', 'praise', 'laugh', 'bounce', 'double-bounce', 'tail-wag', 1.12, .48, 'cyan'),
    jump: variant('laughter', 'jump', 'laugh', 'bounce', 'double-jump', 'double-bounce', 1.12, .72, 'cyan'),
    eat: variant('laughter', 'eat', 'laugh', 'bounce', 'bite', 'double-bounce', 1.12, .3, 'cyan'),
    battle: variant('laughter', 'battle', 'laugh', 'bounce', 'headbutt', 'double-bounce', 1.12, .35, 'cyan'),
  },
  excitement: {
    praise: variant('excitement', 'praise', 'squash', 'dash', 'jump', 'celebrate', 1.35, .92, 'sparkle'),
    jump: variant('excitement', 'jump', 'squash', 'dash', 'jump', 'land', 1.35, 1, 'landing'),
    eat: variant('excitement', 'eat', 'squash', 'dash', 'bite', 'celebrate', 1.35, .38, 'sparkle'),
    battle: variant('excitement', 'battle', 'squash', 'dash', 'headbutt', 'celebrate', 1.35, .3, 'landing'),
  },
  anger: {
    praise: variant('anger', 'praise', 'pause', 'turn-away', 'stomp', 'secret-wag', 1.05, .08, 'stomp'),
    jump: variant('anger', 'jump', 'stomp', 'dash', 'jump', 'land', 1.15, .9, 'stomp'),
    eat: variant('anger', 'eat', 'stomp', 'dash', 'bite', 'chew', 1.12, .12, 'stomp'),
    battle: variant('anger', 'battle', 'stomp', 'dash', 'headbutt', 'chew', 1.15, .18, 'stomp'),
  },
  confusion: {
    praise: variant('confusion', 'praise', 'tilt', 'inspect', 'celebrate', 'smile', .9, .38, 'question'),
    jump: variant('confusion', 'jump', 'tilt', 'inspect', 'diagonal-jump', 'clumsy-land', .92, .72, 'question'),
    eat: variant('confusion', 'eat', 'tilt', 'inspect', 'nibble', 'smile', .9, .1, 'question'),
    battle: variant('confusion', 'battle', 'tilt', 'inspect', 'headbutt', 'clumsy-land', .92, .2, 'question'),
  },
};
/** @param {unknown} mood @returns {Mood} */
export function normalizeMood(mood) { return typeof mood === 'string' && Object.hasOwn(matrix, mood) ? /** @type {Mood} */ (mood) : 'calm'; }
/** @param {unknown} mood @param {unknown} intent */
export function resolveActionVariant(mood, intent) {
  const action = ACTION_INTENTS.includes(/** @type {ActionIntent} */ (intent)) ? /** @type {ActionIntent} */ (intent) : 'eat';
  return matrix[normalizeMood(mood)][action];
}
/** @param {{intent?:string,performance?:string,category?:string}} value @returns {ActionIntent|null} */
export function interactionIntent(value) {
  if (ACTION_INTENTS.includes(/** @type {ActionIntent} */ (value.intent))) return /** @type {ActionIntent} */ (value.intent);
  if (value.performance === 'jump') return 'jump';
  if (value.performance === 'attack') return 'battle';
  if (value.performance === 'eat') return value.category === 'support' ? 'praise' : 'eat';
  return null;
}
/** @param {Readonly<ActionVariant>} value @param {number} [tempoFactor] */
export function variantDuration(value, tempoFactor = 1) {
  return value.phases.reduce((sum, duration) => sum + duration, 0) / value.speedMultiplier * tempoFactor;
}
