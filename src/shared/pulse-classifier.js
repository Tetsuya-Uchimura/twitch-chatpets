// @ts-check
/** @typedef {'calm'|'laughter'|'excitement'|'anger'|'confusion'} Emotion */
/** @type {readonly Emotion[]} */
export const EMOTIONS = Object.freeze(['calm', 'laughter', 'excitement', 'anger', 'confusion']);
/** Contextual, deliberately conservative EN/JA rules. Unknown is not calm.
 * @param {string} text
 * @returns {{emotion: Emotion|null, confidence:number}}
 */
export function classifyEmotion(text) {
  const value = text.normalize('NFKC').toLowerCase();
  // Keywords cover English and Japanese chat so bilingual streams classify correctly.
  // A joke marker changes the reading of e.g. "worst play lol"; punctuation/volume alone is not emotion.
  if (/\b(?:lol|lmao|rofl|kekw|lul)\b|草|[wｗ]{2,}|😂|🤣|笑った|笑う|爆笑/u.test(value)) return { emotion: 'laughter', confidence: .95 };
  if (/not (?:angry|frustrat)|怒ってない|怒っていない/u.test(value)) return { emotion: null, confidence: 0 };
  if (/ひどい|最悪|ふざけんな|むかつ|イライラ|腹立|\b(?:angry|furious|frustrat\w*|infuriat\w*)\b|this sucks|😡|🤬/u.test(value)) return { emotion: 'anger', confidence: .9 };
  if (/どういうこと|わからな|分からな|なぜ|どうして|なんで|\b(?:why|confused|confusing|huh)\b|what (?:happened|does|is this)|🤔|❓/u.test(value)) return { emotion: 'confusion', confidence: .88 };
  if (/すご|凄|やった|最高|\b(?:hype|pog|poggers|amazing|awesome)\b|let['’]?s\s+go|🔥|🎉/u.test(value)) return { emotion: 'excitement', confidence: .93 };
  if (/こんにちは|こんばんは|おはよう|まったり|いい感じ|のんびり|落ち着|おやすみ|ありがとう|\b(?:hello|hi|cozy|calm|relax\w*|peaceful|thanks)\b|good (?:morning|evening|night)|😌/u.test(value)) return { emotion: 'calm', confidence: .85 };
  return { emotion: null, confidence: 0 };
}
