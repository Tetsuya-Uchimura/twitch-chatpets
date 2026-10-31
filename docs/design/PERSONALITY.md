# Nib personality and interaction variants — 2026-10-28

## 1. Changed files

- Added `src/shared/action-variants.js`: typed central resolver and twenty immutable variants.
- Added `src/client/action-motion.js`: shared deterministic movement primitives and a five-phase pose evaluator.
- Updated `src/client/stage-model.js`: activation-time variant selection, priority/aging/coalescing, consumption/cleanup and safe cancellation.
- Updated `src/client/mascot-sprites.js` and `src/client/stage.js`: stepped head tilts, crossed paws, soft smile, independently timed tail wags, mood effects and variant diagnostics. CPU pixel spans, retained frames and context recovery are preserved.
- Updated `src/server/chat.js`, `src/server/game.js`, `src/server/app.js`: intent metadata through the existing accepted-message path, plus demo-only practice/reset routes. Rewards, evolution thresholds, Twitch authorization and normal battle cooldown remain unchanged.
- Updated dashboard `src/client/app.js`, `src/client/index.html`, `src/client/style.css` and the chart's demo-test badge in `src/client/pulse-view.js`.
- Added `tests/unit/personality.test.js` and `tests/browser/personality.mjs`; updated calm walk/jump expectations in `tests/unit/stage.test.js`.
- Updated `tsconfig.json`, package scripts, build entry version and existing hackathon/session documentation. No new dependency, API call or paid service was added. Existing `.env`, key, AI module, pricing configuration and budget ledger were not edited by this work.

## 2. Resolver and composition

`Reaction = resolveActionVariant(current Chat Pulse emotion, chat action intent)`.

The mood type reuses Chat Pulse's existing `Emotion` type: `calm`, `laughter`, `excitement`, `anger`, `confusion`. There is no new sentiment controller. Intent is separate metadata: `praise`, `jump`, `eat`, `battle`. Server classification preserves existing performance strings for compatibility, so `GG` can still have legacy `performance:'eat'` while its new `intent:'praise'` selects a celebration rather than a bite. Explicit food commands remain eating even if they also contain GG. Other legacy actions—play, dash, inspect, sleep, recoil, power-up and happy—remain available.

The resolver returns an immutable variant containing anticipation/approach/main/recovery primitives, speed/jump multipliers, effect type, phase timings and priority. The director resolves it **once when an action starts**, not on every frame or when first queued. Pending live actions therefore use the mood active at their eventual safe boundary. Local demo practices carry their explicitly selected test mood.

One shared evaluator handles all twenty variants using notice → approach → interaction → recovery → return. Reusable primitives include eased walking, abrupt dash, one/two jump arcs, bounce, stomp, head tilt, inspecting pause, headbutt, bite/nibble, turn-away, soft smile, paw crossing and tail wag. The original animator remains for unrelated legacy actions. At normal pace the new sequences take roughly 1.6–2.9 seconds; the existing pace slider scales their duration.

Sprite gestures are authored as indexed pixels. Head tilt is a stepped pixel shear, never bitmap rotation/interpolation. Tail timing can change without changing face/foot frames. The original green body, eyes, scarf, tail and evolution accents remain recognizable. Effects stay clipped above the integrated charts. Reduced-motion preferences continue reducing jumps and effects.

## 3. Mood/action matrix

| Mood | GG / praise | Jump | Text / eat | Battle |
| --- | --- | --- | --- | --- |
| Calm | Soft smile, small bounce, slow wag | Gentle single arc and soft landing | Walk, gentle bite, satisfied smile | Controlled approach/headbutt |
| Laughter | Double bounce, laughing eyes, fast wag | Two arcs with sideways bounce | Bounce in, playful bite, double bounce out | Bouncing approach/attack |
| Hype (`excitement`) | High celebration, quick recovery, sparkles | Quick dash, highest arc, landing dust | Dash, strong bite, excited bounce/sparks | Fast charge, stronger impact |
| Anger | Pause, turn away, crossed paws/stomp, reluctant small wag; grumpy face stays | Stomp, abrupt dash, forceful jump/hard landing | Impatient dash, strong bite, grumpy chewing | Strong headbutt and stomp dust |
| Confusion | Tilt, thinking approach, tentative smile/hop | Hesitation, diagonal arc, clumsy landing | Slow inspection/tilt, careful nibble | Hesitant, awkward approach/landing |

These are motion differences, not just palette swaps. Green identity and the previous cyan/orange/red/purple accents remain. Battle affects a toy text block; there are no additional characters or violent visuals.

## 4. Coordination and gameplay invariants

Active eating, attack and collision cleanup are never preempted by new chat or a mood change. Sleep retains its existing wake-on-chat behavior. A variant's duration, mood and parameters remain fixed until completion; the new desired mood is adopted at the next safe boundary.

Only three actions wait. Battle has higher scheduling priority than ordinary chat, but the oldest waiting action is protected during coalescing. An action aged 2.5 seconds or a two-battle streak takes precedence over another battle. Six-second stale entries are cancelled; replaced/cancelled entries remove their text. This gives queued work a bounded lifetime and prevents a flood from endlessly replacing the oldest ordinary action. Idle is entered after finite queued work drains/expires; mood-specific ambient motion can still play in that idle state.

Queued cancellation is immediate. Cancellation of an active action is deferred until its normal cleanup boundary. A session reset clears the visual director. Returning from manual demo mood invalidates older queued practices using a generation number, while the current action finishes.

Each bite has one deterministic contact point: mark consumed, remove the note, emit at most one effect. Finishing an action also performs missing cleanup if a hidden tab skipped its entire middle phase. Repeated render frames never award XP or repeat consumption. The server still awards one XP per **accepted message**, as before, independently of animation coalescing. Evolution evidence and cooldowns are unchanged. A bounded completion log is diagnostic only and does not change server progression.

## 5. Testing all twenty combinations

1. Start in `DEMO_MODE=true` and open `http://127.0.0.1:3000/`; reload an existing page to load the versioned modules.
2. In **Reaction lab**, select Calm / Laughter / Hype / Anger / Confusion and GG / Jump / Eat / Battle.
3. Click **Play reaction**. Repeat each action for all five moods. Automatic demo chat pauses so the result is easy to compare.
4. Compare GG in Calm and Anger, then Jump in Hype and Confusion. The integrated chart header says `DEMO TEST`; its measured distribution is not overwritten to match the manual choice.
5. Click **Use Chat Pulse mood** to return at the next safe boundary. Choosing a historical Chat Pulse scenario or resuming autoplay also clears the manual mood.

The practice Battle button uses a sanitized local training block rather than issuing a live battle command. This allows all five Battle variants to be tested without modifying the normal command's authorization or 30-second cooldown. Practices still use message filtering, accepted-message accounting, one XP and existing action cleanup. Rapid input is still bounded/rate-limited. `/api/demo/interaction` and `/api/demo/interaction/reset` reject live mode, invalid values and cross-origin control; the UI is hidden in live mode. The live mood always comes from the existing Chat Pulse system.

No animation resolver calls OpenAI. Demo with a key and enabled flag creates zero SDK instances, AI analysis jobs, health checks or paid requests. Chat Pulse still aggregates at 60 seconds and the existing optional live AI configuration remains unchanged. Manual testing does not invent sentiment percentages.

## 6. Verification

Run `npm test`, `npm run check`, `npm run build` and `npm run test:personality-browser`. Current tests cover twenty combinations in both preview and OBS, consumption/cleanup, queues, XP, chart history, transparency, demo reset and narrow sources. These automated checks use local servers and mocked external services.

Obsolete character studies and their dedicated tests have been removed. The current motion, sentiment, evolution and conversation regressions remain. Test images are regenerable under ignored `artifacts/`.

## 7. Limits

Intent detection is rule-based. Some visual work is coalesced under heavy chat while every accepted message keeps its server reward. Live Twitch reception, a viewer-triggered jump, two contextual real-model replies and a generated question were separately confirmed on 2026-10-30; the operator also confirmed a reply bubble in OBS. These bounded examples do not establish quality across every personality. See [live validation](../validation/LIVE_VALIDATION.md) for evidence and remaining limits.

See [Chat Pulse](CHAT_PULSE.md), [current forms](NIB_EMOTION_EVOLUTION.md), [submission](../SUBMISSION.md) and [Codex session history](../CODEX_SESSIONS.md).
