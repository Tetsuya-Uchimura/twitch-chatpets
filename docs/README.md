# Reviewer guide

Start with [Submission overview](SUBMISSION.md), then [Architecture](ARCHITECTURE.md). The app can run as a zero-API demo; live Twitch/AI validation is recorded separately from mocked tests.

The architecture guide includes [runtime data flow](diagrams/runtime.svg) and [deployment/storage boundaries](diagrams/deployment.svg). [Diagram sources and rendering](diagrams/README.md) are maintained alongside the SVGs.

## Read the implementation

| Area | Entry points | What to review |
| --- | --- | --- |
| Startup / HTTP | [index.js](../src/server/index.js), [app.js](../src/server/app.js) | Configuration, localhost controls, SSE and pipeline wiring |
| Twitch input | [twitch.js](../src/server/twitch.js), [chat.js](../src/server/chat.js) | Connection liveness, filtering and stable participant identity |
| Minute evolution | [minute-sentiment.js](../src/server/minute-sentiment.js), [pulse.js](../src/server/pulse.js), [evolution.js](../src/server/evolution.js) | One-viewer AI batches, scores and low-activity base reset |
| Conversation / polls | [conversation.js](../src/server/conversation.js), [conversation-ai.js](../src/server/conversation-ai.js) | Context, structured replies, authoritative results and stale-output rejection |
| Stream images / jokes | [stream-jokes.js](../src/server/stream-jokes.js), [twitch-frame.js](../src/server/twitch-frame.js) | Ten-minute context, server-only token, bounded image and multimodal speech |
| Visual questions / history | [visual-question.js](../src/server/visual-question.js), [response-log.js](../src/server/response-log.js) | Selected image-backed replies, six-hour local retention and bounded history export |
| Cost / privacy | [store.js](../src/server/store.js), [relationships.js](../src/server/relationships.js) | Shared budget reservations, persistence, namespace locks and deletion |
| Rendering | [app.js](../src/client/app.js), [stage.js](../src/client/stage.js), [evolution-sequence.js](../src/client/evolution-sequence.js) | Shared dashboard/OBS Canvas and animation arbitration |
| Tests | [unit](../tests/unit/), [browser](../tests/browser/), [container smoke](../scripts/container-smoke.mjs) | Regression coverage and zero-paid-call validation |

The browser receives only client code and environment-independent shared modules. Server-only configuration, keys and saved data remain outside the static web root.

## Demonstrate and reproduce

- [Demo script](guides/DEMO_SCRIPT.md)
- [Startup, CI and Docker](guides/OPERATIONS.md)
- [Real-stream validation and limits](validation/LIVE_VALIDATION.md)
- [Actual Codex session history](CODEX_SESSIONS.md)

## Detailed design

- [Chat Pulse](design/CHAT_PULSE.md): local sentiment windows and activity counts.
- [Nib's emotional forms](design/NIB_EMOTION_EVOLUTION.md): six silhouettes and minute evolution.
- [Evolution sequence](design/EVOLUTION_SEQUENCE.md): old-to-new transformation and motion barriers.
- [Conversation](design/NIB_CONVERSATION.md): questions, polls, short memory, relationships and controls.
- [Stream jokes](design/STREAM_JOKES.md): Twitch setup, ten-minute visual jokes, limits and privacy.
- [Visual questions and review history](design/VISUAL_QUESTIONS_AND_HISTORY.md): on-demand preview context and six-hour response records.
- [Mood/action variants](design/PERSONALITY.md) and [rendering design](design/STAGE_DESIGN.md).

Only `src/`, `tests/`, `scripts/`, these docs and root build/configuration files belong to the implementation. `dist/`, `artifacts/`, `node_modules/`, `data/` and `.env` are local/generated material excluded from Git. Historical paths in the Codex session log describe the layout at the time; the structure above is current.
