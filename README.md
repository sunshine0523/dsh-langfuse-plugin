# dsh-langfuse-plugin

Langfuse observability plugin for DeepSeek Harness, providing comprehensive tracing and monitoring for LLM interactions.

## Features

- 🔍 Automatic tracing of LLM requests and responses
- 📊 Token usage tracking
- ⏱️ Latency monitoring
- 🎯 Session-based trace grouping
- 🛠️ Full DSH plugin architecture integration
- 🔄 Support for streaming responses
- 📝 Request/response payload logging

## Installation

```bash
npm install @deepseek-ai/dsh-langfuse-plugin
```

Or with pnpm:

```bash
pnpm add @deepseek-ai/dsh-langfuse-plugin
```

## Configuration

Set up your Langfuse credentials as environment variables:

```bash
export LANGFUSE_PUBLIC_KEY="your-public-key"
export LANGFUSE_SECRET_KEY="your-secret-key"
export LANGFUSE_BASE_URL="https://cloud.langfuse.com"  # Optional, defaults to cloud
```

## Usage

### Basic Setup

Add the plugin to your DSH configuration:

```typescript
import { Context } from '@deepseek-ai/cordis'
import { LangfusePlugin } from '@deepseek-ai/dsh-langfuse-plugin'

const ctx = new Context()

ctx.plugin(LangfusePlugin, {
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
  enabled: true,
  flushInterval: 5000, // Optional: flush interval in ms
})
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `publicKey` | `string` | - | Langfuse public key (required) |
| `secretKey` | `string` | - | Langfuse secret key (required) |
| `baseUrl` | `string` | `https://cloud.langfuse.com` | Langfuse API base URL |
| `enabled` | `boolean` | `true` | Enable/disable tracing |
| `flushInterval` | `number` | `5000` | Flush interval in milliseconds |
| `traceMetadata` | `object` | `{}` | Additional metadata for all traces |

## How It Works

The plugin automatically:

1. **Intercepts LLM calls** - Hooks into DSH's LLM adapter lifecycle
2. **Creates traces** - Generates Langfuse traces with hierarchical spans
3. **Tracks metrics** - Records token usage, latency, and model information
4. **Groups by session** - Associates traces with DSH session IDs
5. **Handles streaming** - Correctly captures streaming response chunks

## Architecture

This plugin follows DSH's plugin architecture patterns:

- Uses Cordis service injection for lifecycle management
- Implements event-based tracing hooks
- Respects DSH's adapter abstraction layer
- Compatible with all DSH-supported LLM providers

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Watch mode
pnpm run dev

# Type check
pnpm run typecheck
```

## Contributing

Contributions are welcome! Please ensure:

- TypeScript strict mode compliance
- Follow DSH plugin conventions
- Add tests for new features
- Update documentation

## Resources

- [Langfuse Documentation](https://langfuse.com/docs)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Langfuse JS/TS SDK](https://langfuse.com/guides/cookbook/js_langfuse_sdk)

## License

MIT - see [LICENSE](LICENSE) file for details

## Support

For issues and questions:
- File an issue on GitHub
- Check Langfuse and DSH documentation
- Join the DeepSeek Harness community

---

**Note**: This is an independent plugin and is not officially maintained by DeepSeek AI or Langfuse.
