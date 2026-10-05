# dsh-langfuse-plugin

Langfuse observability plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). Each completed agent turn is exported as one Langfuse trace through OTLP/HTTP.

The package name is `dsh-langfuse-plugin`. It is a DSH bundle plugin, so install it with `dsh plugin`, rather than with a plain `npm install` command.

## Compatibility

This release is tested with **DeepSeek Harness `0.2.0-rc.2`** and Node.js **22.12 or later**. It uses the DSH `0.2.0-rc.2` session and home-path APIs, Cordis `4.0.4`, and Schemastery `3.18.4`. DSH is in developer preview, so compatibility may change between DSH releases.

## Features

- One trace per completed agent turn
- Tool call and result observations, including tool errors
- Assistant generation with model and token usage when available
- Optional prompt capture
- Fail-open behavior: missing credentials and export failures do not interrupt DSH
- Direct OTLP/HTTP export without the Langfuse SDK

## Installation

Install the published package:

```bash
dsh plugin --profile <profile> add dsh-langfuse-plugin
```

From a checkout:

```bash
dsh plugin --profile <profile> add /abs/path/to/dsh-langfuse-plugin
```

For a packed release:

```bash
npm pack
dsh plugin --profile <profile> add ./dsh-langfuse-plugin-0.1.2.tgz
```

The package contains `lib/index.js` and the root `cordis.patch.yml`. The patch mounts the plugin with `id: dsh-langfuse-plugin` and `name: dsh-langfuse-plugin`.

## Credentials

Credentials can be configured directly in the Cordis plugin config. When either key is omitted, the remaining fallback sources are checked in this order:

1. `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` environment variables
2. `$DSH_HOME/langfuse.json` (normally `~/.dsh/langfuse.json`)

```json
{
  "publicKey": "pk-lf-...",
  "secretKey": "sk-lf-..."
}
```

When no complete credential pair is available, the plugin stays disabled. Set `debug: true` to log a warning.

## Configuration

Configure the plugin through Cordis:

```yaml
- id: dsh-langfuse-plugin
  name: dsh-langfuse-plugin
  config:
    publicKey: "pk-lf-..."
    secretKey: "sk-lf-..."
    baseUrl: "https://cloud.langfuse.com"
    environment: "development"
    userId: "user-123"
    capturePrompts: true
    timeoutMs: 30000
    debug: false
```

| Field | Default | Description |
| --- | --- | --- |
| `publicKey` | fallback | Langfuse project public key. |
| `secretKey` | fallback | Langfuse project secret key. |
| `baseUrl` | `https://cloud.langfuse.com` | Langfuse instance URL; self-hosted instances can override it. |
| `environment` | `development` | Langfuse environment label. |
| `userId` | unset | Optional user ID attached to traces. |
| `capturePrompts` | `true` | Set to `false` to omit user prompts while preserving trace structure. |
| `timeoutMs` | `30000` | Export timeout and shutdown drain budget, in milliseconds. |
| `debug` | `false` | Include diagnostic details in warnings. |

## Trace contents

For each `turn/end`, the plugin sends one OTLP document containing a root `DSH Turn` observation, a `dsh.assistant` generation, and one `tool.<name>` observation per tool call. Failed tools and `agent/error` events are marked as errors.

The event assembler consumes `turn/start`, `user/message`, `request/context`, `request/header`, `tool/call`, `tool/result`, `assistant/message`, and `turn/end` events. Unknown or malformed events are ignored safely.

## Development

```bash
npm install
npm run typecheck
npm run build
```

- `src/turn-tracker.ts`: assembles session events into turn traces
- `src/otlp-sink.ts`: encodes and sends OTLP/JSON
- `src/plugin.ts`: Cordis service and event wiring
- `src/credentials.ts`: environment and `$DSH_HOME` credential lookup

## License

MIT
