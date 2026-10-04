import { Context } from '@deepseek-ai/cordis'
import { LangfusePlugin, LangfuseConfig } from '../src/index'

/**
 * Example: Basic setup with environment variables
 */
async function basicExample() {
  const ctx = new Context()

  // Load configuration from environment
  const config: LangfuseConfig = {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    enabled: true,
  }

  // Install the plugin
  ctx.plugin(LangfusePlugin, config)

  // Your DSH application continues...
  console.log('Langfuse plugin initialized')
}

/**
 * Example: Advanced configuration
 */
async function advancedExample() {
  const ctx = new Context()

  ctx.plugin(LangfusePlugin, {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: 'https://cloud.langfuse.com',
    enabled: true,
    flushInterval: 3000, // Flush every 3 seconds
    traceMetadata: {
      environment: 'production',
      version: '1.0.0',
      service: 'my-dsh-app',
    },
  })

  console.log('Langfuse plugin with custom config initialized')
}

/**
 * Example: Conditional tracing
 */
async function conditionalExample() {
  const ctx = new Context()

  const isProduction = process.env.NODE_ENV === 'production'

  ctx.plugin(LangfusePlugin, {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    enabled: isProduction, // Only trace in production
    traceMetadata: {
      environment: process.env.NODE_ENV,
    },
  })

  console.log(`Langfuse tracing: ${isProduction ? 'enabled' : 'disabled'}`)
}

export { basicExample, advancedExample, conditionalExample }
