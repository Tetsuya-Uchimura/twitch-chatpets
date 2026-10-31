# Visual questions and six-hour review history

## Screen-dependent replies

Ordinary questions can now use the same server-only Twitch app credentials as the scheduled screenshot jokes. A conservative local router in `visual-question.js` recognizes questions about rounds/finals, maps, obstacles/mechanics, costumes, the screen or what is happening, plus explicit requests to inspect the screen. It supports English and Japanese examples; it is a heuristic, not a universal intent classifier. Ordinary praise does not capture a frame. Demo, disabled live AI and opted-out viewers cannot trigger retrieval. Short visual questions bypass only the ordinary topic-length gate, not input safety, opt-out or reply-interval limits.

Before one selected reply, `Conversation` fetches a 1280×720 thumbnail through `TwitchFrame`, sharing its app token with ten-minute jobs. A preview may be reused for at most 30 seconds. The existing ten-second fetch deadline, 512 KiB MIME/magic/URL bounds and no-redirect restriction remain active. The selected image is attached as high-detail `input_image` alongside chat in the existing single Responses call, with the same schema, cost ledger, hourly/daily settings and concurrency guard. Scheduled jokes still request 512×288 / low detail.

Twitch thumbnails can be up to five minutes old; reuse can add up to 30 seconds. The exact frame time is unknown. The prompt explicitly qualifies time-sensitive answers as observations of a delayed preview, never confirmed current gameplay. Unreadable details require clarification. The model must not claim motion/audio, identify real people, infer an unseen event sequence, or obey visible image text. This is still-image context, not live video understanding. See [Twitch Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams) and [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).

Offline streams, missing credentials or failed image fetches produce a text-only request with a sanitized failure code; the model must not pretend an image was retrieved. The existing generation/expiry/form checks discard late results and prevent a paid call after cancellation during fetching. Visual replies allow the configured inference timeout plus up to ten seconds for fetching. Captured image bytes remain in memory and are cleared on settings changes, disconnect and privacy actions; they are absent from saved review logs and HTTP state.

## Review history

`response-log.js` writes an atomic, server-only UTF-8 file at `data/conversation-log.json`. It retains **up to six hours**, with a secondary bound of 5,000 records, removing expired entries on startup and runtime pruning. Records include timestamp, English reply, sanitized source comment (up to 240 characters), kind, form, emote, provider and optional image-fetch status/age metadata. No screenshot bytes, tokens, keys, raw viewer IDs, display names or relationship profile IDs are saved in this file. The containing `data/` folder is Git-ignored and bind-mounted into the production container.

History survives disconnects, normal stops and container recreation. AI short-term memory remains separate and clears on disconnect. Only its last five Nib lines are supplied for style variation; the six-hour archive is never supplied wholesale to the model. Exact-output duplicate suppression still examines the latest 20 lines, preserving the previous behavior instead of suppressing common replies for six hours.

Normal `/api/state` and SSE contain only the latest 20 review records plus summary counts to keep the overlay light. The dashboard links to `GET /api/conversation/logs`, which returns the full retained history on demand; `?limit=1..5000` can bound the response. Existing localhost Host/Origin controls apply. The archive stores original English; it does not add translation inference or continuous bilingual export.

Viewer `!nib forget`, opt-out and admin deletion clear the whole shared review archive, including disk, because other replies can quote the deleted viewer. They also clear transient context and abort pending capture/replies. Corrupt history files are preserved and reported as storage failure; an explicit privacy clear can replace them with an empty archive. Failure to write history is surfaced separately and does not intentionally stop normal replies.

During the first deployment, only entries still available in the previous container can be imported. Already-evicted older responses cannot be reconstructed; the six-hour retention applies going forward.

## Verification

`tests/unit/visual-history.test.js` covers English/Japanese routing, high-detail request construction, 30-second reuse, offline/credential fallback, cancellation, demo/opt-out protection, retention beyond 20, expiry, restart persistence, data stripping, corruption handling and bounded localhost history export. `test:visual-browser` checks matching preview/OBS speech with both image and text-only fallback, transparent pixels and a history exceeding 20 entries. It is included in the six-suite browser CI command. All providers are injected/mocked in these tests; passing them does not establish live visual answer accuracy.
