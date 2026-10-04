import type { Context } from '@deepseek-ai/cordis'
import type { LlmService } from '@deepseek-ai/dsh-llm'
import type { SessionService } from '@deepseek-ai/dsh-session'
import Schema from '@deepseek-ai/schemastery'
import { Langfuse } from 'langfuse'
import type { LangfuseConfig, TraceContext } from './types.ts'

export { LangfuseConfig } from './types.ts'

const name = 'dsh-langfuse-plugin'

export class LangfusePlugin {
  private langfuse: Langfuse | null = null
  private traceContexts = new Map<string, TraceContext>()

  static Config = Schema.object({
    publicKey: Schema.string().required().description('Langfuse public key'),
    secretKey: Schema.string().required().description('Langfuse secret key'),
    baseUrl: Schema.string().default('https://cloud.langfuse.com').description('Langfuse API base URL'),
    enabled: Schema.boolean().default(true).description('Enable/disable tracing'),
    flushInterval: Schema.number().default(5000).description('Flush interval in milliseconds'),
    traceMetadata: Schema.dict(Schema.any()).default({}).description('Additional metadata for all traces'),
  })

  constructor(private ctx: Context, private config: LangfuseConfig) {
    if (!config.enabled) {
      ctx.logger('langfuse').info('Langfuse plugin disabled')
      return
    }

    if (!config.publicKey || !config.secretKey) {
      ctx.logger('langfuse').error('Langfuse credentials missing. Plugin will not initialize.')
      return
    }

    this.initialize()
  }

  private initialize() {
    const logger = this.ctx.logger('langfuse')

    try {
      this.langfuse = new Langfuse({
        publicKey: this.config.publicKey,
        secretKey: this.config.secretKey,
        baseUrl: this.config.baseUrl,
        flushInterval: this.config.flushInterval,
      })

      logger.info('Langfuse initialized successfully')

      // Setup hooks
      this.setupLlmHooks()

      // Periodic flush
      const flushTimer = setInterval(() => {
        this.flush().catch(err => logger.warn('Flush error:', err))
      }, this.config.flushInterval)

      this.ctx.on('dispose', () => {
        clearInterval(flushTimer)
        this.shutdown()
      })

    } catch (error) {
      logger.error('Failed to initialize Langfuse:', error)
    }
  }

  private setupLlmHooks() {
    const llm = this.ctx.get('llm') as LlmService | undefined
    const session = this.ctx.get('session') as SessionService | undefined

    if (!llm) {
      this.ctx.logger('langfuse').warn('LLM service not available, hooks not installed')
      return
    }

    // Hook into LLM request lifecycle
    this.ctx.on('llm/before-request', (event) => {
      this.onBeforeRequest(event, session)
    })

    this.ctx.on('llm/after-response', (event) => {
      this.onAfterResponse(event)
    })

    this.ctx.on('llm/error', (event) => {
      this.onError(event)
    })
  }

  private onBeforeRequest(event: any, session?: SessionService) {
    if (!this.langfuse) return

    const { provider, model, messages, options } = event
    const sessionId = options?.sessionId ?? session?.currentSessionId ?? 'unknown'
    const traceKey = this.getTraceKey(sessionId, event.requestId)

    try {
      // Create a new trace
      const trace = this.langfuse.trace({
        id: traceKey,
        name: `${provider}:${model}`,
        sessionId: String(sessionId),
        metadata: {
          ...this.config.traceMetadata,
          provider,
          model,
          purpose: options?.purpose,
        },
        tags: [provider, model, 'dsh'],
      })

      // Create generation span
      const generation = trace.generation({
        name: 'llm-completion',
        model: `${provider}/${model}`,
        modelParameters: {
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
          topP: options?.topP,
        },
        input: messages,
        startTime: new Date(),
      })

      this.traceContexts.set(traceKey, {
        trace,
        generation,
        startTime: Date.now(),
      })

    } catch (error) {
      this.ctx.logger('langfuse').warn('Failed to create trace:', error)
    }
  }

  private onAfterResponse(event: any) {
    if (!this.langfuse) return

    const { sessionId, requestId, response, usage } = event
    const traceKey = this.getTraceKey(sessionId, requestId)
    const context = this.traceContexts.get(traceKey)

    if (!context) return

    try {
      const endTime = Date.now()
      const latency = endTime - context.startTime

      // Update generation with response
      context.generation.update({
        output: response,
        endTime: new Date(),
        usage: usage ? {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          total: usage.totalTokens ?? 0,
        } : undefined,
        metadata: {
          latencyMs: latency,
        },
      })

      context.generation.end()

      // Cleanup
      this.traceContexts.delete(traceKey)

    } catch (error) {
      this.ctx.logger('langfuse').warn('Failed to complete trace:', error)
    }
  }

  private onError(event: any) {
    if (!this.langfuse) return

    const { sessionId, requestId, error } = event
    const traceKey = this.getTraceKey(sessionId, requestId)
    const context = this.traceContexts.get(traceKey)

    if (!context) return

    try {
      context.generation.update({
        level: 'ERROR',
        statusMessage: error?.message ?? 'Unknown error',
        endTime: new Date(),
      })

      context.generation.end()
      this.traceContexts.delete(traceKey)

    } catch (err) {
      this.ctx.logger('langfuse').warn('Failed to record error:', err)
    }
  }

  private getTraceKey(sessionId: string | number | undefined, requestId: string): string {
    return `${sessionId ?? 'unknown'}-${requestId}`
  }

  private async flush() {
    if (!this.langfuse) return
    await this.langfuse.flushAsync()
  }

  private async shutdown() {
    if (!this.langfuse) return

    try {
      await this.langfuse.shutdownAsync()
      this.ctx.logger('langfuse').info('Langfuse shutdown complete')
    } catch (error) {
      this.ctx.logger('langfuse').error('Shutdown error:', error)
    }
  }
}

export default LangfusePlugin
