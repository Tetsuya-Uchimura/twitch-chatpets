# Startup, CI and Docker

## Local development and validation

Use Node.js 22+ and install from the lockfile:

```sh
npm ci
npm run verify
```

`verify` runs syntax/type checks, all 184 unit/HTTP tests and the production build. To start, copy `.env.example` only if `.env` is absent, then run `npm start`. Fresh settings use an offline demo with paid AI disabled. `npm run start:prod` serves `dist/public` after a build.

Run the browser suites separately:

```sh
npx playwright install --with-deps chromium
npm run test:ci-browser
```

The six suites cover visual questions/history, stream jokes, minute sentiment, conversation, evolution and visibility under idle/gaps/bursts. They use temporary data and mocked providers, with zero paid calls. Local Windows can reuse Edge/Chrome; CI uses Playwright Chromium. `BROWSER_EXECUTABLE` can select an installed browser. Generated screenshots/traces live in Git-ignored `artifacts/` and can be deleted or regenerated.

## Docker: fresh data

```sh
docker compose up --build --detach --wait
```

The dashboard and OBS URLs remain `http://127.0.0.1:3000/` and `http://127.0.0.1:3000/?overlay=1`. Compose reads `.env.example` and optional `.env`, publishes port 3000 only on host loopback and stores settings in the `nib-data` volume. Saved settings take precedence over startup defaults.

```sh
docker compose down
```

Normal stops preserve data. Do not add `--volumes` / `-v` unless you intend to delete the saved ledger and settings. `NIB_HTTP_PORT` can change the host port; update the OBS URL accordingly.

## Docker: retain existing host data

The current streaming installation uses the existing host `data/` folder. Stop any native server before sharing that folder. Always combine both Compose files for this installation:

```sh
docker compose -p chat-critters -f compose.yaml -f compose.host-data.yaml up --build --detach --wait
```

Use the same project/files for normal stop or restart. Environment changes require container recreation; source changes require a rebuild. Existing AI switches, budget settings, usage history and familiarity are preserved. `NIB_DATA_DIR` can select a different host folder.

On Linux, match the host folder owner when using a bind mount:

```sh
mkdir -p data
NIB_UID=$(id -u) NIB_GID=$(id -g) docker compose -p chat-critters -f compose.yaml -f compose.host-data.yaml up --build --detach --wait
```

The default named volume does not need this UID/GID override.

## Live settings and records

- Emotion AI checks completed 60-second batches with at least five accepted comments from one viewer. Fewer comments restore Base Nib without a call.
- Conversation and live AI replies have separate switches. Auto questions/polls default OFF; manual controls use recent chat topics.
- The ten-minute visual joke and selected screen questions need server-only `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`. See [stream jokes](../design/STREAM_JOKES.md) and [visual questions/history](../design/VISUAL_QUESTIONS_AND_HISTORY.md). Image age is uncertain and can be several minutes.
- New installs default to 20 calls/hour and daily budget enforcement at $0.10. `OPENAI_MAX_CALLS_PER_HOUR=0` disables the hourly cap. `OPENAI_DAILY_BUDGET_ENABLED=false` supplies a daily-enforcement OFF startup default; for existing data, also save **No daily budget limit** in AI Settings. The current operator has explicitly disabled both caps for testing. Concurrency and usage accounting remain active.
- The current operator's bubble duration is 10 seconds. **Talk with Nib → Conversation settings → Bubble display** accepts 4,000–20,000 ms; new installs default to 5,000 ms.
- `data/ai-state.json` stores settings and cost reservations; `data/relationships.json` stores anonymous familiarity and opt-outs. Keep both when restarting or moving the app.
- `data/conversation-log.json` keeps sanitized comments/replies for up to six hours, bounded to 5,000 entries. The dashboard shows the latest 20 and links to `/api/conversation/logs` for full history. Viewer forget/opt-out/admin deletion clears the shared archive. Short AI memory remains separate.

Reload the dashboard after a UI update. For a previously loaded OBS source, use that source's Reload control to receive updated browser code; its URL stays unchanged. Do not run competing servers against the same data directory.

## Runtime boundaries and recovery

The production image pins Node.js 22 by digest, excludes `.env`/data/tests/dev dependencies and runs as a non-root user with a read-only root. Only its data mount is persistent and writable. Explicit container mode accepts Docker bridge sockets while localhost Host/Origin/JSON controls remain enforced; forwarded headers are not an authentication basis.

`GET /healthz` checks process liveness, not Twitch or AI success. Check `/api/state` or the dashboard for connection/AI status. The app verifies WebSocket heartbeat and channel join, and reconnects when stale.

The data lock records PID, host and runtime namespace. If a foreign/stale lock remains after a forced shutdown, first verify both the native and container writers are stopped, then remove only `data/server.lock`. Never reset the usage ledger to resolve a lock.

A corrupt response-history file is preserved and reported as a storage failure. Inspect it locally; viewer privacy deletion can replace it with an empty archive. Secrets and response files must never be committed or pasted into public diagnostics.

## Container smoke and CI

```sh
docker build --target runtime -t chat-critters:local .
node scripts/container-smoke.mjs chat-critters:local
```

Smoke tests use an isolated temporary container/volume, checking health, image contents, origin/Host controls, single-writer locking and persistence without accessing real streaming data or paid services.

[ci.yml](../../.github/workflows/ci.yml) defines Windows/Linux check/test/build plus all six browser suites, and a Linux production-image/smoke job. It needs no Twitch/OpenAI credentials and has read-only repository permissions. Failure artifacts are retained briefly. Check the repository's Actions tab for hosted results; local success does not establish hosted success.

The current 184 tests and build/checks passed on Windows and Docker Linux; all six current browser suites passed on Windows. An earlier three-suite revision also passed browsers on Linux. Named-volume and Windows bind-mount recreation were verified. The UID/GID Linux migration command is documented guidance, not a claim that this exact host-folder migration was tested on Linux. [Live validation](../validation/LIVE_VALIDATION.md) records the separate real-service checks and limits.

Old screenshots, temporary helpers and raw diagnostic outputs were removed during publication cleanup. Tests regenerate their own artifacts. Operator-requested bilingual response exports remain local and ignored; source-backed Nib form/evolution previews are retained.
