# Nib — single pixel mascot

The current mood/action composition is documented in [Nib personality](PERSONALITY.md). GG, Jump, Eat and Battle now use twenty variants selected from the existing five Chat Pulse moods at safe activation boundaries. Other legacy actions and the CPU-pixel rendering safeguards below remain.

## Visual identity

One original tiny creature is the product's mascot: a large blocky head/muzzle, cream eyes, mint body, short feet, forked ears, warm scarf and stepped tail. The design uses small-game readability as a principle; it does not import, trace or bundle T-Rex Runner, Clawd, third-party character art, video or music.

`src/client/mascot-sprites.js` supplies the original 40×36 base drawing and gestures. `src/client/nib-evolution-sprites.js` composes the current six 64×56 forms from that foundation. Eleven rendered states use two to four frames: idle, notice, walk, run, jump, eat, attack, happy, sleep, hurt and evolve. See [current forms](NIB_EMOTION_EVOLUTION.md).

The five emotional evolutions change silhouette, body proportions and appendages: leaves, tall ears, wings, armor or asymmetric antennae. Each form supports the same action vocabulary. The authoritative form comes from the 60-second sentiment controller, not the legacy cozy/chaos/mystic recommendation fields.

## One-mascot architecture

`Game.creatures` keeps its array shape for API compatibility but has exactly one entry: ID 0, Nib. All accepted interactions target ID 0 and contribute XP to that mascot. `StageDirector.actors` likewise contains one actor, regardless of old event IDs or a legacy `cast=trio` URL. The cast selector is removed from the UI.

Saved `cast:'trio'` values normalize to `'solo'` during schema validation. This preserves AI settings, call timestamps, reservations, usage records and budgets. Existing Express/SSE, Twitch, demo, AI and localhost control boundaries remain in place.

## Readable action sequence

At normal pace most reactions take 2–2.6 seconds. Notice lasts about 0–210ms; chase 210–620ms; the primary interaction 620–1350ms; a short result follows; then Nib turns and runs home. There is clear anticipation and follow-through.

| Chat/cue | Action |
| --- | --- |
| Support / GG | Mood-specific praise: gentle, playful, excited, reluctantly grumpy or curious |
| Normal text / food | Mood-specific approach, consume the capsule once, and recover |
| Laughter / LOL / KEKW | Hop and play with the text |
| Hype / POG | Speed burst through the text with dust |
| Question | Approach, wide eyes and inspection |
| !jump | Jump arc over a low capsule, then land |
| Authorized !battle | Headbutt an enemy-tinted capsule with blocky horns |
| bruh / bonk | Impact, X eyes and backward recoil |
| !happy / legacy !dance | Brief celebratory bounce |
| Sleep / zzz / good night | Curl into a low critter shape; wake on new chat |
| !powerup / !evolve | Temporary visual power-up, without bypassing progression |

Sleep is interruptible and lasts up to five seconds. Quiet life has a 24-second patrol/look/nap cycle, with a nap after about eleven quiet seconds. There is no audio dependency. Old performance names map to safe actions for compatibility.

## Compact composition and text scale

The action area retains 360×224 logical coordinates in the top of a 320×380 CSS Chat Pulse widget. The current 64-pixel-wide sprite uses rounded integer device-pixel enlargement and stays inside the widget. An active conversation event expands the widget to 470px high for its answer card. Below it are five emotion bars and twelve minute buckets, using the same canvas in preview and OBS. Comments/effects are clipped above the charts. See [Chat Pulse](CHAT_PULSE.md) and [conversation](NIB_CONVERSATION.md). The director keeps at most eight notes, three queued actions, two combo labels and six impact effects. Notes expire at 6.5 seconds, stale queued work at six seconds, effects at 650ms and combo labels at 2.4 seconds. Impacts emit once, not every render frame.

`capsuleGeometry` measures actual text. Capsule width is clamped to **40–100% of displayed sprite width**. Grapheme-aware truncation preserves Japanese and emoji clusters, adds an ellipsis and changes only the visual representation. Full accepted text remains in the dashboard history and the server's safe rolling window. Text stays at least 12 CSS pixels. Category tint and stepped corners keep the capsules consistent with the sprite art.

The original 3-in-12-second mood evidence and 16-second cooldown now produce compact KEKW/POG!/BRUH/BIG W labels. Large reaction cards, stage slogans and the cast lineup have been removed.

## Rendering and OBS

Sprite masks are compiled into color-grouped horizontal pixel spans held in CPU memory. Each frame paints those spans with integer `fillRect` operations; no cached sprite canvas or GPU bitmap is reused. This avoids silently blank cached images while preserving the exact indexed-pixel artwork. Destination pixels and positions are integer device pixels, including fractional DPR such as 1.25. CSS uses `image-rendering:pixelated`; text uses local system fonts. Size changes are discrete and fit the viewport. Reduced-motion preferences reduce jumping and fast frame changes.

Paint is transactional: draw to a scratch canvas and copy a completed frame onto the visible canvas without clearing it first. A failed paint retains the prior frame and retries on the next animation callback. The next callback is scheduled before painting, so one exception cannot terminate the loop. Hidden zero-size views retain their previous bitmap; visibility/pageshow and context-restoration events refresh layout/cache. No raw chat or exception data is logged by this recovery path.

`/?overlay=1` is transparent and defaults to the lower-left corner on fresh settings. Saved positions persist. Right-corner composition mirrors only the habitat, keeping chart labels readable. Left/right and legacy center are available. OBS shows one mascot, interactive text, small effects and the integrated Pulse charts with a compact translucent chart backing; no full-viewport background or separate analytics panel is rendered.

`Overlay settings` changes animation pace (legacy `tempo` field), size, anchor, combos and patrol/naps. `PATCH /api/stage/settings` persists these under existing localhost-only controls. Preview pause is local to that browser. Demo-chat pause stops generated examples while idle life continues. Demo examples arrive every three seconds.

`/?overlay=1&preview=1` adds a checkerboard only for inspection. Use `/?overlay=1` for OBS transparency. The browser test exports `artifacts/nib-demo.webm`, with a checkerboard composited behind the app's own canvas for clarity.

## Checks and remaining polish

Tests cover single identity, old-setting migration, local cues, timing phases, jump clearance, waking, bounded work, all sprite states, distinct run frames, evolution identity, text ratio/truncation and integer pixels across DPR values. Browser checks cover actual alpha, compact corner bounds, desktop/mobile layout, reaction categories, evolution, reduced motion and zero external/API requests.

The small two-to-four-frame loops are deliberate. Additional in-between frames and further reaction timing refinement remain optional polish. Long text is deliberately abbreviated; the dashboard preserves its full accepted text. Live Twitch/model access is still separate from these mocked/offline checks.
