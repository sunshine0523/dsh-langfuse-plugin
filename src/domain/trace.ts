/**
 * Pure trace model: what one completed dsh agent turn looks like when handed
 * to the OTLP sink. Plainly serializable, no IO, no dsh imports — TurnTracker
 * produces it, OtlpTraceSink consumes it.
 */

/** One tool/call + tool/result pair inside a turn. */
export interface ToolObservation {
  /** dsh ToolCallId of the `tool/call` event. */
  id: string;
  name: string;
  /** Raw `arguments` JSON text exactly as the model produced it. */
  input: string | null;
  /** Result text extracted from the `tool/result` message content. */
  output: string | null;
  level: "DEFAULT" | "ERROR";
  statusMessage: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
}

/** Token accounting summed across the turn's assistant messages. */
export interface UsageDetails {
  input?: number;
  output?: number;
  total?: number;
}

/** The assistant side of the turn, from `assistant/message` events. */
export interface GenerationObservation {
  /** Model route name, from the latest `request/context` / `request/header`. */
  model: string | null;
  input: string | null;
  output: string | null;
  usage: UsageDetails | null;
  /** True when the turn's last assistant message carried `interrupted: true`. */
  interrupted: boolean;
}

/** One completed turn, ready for the sink. */
export interface TurnTrace {
  traceId: string;
  sessionId: string;
  /** dsh turn counter from `turn/start` / `turn/end`. */
  turnNumber: number | null;
  startedAtMs: number;
  endedAtMs: number;
  prompt: string | null;
  assistantMessage: string | null;
  tools: ToolObservation[];
  generation: GenerationObservation | null;
  /** Notes relayed from `agent/error` during this turn. */
  errorNotes: string[];
  /** `reason.kind` from `turn/end`. */
  endReason: string;
}
