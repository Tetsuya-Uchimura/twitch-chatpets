# Ten-minute stream jokes

Nib can make one short visual joke using a Twitch stream thumbnail and a separate window of the last ten minutes of accepted chat. This is independent of one-minute emotion/evolution. Output is English, matching ordinary replies, with the same 140-character limit and synchronized speech emote in the dashboard and OBS overlay. It is displayed on screen; no Twitch chat message is sent.

## Setup

Register a unique app name, category **Chat Bot**, client type **Confidential**. Add `http://localhost` as the redirect URL. The Client Credentials flow used here does not redirect or require user login/scopes. This is a privately operated server that can keep credentials secret; do not bundle its secret in a distributable desktop client.

Generate a Client Secret in the app management page and save only in the root `.env`:

```dotenv
TWITCH_CHANNEL=your_channel
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
```

Restart after changing environment values. In **Talk with Nib → Conversation settings**, enable **Stream screenshot joke every 10 minutes (paid)** and save. Conversation, live AI replies, jokes and short-term memory must also be ON. New installations default OFF. The panel reports missing credentials, offline state, next check, buffered comment count, API calls and skip reasons. Demo mode never runs this feature.

The streaming instance uses existing host data. Recreate with both files after changing `.env`; add `--build` when updating code:

```sh
docker compose -p chat-critters -f compose.yaml -f compose.host-data.yaml up --detach --force-recreate --wait
```

## Data and timing

`stream-jokes.js` starts a 600-second window when chat connects or conversation settings are saved. Reconnection starts a fresh window; missed periods never produce catch-up bursts. It keeps at most 1,000 safe comments in memory, independent of the one-minute buffer. Commands, opted-out participants, blocked and sensitive text are excluded. Known sender names, mentions and IDs are sanitized before intake. Each prompt takes an evenly spaced chronological sample of at most 100 comments / 8,000 text characters, with offsets and window metadata. This is a bounded sample, not a full transcript at high traffic.

`twitch-frame.js` obtains a server-only app access token, caches it before expiry and renews once on Helix 401. `Get Streams?user_login=...` supplies the thumbnail URL. Only HTTPS `static-cdn.jtvnw.net/previews-ttv/` image URLs are accepted; redirects are refused. Fetching has a ten-second deadline and 512 KiB size/MIME/magic checks. The requested thumbnail is 512×288.

The image and chat evidence enter the existing bounded conversation queue. The current bubble and active poll/question take priority; a waiting candidate may expire. There is no catch-up retry. A job sends one Responses request containing `input_text` and a base64 `input_image` with `detail: low`, `store: false` and no retries, using the existing model. Its strict schema binds candidate/evidence IDs and requires a null follow-up. Unsafe, duplicate, late, cancelled and old-form output is discarded; the model may decline an unsuitable joke. Valid speech uses the existing renderer and never forces an evolution.

Twitch documents the image as a frame from the **last five minutes**, not a live screenshot. The exact frame time is unknown; downloading again does not prove freshness. Prompt metadata states this explicitly. Nib may refer to the still but must not claim motion, audio or a precise event sequence. Humor targets situations, never personal appearance or identity.

## Budget and privacy

Minute sentiment, ordinary replies and visual jokes share the existing ledger, **20 requests/hour**, **$0.10/day** default and concurrency lease. There are no dedicated six calls/hour reserved for jokes. Active minute sentiment may exhaust capacity first; skipped jobs are reported. Before a call, text/output estimates plus a conservative 8,192-token image allowance are reserved. Actual input usage includes image tokens. Missing usage retains the reservation; estimates are not a billing guarantee.

For testing, `OPENAI_MAX_CALLS_PER_HOUR=0` explicitly removes the hourly cap for all three purposes. Daily budget and concurrency remain enforced. This is an operator override; the example/default remains 20/hour.

A separate `OPENAI_DAILY_BUDGET_ENABLED=false` / saved `dailyBudgetEnabled: false` override disables the daily cap too. It applies to all AI purposes without changing the stored amount or erasing reservations, tokens or costs. The AI Settings checkbox **No daily budget limit** controls it; concurrency, intervals, explicit AI switches and privacy controls still apply. Defaults keep daily enforcement enabled.

Credentials, app tokens, image bytes and the full ten-minute comment window stay in server memory and are absent from `/api/state` and saved files. Separately, up to six hours of sanitized reply/source review records are stored locally in `data/conversation-log.json`, without images or viewer identifiers. The ledger stores only purpose, usage/cost, status and sanitized errors. **The screenshot may contain visible account names, webcam faces or other stream content**; text sanitization does not redact pixels. Enabling this feature sends that broadcast image and bounded comment sample to OpenAI. The model must not identify people or repeat private information.

Disconnect, disabling conversation/memory/the feature, saving conversation settings and viewer privacy actions clear pending windows and visual candidates. Capture is aborted; existing generation/abort checks reject stale replies. Already-sent provider input cannot be recalled. Privacy actions conservatively clear the whole visual context so another viewer cannot retain a quotation of the deleted participant.

## Verification

`tests/unit/stream-jokes.test.js` covers timing, independent retention, sampling, privacy, token renewal, URL/size/type validation, offline skips, shared limits, cancellation, poll priority and output/usage validation. `npm run test:stream-jokes-browser` checks matching speech/emotes in dashboard and transparent OBS, plus saved OFF controls. Both use injected providers and zero paid calls; the browser test is included in `test:ci-browser`.

On 2026-10-31 the operator saved credentials locally. Real server-side authentication and Get Streams succeeded and reported the channel offline. No real screenshot or visual-joke inference was claimed; this check made zero OpenAI calls.

Sources: [Twitch registration](https://dev.twitch.tv/docs/authentication/register-app/), [Client Credentials](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow), [Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams), [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).

Later on the same date, the operator started streaming. A real scheduled job combined the Twitch still with three comments and displayed the generated contextual joke/laugh emote in both browser views. One real call took about 4.9 seconds from the scheduled check to speech, with estimated cost $0.001456 at configured rates. See the later [live validation](../validation/LIVE_VALIDATION.md) entry for evidence and the native-OBS capture limitation.
