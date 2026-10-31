export const SCENARIOS = Object.freeze({
  calm: { label: 'Calm Chat', texts: ['hello chat!', 'so cozy tonight', 'nice and relaxed', 'hello cozy chat', 'so peaceful 😌', 'thanks for the stream'] },
  laughter: { label: 'Laughter Surge', texts: ['LOL 😂', 'worst play ever lol', 'LUL', 'LMAO', 'I am dying 🤣', 'kekw 🤣'] },
  excitement: { label: 'Hype Explosion', texts: ['amazing!', 'awesome play!', "LET’S GO", 'HYPE 🔥', 'Pog!', 'poggers 🎉'] },
  anger: { label: 'Angry Chat', texts: ['this sucks', 'so frustrating', 'I am furious', 'This is frustrating', 'so angry 😡', 'infuriating 🤬'] },
  confusion: { label: 'Confused Chat', texts: ['what happened?', 'so confusing', 'Why?', "I'm confused", 'why though?', 'huh 🤔'] },
  spike: { label: 'Activity Spike · calm', texts: ['hello', 'so calm', 'nice and relaxed', 'calm chat', 'cozy 😌', 'hi chat'] },
});
// Timestamps drive the same sanitization, rate limits and accepted-message path as manual demo chat.
export function replayScenario({ scenario, end, receive, setTime, chat, pulse }) {
  const selected = SCENARIOS[scenario];
  const current = Math.floor(end / 60000) * 60000, start = current - 11 * 60000;
  chat.clearDemoWindow(); pulse.beginDemo(start, selected.label);
  const pattern = scenario === 'spike' ? [12, 10, 14, 11, 180, 13, 9, 15, 12, 10, 14, 12] : [10, 14, 12, 24, 16, 8, 18, 30, 22, 14, 26, 18];
  let accepted = 0;
  try {
    for (let i = 0; i < 12; i++) {
      const minute = start + i * 60000;
      const duration = Math.max(0, Math.min(59999, end - minute));
      for (let j = 0; j < pattern[i]; j++) {
        const at = minute + Math.floor(duration * (j + 1) / (pattern[i] + 1));
        setTime(at); pulse.tick(at);
        // Background variety makes the percentage chart a distribution, not five identical presets.
        const texts = j % 7 === 6 ? SCENARIOS.calm.texts : selected.texts;
        const text = `${texts[j % texts.length]} · ${i + 1}/${j + 1}`;
        if (receive({ text, userId: `scenario-${i}-${j}`, authorized: false }, { historical: true })) accepted++;
      }
    }
  } finally { setTime(null); }
  pulse.completeDemo(end);
  return { scenario, label: selected.label, accepted, simulated: true };
}
