# Nib's evolution motion: 2026-10-29

[Main screen](http://127.0.0.1:3000/) / [Pick before/after forms and replay](http://127.0.0.1:3000/nib-lab/evolve.html) / [Video recorded from the actual renderer](http://127.0.0.1:3000/nib-lab/evolution.webm). The preview pages never change stream emotions, evolution history or comment counts.

The previous "switch instantly to the new form → show stars" was replaced with a continuous sequence of about 3.2 seconds that morphs the old form into the new one.

| Time | Phase | Effect |
| --- | --- | --- |
| 0-0.65 s | Anticipation | In the old form, Nib bends its knees and pulls its arms in to build up power |
| 0.65-1.40 s | Charge | Double rings, particles of light gathering inward, the body gradually glowing |
| 1.40-2.15 s | Transform | The glowing old silhouette is replaced pixel by pixel with the next form |
| 2.15-2.65 s | Reveal | The new form's colors appear and the name of the new form is shown |
| 2.65-3.20 s | Landing | Knees absorb the impact, with ripples and afterglow spreading underfoot |

The body keeps visible pixels throughout the transformation; it does not simply cross-fade the old and new forms by opacity. An outline stays on the silhouette so the glowing body never vanishes against a bright background. Effects stay inside the play area, and everything outside it in OBS stays transparent.

## Handling comments and time

- The sequence starts after any in-progress meal, attack and so on completes. Even if the next comment is already waiting, evolution is inserted at that boundary.
- Comments that arrive during the sequence are held in the existing queue of up to 3 and processed afterward. This keeps the sequence's duration from advancing only comment expiry, eating and the queue.
- Server tallies, the minute emotion analysis and the budget clock never stop. Only the front end's reaction playback clock pauses.
- New judgments that keep arriving never restart the current sequence. Any switch needed afterward is collapsed into the latest one.
- A judgment for the same form never retriggers the sequence. Even after a long hidden period, past sequences are not replayed in bulk.
- Pausing the preview affects only that screen; OBS and the server keep running. On resume, the sequence continues from where it was.
- With the OS reduced-motion setting, the sequence shortens to about 2 seconds with less floating, spinning and particles. The order from old form to new form and the evolution name are kept.

`src/client/evolution-sequence.js` manages phases and switching, and `src/client/evolution-effects.js` draws the CPU pixel-span morphing and effects. `src/client/stage.js` connects them to the same renderer used by the main screen, OBS and the preview pages. No image APIs, external assets or new audio are used.

## Validation

- `npm test`: verifies phases and switch timing, keeping the pre-evolution form, collapsing consecutive judgments, hidden time, reduced motion, visibility and exact end colors for all 36 morph pairs, and preserving reactions and the queue.
- `npm run check` / `npm run build`: syntax, types for the target modules, and a successful production build.
- `npm run test:evolution-browser`: with the updated sequence timing, checks minute evolution, the five emotions, waiting for reactions to end, OBS sync, narrow widths, transparency and recovery.
- `node tests/browser/evolution-sequence.mjs`: checks the five phases in the preview and OBS. Verifies that a meal and a jump accepted during evolution complete after the sequence, pausing, collapsing to the latest judgment, context recovery, reduced motion and mobile. Re-decodes the recorded video to check real frames. 0 external/API calls.

Recording: `src/client/nib-lab/evolution.webm`. Per-phase check images and traces: `artifacts/evolution-sequence/` (Git-ignored).
