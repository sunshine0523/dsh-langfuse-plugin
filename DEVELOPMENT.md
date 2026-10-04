# Development Guide

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your Langfuse credentials
   ```

## Development Workflow

### Build

```bash
pnpm run build
```

This compiles TypeScript to JavaScript in the `lib/` directory.

### Watch Mode

For development with auto-rebuild:

```bash
pnpm run dev
```

### Type Checking

```bash
pnpm run typecheck
```

## Project Structure

```
dsh-langfuse-plugin/
├── src/
│   ├── index.ts       # Main plugin implementation
│   └── types.ts       # TypeScript type definitions
├── examples/
│   └── usage.ts       # Usage examples
├── lib/               # Compiled output (generated)
├── package.json       # Package manifest
├── tsconfig.json      # TypeScript configuration
└── README.md          # User documentation
```

## Implementation Details

### Plugin Architecture

The plugin follows DSH's Cordis-based plugin pattern:

1. **Service Injection**: Uses `ctx.get()` to access LLM and Session services
2. **Event Hooks**: Subscribes to `llm/before-request`, `llm/after-response`, and `llm/error` events
3. **Lifecycle Management**: Properly handles initialization and disposal

### Langfuse Integration

The plugin uses the official Langfuse JS SDK:

- **Traces**: One trace per LLM request, grouped by session
- **Generations**: Nested generation spans with detailed metrics
- **Metadata**: Captures provider, model, parameters, and custom metadata
- **Usage Tracking**: Records input/output tokens and latency

### Event Flow

```
LLM Request
    ↓
llm/before-request → Create Langfuse trace + generation span
    ↓
LLM Processing...
    ↓
llm/after-response → Update generation with response + usage
    ↓
llm/error → Mark generation as error (if failed)
    ↓
Periodic Flush → Send data to Langfuse
```

## Testing

Currently, manual testing is required:

1. Set up a real DSH application
2. Configure the plugin with valid Langfuse credentials
3. Make LLM requests
4. Verify traces appear in Langfuse dashboard

Future: Add unit and integration tests.

## Publishing

1. Update version in `package.json`
2. Build the package:
   ```bash
   pnpm run build
   ```

3. Publish to npm:
   ```bash
   npm publish --access public
   ```

## Notes

- The plugin depends on DSH's event system for LLM lifecycle hooks
- Currently assumes specific event names/structure - may need adjustment based on actual DSH implementation
- Requires DSH >= 0.2.0 for LLM service integration
- Langfuse credentials must be provided; no defaults exist

## Contributing

1. Follow TypeScript strict mode conventions
2. Match DSH's coding style (see deepseek-harness repository)
3. Keep dependencies minimal
4. Document public APIs with JSDoc
5. Test with real Langfuse instance before submitting PRs
