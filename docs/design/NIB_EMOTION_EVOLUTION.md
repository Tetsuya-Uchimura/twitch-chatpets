# Nib's emotion evolution

[Main screen](http://127.0.0.1:3000/) / [Compare the six forms and motions](http://127.0.0.1:3000/nib-lab/) / [Comparison image](http://127.0.0.1:3000/nib-lab/comparison.png).

The production character is a single Nib. Even if saved settings for old characters remain, only Nib is shown. For the submission cleanup we removed the assets, comparison pages and dedicated validation code for unused characters. The development history and real session IDs are kept in CODEX_SESSIONS.md.

On evolution, a roughly 3.2-second "wind up → light → silhouette change → reveal → landing" sequence plays. [Sequence spec and validation](EVOLUTION_SEQUENCE.md) / [Try an evolution](http://127.0.0.1:3000/nib-lab/evolve.html).

## The six forms

| Form | Trigger | Body and motion |
| --- | --- | --- |
| Base Nib | Initial state / not yet judged | The original Nib. Big eyes, mouth, short legs, stepped tail |
| Bloom Nib | Calm | Wide, round body, leaf crown and shell, gentle patrolling, breathing and naps |
| Giggle Nib | Laughter | Tall body, long ears and big feet, bouncy legs and big laughs |
| Blaze Nib | Hype / Excitement | Wings on both sides, flame crown and tail, flapping and fast moves |
| Bulwark Nib | Angry | Broad body, horns, shoulder armor, big fists and feet, stomping and powerful reactions |
| Astral Nib | Confused | Small, warped body, asymmetric antennae and swirling tail, exploratory gestures |

It's not just color and expression: the outline, body proportions and accessories all change. Every form supports the existing 11 actions, including idle, walk, run, eat, jump, attack, sleep, recoil and evolve. Reactions to comments still happen instantly and are handled separately from form evolution.

The art is original, editable pixel shapes in `src/client/nib-evolution-sprites.js`. Each form is drawn in a shared 64×56 px area, based on the existing Nib's eyes, mouth, ears and tail. No image generation APIs, external images or music are used. The comparison image is also exported from the actual renderer. CPU pixel-span rendering is kept, along with holding the previous frame and recovering when rendering fails.

## Minute-by-minute emotion analysis and evolution

1. Accepted posts are batched every 60 seconds. Posts that keywords can't classify are still counted.
2. Minutes with 5+ messages from 1+ viewer send one batch to the generative AI, which returns five context-aware emotion scores. The bars show these AI scores too.
3. Minutes with fewer than 5 messages don't call the AI and return Nib to Base Nib.
4. The emotion with the highest AI score maps one-to-one to an evolution form. Double evolution for the same window and the same form is avoided, and the old confidence / 40%-dominance conditions no longer reject results.
5. If Nib is mid-meal or mid-attack, it transforms after the current reaction ends. It can transform at that boundary even when the next comment is waiting.

Nib starts as Base Nib. With 5+ messages but AI OFF, a limit reached or a failure, the previous form is kept and the reason is shown. If the next minute has fewer than 5 messages, Nib returns to the base form. When time jumps due to network issues or a hidden tab, only the current window is judged; no burst of evolutions for the missed minutes is created.

`src/server/pulse.js` decides whether a window can be judged, and `src/server/evolution.js` manages evolution. The snapshot's `evolution` carries the current form, name, emotion, revision, time, reason and recent history. The old AI's cozy / chaos / mystic recommendations and instant comment counts never override this form. The old `game.creatures[].type` is kept for compatibility; the source of truth for the displayed form is `evolution.form`.

Live minute judgment is **the generative AI batch in `src/server/minute-sentiment.js`**. To stay within the shared 20 calls per hour and the $0.10 daily budget, judgment stops once the limit is reached. The demo keeps to local samples and classification with 0 API calls. See [Chat Pulse](CHAT_PULSE.md) for input limits, privacy and failure details.

## Demo controls

Use the existing Calm Chat / Laughter Surge / Hype Explosion / Angry Chat / Confused Chat to see each evolution. The demo replays history, so it judges without waiting a minute. Charts and the screen are marked as demo, and the automatic chat is paused.

Activity Spike is **a message-volume-only test**, not a sixth emotion. A flood of calm posts never fabricates hype. The six forms are Base Nib plus the five emotions.

Mood / Action in the Reaction lab are temporary previews for testing motion. The form display is labeled "motion test", and measured values and the server's evolution history are never overwritten. "Use Chat Pulse mood" returns to the form from the minute judgment. The six-form comparison page, including Base Nib, lets you switch through every action side by side.

## Validation

`npm test` verifies minute judgment, the five emotions, keeping the form on weak evidence, ties and empty windows, Activity Spike, outline differences between the six forms, CPU pixel matching for every action, and that old AI recommendations never override the form.

`npm run check`, `npm run build` and `npm run test:evolution-browser` check types, syntax and production display. The browser tests verify the 60-second boundary, waiting for a reaction to finish before evolving, the five emotion demos, transparency, recovery, mobile, the six-form comparison, and that retired comparison pages are no longer served.

The extra evolution sequence can be checked with `test:evolution-sequence`, motion with `test:personality-browser`, and tallies with `test:pulse-browser`. Validation images and traces are regenerated into the Git-ignored `artifacts/`.
