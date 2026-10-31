# Architecture diagrams

These diagrams describe the current implementation. SVGs render directly in GitHub Markdown and can be opened at full size. Mermaid sources and the shared theme are kept alongside them; they are documentation assets, not application dependencies.

| View | Rendered diagram | Editable source |
| --- | --- | --- |
| Runtime data flow | [runtime.svg](runtime.svg) | [runtime.mmd](runtime.mmd) |
| Deployment and persistent storage | [deployment.svg](deployment.svg) | [deployment.mmd](deployment.mmd) |

The runtime diagram follows `app.js`, `conversation.js`, `minute-sentiment.js`, `stream-jokes.js` and `twitch-frame.js`. The deployment diagram follows `Dockerfile`, `compose.yaml`, `compose.host-data.yaml` and the local JSON stores. The [architecture guide](../ARCHITECTURE.md) explains the low-activity reset, shared policy, delayed thumbnails, demo mode, native startup and host-data variant.

## Regenerate

Use Node.js 22.13+ and Mermaid CLI 12.0.0. This one-off command does not add a package to the app:

```sh
npx --yes --package @mermaid-js/mermaid-cli@12.0.0 mmdc --input docs/diagrams/runtime.mmd --output docs/diagrams/runtime.svg --configFile docs/diagrams/mermaid-config.json --backgroundColor white
npx --yes --package @mermaid-js/mermaid-cli@12.0.0 mmdc --input docs/diagrams/deployment.mmd --output docs/diagrams/deployment.svg --configFile docs/diagrams/mermaid-config.json --backgroundColor white
```

Run from the repository root. Mermaid CLI uses a headless browser. On a machine with an existing compatible Chrome/Edge, `PUPPETEER_SKIP_DOWNLOAD=true` plus `--puppeteerConfigFile <local-config.json>` can select its `executablePath` instead of downloading Chromium. Keep machine-specific browser paths out of committed configuration. Render both files and inspect labels, arrow directions and group boundaries after an edit.

The SVGs contain no credentials, user messages or live stream screenshots. Colors distinguish external services, server processing, browser output and local persistent data; the diagrams also have accessible titles/descriptions.
