import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse'

export interface LangfuseConfig {
  /** Langfuse public key */
  publicKey: string
  /** Langfuse secret key */
  secretKey: string
  /** Langfuse API base URL */
  baseUrl?: string
  /** Enable/disable tracing */
  enabled?: boolean
  /** Flush interval in milliseconds */
  flushInterval?: number
  /** Additional metadata for all traces */
  traceMetadata?: Record<string, any>
}

export interface TraceContext {
  trace: LangfuseTraceClient
  generation: LangfuseGenerationClient
  startTime: number
}

export interface LlmBeforeRequestEvent {
  provider: string
  model: string
  messages: any[]
  options?: {
    sessionId?: string | number
    temperature?: number
    maxTokens?: number
    topP?: number
    purpose?: string
  }
  requestId: string
}

export interface LlmAfterResponseEvent {
  sessionId?: string | number
  requestId: string
  response: any
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

export interface LlmErrorEvent {
  sessionId?: string | number
  requestId: string
  error: Error
}
