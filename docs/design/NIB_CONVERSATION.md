# Nib two-way communication

Nib's event-driven conversation is independent of the minute emotion AI. Live emotion judgment batches each minute of posts (5+ from 1+ viewer) and sends them to the AI; with fewer than 5, Nib returns to the base form. The conversation AI and emotion AI have separate switches but share the cost ledger, the 20-calls-per-hour limit, the $0.10 daily budget and the concurrent-call slot. [Emotion judgment details](CHAT_PULSE.md).

## Try it locally

1. `npm start` → <http://127.0.0.1:3000/#conversation-panel>. Open "Talk with Nib".
2. As Viewer A, send "Nib, did you eat all the snacks?". Once the normal comment action finishes, Nib's reply and emote start together.
3. Click "Reply". Nib receives `!answer Let's split them half and half!` and replies to that content. Send another comment as the same Viewer A and the conversation continues, including Nib's actual previous line.
4. After the bubble finishes, click "Ask about topic". The demo asks for an energy score tied to the topic. Send 30 as A and 100 as B, then click "Close & tally". Nib's reply uses the average of 65.
5. Click "Poll about topic" → vote 1 as A and 2 as B. If A votes again for 2, only the first vote counts. At the deadline, or with the close button, the result and tie detection are shown.
6. Evolve Nib with the Chat Pulse demo on the right and send the same comment again to see how form, speaking style and emote differ.

The demo uses **context-bound local sample replies**. It is not a substitute for evaluating generative AI quality; it verifies conversation, polls, display and state handling. It calls neither the SDK nor Twitch. The demo waits at least 3 seconds, and holds the next line until the current speech and motion finish.

The OBS Browser Source is still `http://127.0.0.1:3000/?overlay=1`. No admin panels appear. Only Nib, speech bubbles, the answer-window card and Chat Pulse are shown, and everything around them is transparent. While an answer card is up, the widget grows from about 380 to 470 px tall. Small sources scale the whole thing down.

## Live AI

Keep your existing `.env`, set `DEMO_MODE=false` and a Twitch channel, then start. In "Conversation settings", explicitly turn on "Live AI replies (paid)". It is independent of the periodic analysis AI switch. The key is read only on the server and never sent to the browser.

- Live AI replies default to OFF. Paid AI cannot be turned on in demo mode.
- Each incoming message gets a lightweight candidate check. Direct questions, replies to Nib's previous line and answers to a running question take priority; GG/www alone never calls the reply AI. Existing instant reactions run first.
- 18-second minimum interval (configurable 15-300 s), 30-second candidate lifetime, 7-second timeout, no retries. One reply in flight at a time; the concurrency limit shared with periodic analysis defaults to 1. Caps of 12 reply candidates, 80 recent observations and 500 processed sequence numbers apply.
- AI generation plus display after the normal action aims for a reaction within a few seconds, but API latency, the reply interval, the current motion and budget/hourly limits can cause waiting or discards. 3-5 seconds is not guaranteed.
- Uses **the same ledger, daily budget and hourly limit** as periodic AI analysis. The cost of the worst-case input and the output cap is reserved up front. Unknown usage and timeouts keep the reservation, a conservative calculation. The default hourly limit of 20 and daily budget of $0.10 may take effect before the short reply interval does.
- Keeps the existing model settings. Requires a strict JSON Schema via `text.format` in the Responses API, and validates again with Zod after receipt. Uses `should_reply / candidate_id / reply / animation / evidence_ids / followup`; output whose candidate or evidence IDs don't match is not used. Unknown motions fall back to a safe head tilt.
- Nib always replies in English, even to chat in other languages; Japanese chat is still understood and moderated.

Official spec checked during implementation: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Prices are estimates from the existing environment settings, not current official prices.

## Personality, display and conflicts

Base Nib is curious, Bloom is gentle, Giggle teases lightly, Blaze is fired up, Bulwark is a comically grumpy tsundere, and Astral asks quirky questions. The current form is passed in the generation instructions. Insulting viewers, pretending to see live video and inventing memories are forbidden. Selected screen-dependent questions can use a delayed Twitch still; [visual questions and review history](VISUAL_QUESTIONS_AND_HISTORY.md) describes the limits.

The live instruction prompt separates Nib from the streamer, in-game avatar and viewers: praise for a round or costume is not automatically praise for Nib. Ordinary questions get a direct supported answer first; missing details prompt one specific clarification instead of echoing the question or adding a vague metaphor. Reactions and jokes aim for 5–12 English words, while useful factual answers/event questions may be longer within the existing schema. Humor is situational; game words such as bean/gravity/chaos are optional rather than recurring templates, and emotes are not explained back to chat.

For variety, both ordinary and screenshot-joke prompts receive `recent_nib_lines`: at most five Nib texts from current short-term memory, oldest first. They are untrusted style history, not proof of gameplay. Memory OFF supplies an empty list; disconnect/deletion clears this AI memory. The separate six-hour archive is not fed wholesale to the model. Joke examples are included only while jokes are enabled, and are labelled stylistic examples rather than facts or mandatory phrases. Existing personalities, event contracts, privacy, evidence validation and delayed-image limitations remain in force. These instructions guide a probabilistic model; they do not guarantee zero repetition. See [OpenAI prompting guidance](https://developers.openai.com/api/docs/guides/prompt-engineering).

Replies can be configured for 4–20 seconds (new-install default five; current streaming instance ten), and the emote plays for about 1.1 seconds from the same render frame. Nib waits until the main action for an existing comment finishes, and pauses the normal action clock only during the emote. After that, normal actions continue even while the bubble is still up. One line is shown, with at most 3 waiting. While waiting on the API, Nib shows "…" and a head tilt when idle. On failure or expiry it naturally returns to normal.

Evolution takes priority: lines for the new form are shown after it lands. Lines and replies for the old form are discarded. Speech IDs prevent duplicate display even when SSE is re-received. Stream disconnects, settings changes and deletions abort in-flight requests, and a generation number also invalidates late responses.

## Questions and polls

Even when started manually, no question is created without a recent safe comment. Auto questions and auto polls default to OFF. The default interval is 7 minutes, and a topic is a candidate only with at least 3 recent messages from 2 people. Frequency, answer window and minimum participants are configurable in the panel.

- Questions can be choice, a 0-100 score or free answer. Use `!answer ...`; for scores, `30!` or `30 pts` also works. A personal question in a direct conversation continues as soon as one answer arrives. Group questions collect until the deadline.
- Custom polls use `!vote 1` through `!vote 3`. Official Twitch polls are never created or changed.
- Default 30 seconds, minimum 2 people. Only the first answer per stable ID counts. Up to 500 people; out-of-range values are not counted. Votes, averages and ties are computed on the server. When too few people take part, Nib skips locally and never invents a winner or answers.
- Results feed into the next line, emote and short-term memory. The factual result leads the line. **Poll results never force an evolution form.** Each minute's chat emotion is the basis for evolution.

## Memory, familiarity and deletion

Short-term memory defaults to 10 minutes and 120 entries, with at most 3,500 characters of text passed to the AI. It records actual viewer messages, Nib's lines, tally results and form changes, tagged with evidence IDs and anonymous speakers. The direct reply target is the ID of Nib's actual line with the same viewer. There is no live video or audio input. Selected questions can receive one delayed image. With memory OFF, past conversation is not passed to the model. Short-term memory clears on disconnect or stop; separate six-hour review logs persist locally across restart and clear on privacy deletion.

Familiarity hashes Twitch's stable user-id with SHA256 through the existing path, then stores it as an HMAC with the channel plus a local salt. Changing a display name does not make someone a different person. The persistent file `data/relationships.json` stores only hashes, points, expiry and rate-cap timestamps — no raw IDs, display names or message text.

Lv0→1 at 3 pt, Lv2 at 8 pt, Lv3 at 16 pt. Accepted conversations, follow-ups, answers and votes count; raw post count does not. Each kind counts once per 60 seconds, up to 4 pt/hour and 12 pt/day. Expires after 30 days by default (1-90 days). OFF stops both point awards and familiarity-based replies. Point awards stop on storage errors.

Viewers' own `!nib optout` / `!nib forget` delete their familiarity and stop recording. `!nib optin` resumes it. In the admin panel, delete via a profile button or by Twitch numeric user-id (not display name). Deletion clears short-term memory and the reply log so no shared context or quotes remain, and removes answers too. A minimal opt-out hash is kept to prevent re-collection. Demo internal IDs look like `conversation-alice`, but the panel's profile delete button needs no input.

Chat is never treated as commands, and the AI has no authority to change settings, tallies or familiarity. Unsafe words, secrets, sensitive personal information and some instruction attacks are filtered from input in advance, and output is checked too. These checks are limited rules plus model instructions, not a system that can judge every expression perfectly. The streamer's `BLOCKED_TERMS` apply on both sides.

`.env`, `data/` and validation images are in `.gitignore`. The existing .env is never changed, and keys or real comments never appear in docs or test material.

## Changed files and validation

| Location | Role |
|---|---|
| `src/server/conversation.js` | Candidates, short-term memory, conversation, questions, polls, conflicts |
| `src/server/conversation-ai.js` | Per-form generation instructions, Responses schema, safety checks, cost reservation |
| `src/server/conversation-settings.js` | Validated persistent settings, defaults filled in for existing data |
| `src/server/relationships.js` | Anonymous familiarity, rate caps, deletion, expiry |
| `src/server/ai-lease.js`, `src/server/ai.js`, `src/server/store.js` | Shared budget and concurrency for periodic analysis and replies |
| `src/server/app.js` | Twitch intake, SSE, local admin API, shutdown |
| `src/client/conversation-panel.js` | Controls, settings and logs added to the existing panel |
| `src/client/conversation-view.js`, `src/client/stage.js` | Speech, emotes and answer cards on the shared Canvas |

Validate with `npm test`, `npm run check`, `npm run build` and `npm run test:conversation-browser`. Dedicated unit and HTTP tests cover conversation round trips, every form's speaking style, context, averages, ties and duplicate votes, memory expiry and OFF, familiarity, name changes, deletion and expiry, a 1,000-message burst, the shared budget, API failures, timeouts and stale replies, and existing evolution.

Browser tests use the production build and check conversation from the real buttons, the average of 65, custom polls, the same line on the dashboard and OBS, alpha transparency, waiting during evolution, spam bursts and mobile widths. Images and records go to `artifacts/conversation/`. All APIs are mocked, with zero billed calls. This offline validation does not check real Twitch intake or the quality and latency of real model generation.

For the submission cleanup we removed tests dedicated to unused characters and old validation images. Current regression tests for conversation, evolution and rendering are kept and can be rerun with the commands above. On 2026-10-30 to 31 we separately confirmed real Twitch intake, jumping, continued conversation with a real model, and question answers, voting and result replies across two accounts, and the streamer saw the bubbles in OBS. Questions and polls gained a dedicated required-followup Schema and output constraints on candidate and evidence IDs. Manual events can reuse the same question text, while duplicate suppression for automatic events and ordinary conversation is kept. See [Startup, CI and Docker](../guides/OPERATIONS.md) for the 144 automated tests at the time and environment validation, and the [live stream validation record](../validation/LIVE_VALIDATION.md) for scope and time limits on the real services.
