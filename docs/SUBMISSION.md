# Chat Critters — Nib

Nib is an original pixel creature that lives in a transparent corner of a Twitch stream. Comments become movement, conversation and emotional evolution. Start with the [reviewer guide](README.md) and [architecture](ARCHITECTURE.md).

## What to try

- Instant local reactions: chase, eat, jump, play and nap.
- One-minute AI sentiment: five accepted comments from one viewer qualify; five scores select an emotional form. Quiet minutes restore Base Nib without inference.
- Short English replies with form-specific personality and synchronized emotes; contextual questions and unique-viewer polls use server-calculated results.
- Optional ten-minute jokes combining a delayed Twitch thumbnail with recent chat; selected screen-dependent questions can also request an image.
- Separate short AI memory, anonymous familiarity and six-hour local response review history, with viewer opt-out and deletion.

The offline demo uses labelled deterministic examples and makes no Twitch or OpenAI calls. Real AI quality and live-stream checks are recorded separately in [live validation](validation/LIVE_VALIDATION.md).

## Technical implementation

Runtime code lives in `src/server`, browser code in `src/client`, and shared emotion/form/action definitions in `src/shared`. The dashboard and OBS use the same Canvas renderer and SSE stream. Original artwork is drawn in JavaScript, with six distinct forms and a five-phase transformation sequence.

Accepted chat, minute sentiment, event-driven replies and scheduled visual jokes have separate bounded pipelines. AI output uses strict schemas, application-owned candidate/evidence IDs, timeout/cancellation and stale-result checks. Images, credentials and viewer identities are excluded from response review files. Delayed images are never treated as live video.

AI purposes share one persistent usage/reservation ledger and a concurrency guard. Fresh settings default to paid AI OFF, a $0.10 daily budget and 20 calls/hour; explicit testing overrides can disable the budget or hourly cap without deleting usage history. Poll counts and unique votes are calculated by the server.

The digest-pinned multi-stage Docker image runs as non-root with production dependencies, a read-only root and writable persistent data. Localhost Host/Origin controls and a namespace-aware single-writer lock protect the local control API and ledger. CI defines Windows/Linux checks, six browser suites and a separate production-container smoke job.

## Run

Use Node.js 22+ with `npm ci`, copy `.env.example` only if `.env` does not exist, then run `npm start`. For Docker, follow the [operations guide](guides/OPERATIONS.md), especially when retaining an existing ledger.

- Dashboard: `http://127.0.0.1:3000/`
- OBS Browser Source: `http://127.0.0.1:3000/?overlay=1`
- [Demonstration steps](guides/DEMO_SCRIPT.md)
- [Feature specifications](README.md#detailed-design)

## Verification and practical limits

The current implementation passed 184 unit/HTTP tests, syntax/type checks and builds on Windows and Docker Linux. All six current browser suites passed on Windows; the earlier Linux browser run covered an earlier three-suite revision. Production smoke checked health, non-root execution, secret exclusion, local-origin restrictions, ledger locking and recreation persistence. GitHub Actions results must be checked in the repository; local results are not a claim of hosted-CI success.

Separate live checks verified Twitch reception, jumping, contextual replies, two-account questions/polls, minute evolution and a screenshot-based joke. These are bounded examples, not a quality or latency benchmark. New on-demand visual-question inference has mocked coverage and an authenticated offline probe; accuracy against a live stream remains unverified. Twitch thumbnails can lag by several minutes. Local text filters are not comprehensive multilingual moderation, and anonymous IRC depends on Twitch compatibility.

Only source, tests, build configuration and relevant documentation are published. `.env`, `data/`, dependencies, build output, screenshots, response exports and temporary diagnostics remain excluded. Regenerable diagnostic files were removed during submission cleanup; the dated live-validation summary remains.

## Codex development record

[CODEX_SESSIONS.md](CODEX_SESSIONS.md) preserves the actual implementation session ID and development history, including observed failures and fixes. No session-share link or hosted-CI result is invented.
