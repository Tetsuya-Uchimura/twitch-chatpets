// @ts-check
/** @typedef {import('../shared/action-variants.js').ActionVariant} ActionVariant */
const clamp = (/** @type {number} */ n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export const ease = (/** @type {number} */ n) => { const t = clamp(n); return t * t * (3 - 2 * t); };
/** Shared pixel-motion primitives, all deterministic and bounded. */
export const motion = Object.freeze({
  walk: (/** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ t) => from + (to - from) * ease(t),
  dash: (/** @type {number} */ from, /** @type {number} */ to, /** @type {number} */ t) => from + (to - from) * (1 - (1 - clamp(t)) ** 3),
  jump: (/** @type {number} */ t, /** @type {number} */ height, count = 1) => -Math.abs(Math.sin(Math.PI * clamp(t) * count)) * height,
  stomp: (/** @type {number} */ t) => -Math.sin(Math.PI * clamp(t)) * 5,
});
/** @param {Readonly<ActionVariant>} variant @param {number} elapsed
 * @param {{target:number,startX:number,duration:number,home:number,floor:number}} space */
export function variantPose(variant, elapsed, space) {
  const { target, startX, duration, home, floor } = space;
  const total = variant.phases.reduce((a, b) => a + b, 0), t = clamp(elapsed / duration) * total;
  const [lead, chase, main, recovery] = variant.phases;
  const approach = Math.max(home + 15, target - 89);
  const startMain = lead + chase, startRecovery = startMain + main, startReturn = startRecovery + recovery;
  const frame = Math.floor(elapsed / (variant.mood === 'anger' ? 85 : variant.mood === 'calm' ? 170 : 110));
  const p = { action: 'notice', x: startX, jump: 0, facing: 1, frame, phase: 'notice', primitive: variant.anticipation,
    impact: false, capsuleY: floor - 17, capsuleVisible: true, headTilt: 0, tailFrame: 0, arms: false,
    softSmile: false, squat: 0, effectType: variant.effectType, variantId: variant.id };
  const grumpyPraise = variant.intent === 'praise' && variant.mood === 'anger';
  const jumpIntent = variant.intent === 'jump';
  const praise = variant.intent === 'praise';
  const travel = jumpIntent ? 132 : variant.intent === 'battle' ? (variant.mood === 'anger' ? 70 : 58) : 0;
  const end = grumpyPraise ? home - 14 : praise ? approach : approach + travel;
  if (t < lead) {
    const q = t / lead;
    return { ...p, action: variant.anticipation === 'squash' ? 'jump' : 'notice', frame: 0,
      jump: variant.anticipation === 'stomp' ? motion.stomp(q) : 0, squat: variant.anticipation === 'squash' ? 2 : 0,
      headTilt: variant.anticipation === 'tilt' ? 1 : 0, softSmile: variant.anticipation === 'smile' };
  }
  if (t < startMain) {
    const q = (t - lead) / chase;
    if (grumpyPraise) return { ...p, x: motion.walk(startX, end, q), facing: -1, action: 'walk', phase: 'chase', primitive: 'turn-away', arms: true };
    const inspecting = variant.approach === 'inspect';
    return { ...p, x: inspecting ? motion.walk(startX, approach, clamp((q - .25) / .75)) :
      variant.approach === 'dash' ? motion.dash(startX, approach, q) : motion.walk(startX, approach, q),
      jump: variant.approach === 'bounce' ? motion.jump(q, 14, 2) : 0,
      action: inspecting && q < .35 ? 'notice' : variant.approach === 'dash' ? 'run' : 'walk',
      phase: 'chase', primitive: variant.approach, headTilt: inspecting && q < .55 ? 1 : 0 };
  }
  if (t < startRecovery) {
    const q = (t - startMain) / main, impact = q >= (jumpIntent ? .97 : variant.intent === 'battle' ? .68 : .55);
    if (grumpyPraise) return { ...p, x: end, facing: -1, action: 'notice', phase: 'interact', primitive: 'stomp',
      jump: q < .5 ? motion.stomp(q * 2) : 0, arms: true, squat: q > .45 && q < .65 ? 1 : 0, impact };
    const mainHop = ['jump', 'double-jump', 'diagonal-jump', 'double-bounce', 'celebrate'].includes(variant.mainAction);
    if (mainHop) {
      const count = ['double-jump', 'double-bounce'].includes(variant.mainAction) ? 2 : 1;
      const awkward = variant.mainAction === 'diagonal-jump';
      return { ...p, x: approach + travel * q + (awkward ? Math.sin(q * Math.PI) * 14 : count === 2 ? Math.sin(q * Math.PI * 2) * 9 : 0),
        action: variant.mainAction === 'celebrate' ? 'happy' : 'jump', phase: 'interact', primitive: variant.mainAction,
        jump: motion.jump(q, 68 * variant.jumpMultiplier, count), frame: q < .12 ? 0 : q > .9 ? 2 : 1,
        impact, headTilt: awkward && q > .7 ? -1 : 0, softSmile: variant.mood === 'calm' || variant.mood === 'confusion' };
    }
    const battle = variant.intent === 'battle', nibble = variant.mainAction === 'nibble';
    const qMove = battle ? (variant.mood === 'confusion' ? ease(clamp((q - .18) / .82)) : 1 - (1 - q) ** 3) : 0;
    return { ...p, x: approach + travel * qMove, action: battle ? 'attack' : nibble && q < .3 ? 'notice' : 'eat',
      phase: 'interact', primitive: nibble && q < .3 ? 'inspect' : variant.mainAction,
      jump: variant.mood === 'laughter' ? motion.jump(q, battle ? 18 : 9, 2) : 0,
      headTilt: nibble && q < .35 ? 1 : 0, frame, impact,
      capsuleVisible: !impact, softSmile: false };
  }
  if (t < startReturn) {
    const q = (t - startRecovery) / recovery;
    const wag = ['tail-wag', 'secret-wag'].includes(variant.recovery);
    const clumsy = variant.recovery === 'clumsy-land';
    return { ...p, x: end + (clumsy ? Math.sin(q * Math.PI * 2) * 8 * (1 - q) : 0),
      facing: grumpyPraise ? -1 : 1,
      action: variant.recovery === 'chew' ? (variant.intent === 'eat' ? 'eat' : 'notice') : grumpyPraise ? 'idle' : clumsy ? 'hurt' : 'happy',
      phase: 'result', primitive: variant.recovery, impact: true, capsuleVisible: jumpIntent,
      tailFrame: wag ? Math.floor(elapsed / (variant.recovery === 'secret-wag' ? 125 : variant.mood === 'calm' ? 210 : 75)) % 2 : 0,
      jump: variant.recovery === 'double-bounce' ? motion.jump(q, 12, 2) : variant.recovery === 'celebrate' ? motion.jump(q, 14) : 0,
      squat: variant.recovery === 'land' && q < .3 ? (variant.mood === 'calm' ? 1 : 2) : 0,
      headTilt: clumsy ? -1 : 0, arms: grumpyPraise && q < .5, softSmile: variant.recovery === 'smile' || (wag && !grumpyPraise) };
  }
  const q = (t - startReturn) / Math.max(1, total - startReturn);
  return { ...p, x: motion.walk(end, home, q), facing: end < home ? 1 : -1,
    action: q > .97 ? 'idle' : variant.mood === 'excitement' ? 'run' : 'walk', phase: 'return', primitive: 'walk',
    impact: true, capsuleVisible: false };
}
