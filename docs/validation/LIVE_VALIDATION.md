# Live stream validation record

On 2026-10-30 to 31 (Asia/Tokyo), we connected a real Twitch channel to the local app and verified it. This is separate from the mocked traffic in the automated tests. The streamer kindly helped by posting comments and checking how things looked in OBS. No real comment text, viewer IDs or credentials are included in this record.


Raw diagnostic screenshots and temporary observer files referenced below were local-only and have been removed during publication cleanup. The following is the retained dated summary; mocked tests regenerate new artifacts. Operator-requested response review exports remain local and Git-ignored.

## Confirmed paths

| Case | Result and evidence |
| --- | --- |
| Twitch → app intake | Before the fix, a long-running connection received no posts, while an independent connection opened at the same time received the same posts. Identified insufficient connection liveness checks. |
| Real comments after the fix | New posts were received and accepted, and the same jump showed on the dashboard and the OBS screen. The streamer confirmed the jump too. |
| First conversation with the real AI | Generated a reply that followed the snack topic. About 4.4 s from app receipt to the speech SSE. The streamer confirmed the bubble appeared in OBS too. |
| Continued conversation with the real AI | A follow-up question got a reply consistent with the earlier snack conversation. About 4.2 s from app receipt to the speech SSE. |
| Question from the real AI | Generated a two-choice question from a topic that actually arrived. Reached the speech SSE in about 5.6 s; the bubble and answer window were confirmed on the OBS screen. |
| Too few answers to a question | Tallied one person's answer and skipped locally when the window closed. Shown on the OBS screen with no extra paid generation. |
| Real answers from two accounts | After a reload, answers from both accounts were received. The server computed a 2-person, 1-vote-each tie, and the real AI generated a reply reflecting the tie in about 5.8 s. Display on the OBS screen was confirmed. |
| Real votes from two accounts | Tallied 2 people with 1 vote each. The real AI's result reply was generated in about 2.6 s, with matching speech and emote on the OBS screen. |
| Extra re-vote check | While 3 more posts were received and accepted, the poll stayed at 2 people / 2 votes, and was a 1-1 tie at close. However, this did not isolate a single account, so strict exclusion of re-votes from the same stable ID is distinguished as verified by the unit and mocked browser tests. |
| API time limit | One generation for the extra check timed out at 7 s. No answer window was created and Nib returned to normal; a manual retest without changing settings generated a poll in about 2.8 s. |

The real AI used the existing setting, `gpt-6-luna`. Canvas rendering of speech confirmed matching text and emote, 0 render errors and alpha 0 outside. These are a few successful examples, not an evaluation guaranteeing latency under load or quality across a wide range of topics. The response times above are measured from app receipt, not from the post action on Twitch.

## Problems found and fixed during validation

- For the state where intake stopped while the connected indicator stayed up, we added a WebSocket Ping every 20 seconds, a 10-second Pong deadline, a 15-second join deadline and reconnection after 5 seconds. Pongs from real Twitch were confirmed; disconnect/reconnect on no response and invalidation of old sockets were confirmed in automated tests.
- Starting a question allowed the optional followup meant for ordinary conversation, so real generations couldn't create an answer window. We added a required structure and option-count constraints dedicated to questions and polls, and unified the bubble with the same question text as the answer card.
- Candidate IDs and evidence IDs mismatched during question generation. Only the IDs the app sent are now set as candidates in the output Schema, and the post-generation match check is kept. After the fix, a real question was generated and displayed successfully.
- Manually starting a poll with the same text as a question was blocked by the duplicate suppression meant for ordinary conversation. Only explicit manual questions and polls may now reuse the same question text. Duplicate suppression for auto questions and ordinary conversation, the ban on starting duplicates during an open window, the reply interval and the budget are kept. Regression tests confirm this difference.

## Limits and reruns

The $0.10 daily budget, hourly limit, 7-second timeout and no-retry policy are kept. Displayed costs are estimates from configured prices, not final billed amounts. Live AI replies and periodic analysis are separate settings; in this validation, live replies were ON and periodic analysis was OFF.

The answer window was temporarily extended to 120 seconds to allow account switching, then returned to the normal 30 seconds afterward. At the end of validation, the ledger showed 13 calls in total including failed checks, $0.025395 counted against the budget including reservations with unknown usage, and $0.074605 remaining. The actual billed amount cannot be determined from this record. Answers, votes and ties from two people, plus the real AI's result reply, are confirmed. Score averages and re-votes from the same stable ID are verified in unit and mocked browser tests.

At one point, a second post reached neither the app nor an independent receiving connection, and the streamer reported it was not visible on the first screen. The second screen showed a generic error and a poster name in the format of an anonymous connection. After the streamer reloaded, posting worked again, and intake, answers and votes from both accounts succeeded. The exact authentication or browser cause, or any AutoMod restriction, was not identified. Twitch moderation settings were not changed.

`npm test`, `npm run check`, `npm run build` and `npm run test:conversation-browser` are regression checks that never call real services. Observation JSON and images from the live stream are saved in the ignored `artifacts/twitch-route/` and are not part of the submission. Posts to real Twitch were made by the streamer; the app's ability to send chat was not used.

At the time of this live validation there were 142 automated tests. They passed, including manual reuse of the same question text and duplicate suppression for automatic events and ordinary conversation. After the operations improvements there were 144, with Windows/Linux results recorded in the [operations guide](../guides/OPERATIONS.md). The main local evidence is `question-two-users-counts.json`, `ai-question-two-users-result.json`, `poll-two-users-counts.json`, `ai-poll-two-users-result.json`, `poll-duplicate-counts.json`, `ai-poll-duplicate-result.json` and `final-state.json`.

## Optional extra live tests

After the 2026-10-31 minute-AI update, 7 posts from one account within the same window were received from real Twitch, and the generative AI judged them Hype 65% / Calm 35%. The transformation into Blaze Nib and the AI score display were confirmed on both the dashboard and the OBS screen. In the following window with no posts, Nib returned to Base Nib with no extra AI call, with 0 render errors and alpha 0 outside. There was 1 paid emotion-analysis call, taking the total from 14 to 15. We also recorded that the first group of posts was split 1 / 4 across a minute boundary and no call was made. No individual text or IDs are published; local evidence is saved in `artifacts/minute-live/`.

No required items remain that block validation of the main paths. To further strengthen the submission video, candidates are a continuous 30-60 minute live stream and a re-vote test with no posts from other accounts mixed in. Evolution by the 60-second emotion AI from a single person and the return when there are no posts are confirmed live as described above. The related time-based, evolution and stable-ID handling is also verified in automated tests.

## Visual-joke setup (2026-10-31)

Twitch Client Credentials authentication and the channel lookup succeeded using credentials entered locally by the operator. Get Streams returned no active stream, so this check did not obtain a frame or call OpenAI. Mocked ten-minute jobs produced the same joke/emote in dashboard and OBS overlay, verified privacy/limits/offline skips, and kept transparent pixels. These mocked checks do not establish real visual-joke quality or screenshot latency. See [setup and behavior](../design/STREAM_JOKES.md).

## Real visual joke verified (2026-10-31)

With the channel live, the production TwitchFrame implementation retrieved a 512×288 JPEG (37,118 bytes in the initial diagnostic capture). The next unmodified 600-second scheduler collected the operator’s three accepted comments, obtained a stream frame and sent one real multimodal OpenAI request with all three safe comment samples. The server produced a joke linking the chat’s confusion with the visible game disconnect screen; it used the laugh emote and base form. From scheduled check to speech took about 4.9 seconds in this one example.

The dashboard and transparent OBS overlay page received the same speech ID/text and matching laugh animation, with positive sprite pixels, zero frame/page errors and transparent outside pixels. The ledger increased from 15 to 16 requests (one stream_joke), recording an estimated $0.001456 for this call under the existing configured rates; budget/cap settings were unchanged. This is one bounded success, not a latency or joke-quality benchmark. Evidence is local/Git-ignored under artifacts/stream-jokes-live/.

Computer Use confirmed OBS was streaming and refreshed only the existing Nib browser source from its old LOCAL display to the current AI/60s display. The operator then pressed physical Escape, stopping Computer Use; no further native-UI actions were made. Therefore the speaking-frame screenshots prove the OBS overlay page, while the exact bubble’s appearance inside the running OBS native preview was not captured.

## Visual-question and history deployment (2026-10-31)

Deployed selected screen-question preview input and six-hour local response retention to the same host-data container. Preserved environment, all 115 earlier usage records, AI/conversation/stage settings and relationship salt. Current in-memory logs were empty after the preceding restart; imported the operator-reviewed earlier 20 English records, marked legacy_import, with original IDs/text/source/timestamps unchanged and within the six-hour window. The full local endpoint returned all 20 and the new retention summary. Import/deployment made zero OpenAI calls.

All 184 unit/HTTP tests, production checks/build and container smoke passed; all six Windows browser suites passed with mocked providers (visual question/history, stream jokes, minute sentiment, conversation, evolution, visibility). No new six-suite Linux browser run was made. A real server-side high-resolution Twitch capture probe authenticated and reported stream_offline, so new on-demand visual answer accuracy remains unverified against a live stream. Existing API caps remain disabled and speech display remains ten seconds.
