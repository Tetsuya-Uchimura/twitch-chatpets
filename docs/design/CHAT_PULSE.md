# Chat Pulse — minute AI sentiment

Live Twitch chat is judged as one contextual batch every 60 seconds. Five accepted comments from one or more viewers qualify, including text such as GG that has no local keyword classification. Fewer than five comments return Nib to its base form without calling AI.

## Live pipeline

1. Twitch comments pass the existing normalization, safety, duplicate and rate filters. Accepted messages drive immediate local actions and actual activity counts.
2. `MinuteSentiment` retains a bounded, ephemeral buffer of safe text. At each completed 60-second boundary it snapshots that minute, rather than calling once per comment.
3. With at least five accepted messages and one participant, enabled live analysis sends one batch to the configured `gpt-6-luna` Responses API. No user IDs or display names are included. Private topics, known secrets, opted-out content and privacy commands are excluded.
4. Strict structured output contains the application-owned window ID, five integer sentiment scores and a short reason. Positive scores are normalized to proportions; the highest score selects Calm, Laugh, Hype, Angry or Confused. The previous keyword-confidence, 40% dominance and two-viewer gates do not veto a live AI result.
5. Scores update the bars and the selected form uses the existing safe-boundary, 3.2-second evolution animation. A new result for the same form does not manufacture a different emotion or replay an identical evolution.
6. A later minute with fewer than five accepted comments clears scores and returns Nib to base, including minutes with zero comments. It does not spend an AI call.

The timer stays aligned with the minute boundary after inference, so API latency is not added to every subsequent period. Late outputs, replaced windows, disconnects, settings cancellation and privacy deletion invalidate pending results. A failed response cannot overwrite a later low-activity reset. There is no catch-up burst after a long pause.

## Scores and counts

Live bars are labelled **AI · 60s**. They are model assessments of the batch, not measured viewer feelings or exact counts of emotional messages. Local keyword counts remain diagnostic fields; they do not determine live bars or forms. The widget shows incoming-message progress before the next batch and the status while AI is reading it.

The twelve activity buckets remain actual accepted-message counts in UTC-aligned minutes, with the newest minute marked partial. They share a logarithmic scale. Unknown keyword text still counts toward activity and the five-message live threshold. Viewers excluded by spam/safety filtering do not inflate accepted counts.

## Limits and failure behavior

- The existing model/key and configured input/output prices are preserved. Model output is capped at 250 tokens, input at 100 texts / 8000 text characters by default; larger batches are bounded samples with explicit total/sample sizes.
- Analysis and conversation share the cost ledger, worst-case reservations, concurrency lease and rolling hourly cap. The operator selected **20 calls/hour** and **$0.10/day**; this is not enough for 60 analyses plus replies every hour. The minute is still measured, but paid analysis stops at a limit, and the status explains why.
- A later operator testing override sets `OPENAI_MAX_CALLS_PER_HOUR=0`: no hourly cap for any AI purpose, while the daily budget and concurrency remain active. The default configuration still uses 20/hour. The dashboard labels zero as “no hourly call limit”.
- Disabled analysis, a missing key, budget/hourly limits, busy AI, timeout or invalid output do not silently fall back to keyword evolution. The previous form remains when five or more messages could not be judged. A later minute below five still resets it to base.
- Requests have no automatic retry or model fallback. Timeout/unknown usage retains the reservation conservatively. Recorded costs are configured estimates rather than invoice totals.
- Chat text is untrusted. The model has no permission to change identities, counts, settings, votes or budgets. Rule filters and model instructions are limited safeguards, not comprehensive moderation.

The analysis toggle controls minute sentiment independently of the paid conversation toggle. Live interval is fixed at 60 seconds; `CHAT_PULSE_MIN_MESSAGES=5` and `CHAT_PULSE_MIN_USERS=1` are the active defaults. Keep the ledger when restarting.

## Offline demo and rendering

`DEMO_MODE=true` never opens Twitch, constructs a real AI client or calls a paid API. The labelled mood demos use local rules and synthetic accepted-message history, with **DEMO** or **LOCAL** markings. They demonstrate animation and state handling, not generated-model quality. The local confidence/dominance rules remain useful for those demo scenarios.

Preview and OBS share the same Canvas widget, Nib sprites, emotion bars and activity chart. CPU pixel spans, retained complete frames and visibility/context restoration remain unchanged. OBS pixels outside the widget stay transparent. See [rendering](STAGE_DESIGN.md), [forms](NIB_EMOTION_EVOLUTION.md) and [evolution sequence](EVOLUTION_SEQUENCE.md).

## Verification

`tests/unit/minute-sentiment.test.js` covers one-viewer/five-GG qualification, four/zero-message skips and base reset, contextual scores overriding keywords, fixed scheduling, budgets/leases, bounded/private input, stale results, cancellation, invalid output and timeout. `test:minute-browser` checks AI score bars and form changes in both views, a later four-message reset, the fixed interval UI and alpha transparency with mocked AI.

Run `npm run verify` and `npm run test:ci-browser`. The latter includes minute AI, conversation, evolution and visibility suites. Live Twitch/model observations belong in [live validation](../validation/LIVE_VALIDATION.md), separate from these zero-paid-call regressions.

API implementation references: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).
