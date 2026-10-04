import type {
  GenerationObservation,
  ToolObservation,
  TurnTrace,
  UsageDetails,
} from "./domain/trace.js";

/**
 * Structural input for one canonical dsh session event. The typed contract is
 * `SessionEvent` from @deepseek-ai/dsh-session; this shape keeps the tracker
 * importable without the runtime package and tolerant of unknown event types.
 */
export interface SessionEventInput {
  seq: number;
  type: string;
  /** Unix epoch milliseconds, from the event envelope. */
  time: number;
  data: unknown;
}

export interface TurnTrackerDeps {
  /** Receives exactly one trace per completed turn. */
  sink: { enqueue(trace: TurnTrace): void };
  /** When false, user prompts are dropped from traces and generations. */
  capturePrompts: boolean;
  /** Random UUID source; defaults to crypto.randomUUID. */
  nextId?: () => string;
}

interface TurnBuffer {
  turnNumber: number | null;
  startedAtMs: number;
  prompt: string | null;
  assistant: string | null;
  model: string | null;
  usage: UsageDetails | null;
  interrupted: boolean;
  tools: ToolObservation[];
  errorNotes: string[];
}

/** Pull the joined text out of a message's content blocks; null when none. */
function textOfContent(content: unknown): string | null {
  if (typeof content === "string") return content || null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block !== null &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function addUsage(into: UsageDetails | null, usage: unknown): UsageDetails {
  const acc: UsageDetails = into ? { ...into } : {};
  if (usage !== null && typeof usage === "object") {
    const record = usage as Record<string, unknown>;
    const num = (key: string): number | undefined =>
      typeof record[key] === "number" ? record[key] : undefined;
    const input = num("inputTokens");
    const output = num("outputTokens");
    const total = num("totalTokens");
    if (input !== undefined) acc.input = (acc.input ?? 0) + input;
    if (output !== undefined) acc.output = (acc.output ?? 0) + output;
    if (total !== undefined) acc.total = (acc.total ?? 0) + total;
  }
  return acc;
}

/**
 * Per-session turn assembler: mirrors the dsh agent loop's canonical event
 * vocabulary (dsh-session/lib/types SessionEventMap) into one TurnTrace per
 * turn. Synchronous, no IO; unknown event types are counted and ignored;
 * malformed event data degrades via optional chaining instead of throwing.
 */
export class TurnTracker {
  private readonly sink: TurnTrackerDeps["sink"];
  private readonly capturePrompts: boolean;
  private readonly nextId: () => string;
  /** Open turn per session id; null means the session is live with nothing buffered. */
  private readonly buffers = new Map<string, TurnBuffer | null>();
  private unknownEvents = 0;

  constructor(deps: TurnTrackerDeps) {
    this.sink = deps.sink;
    this.capturePrompts = deps.capturePrompts;
    this.nextId = deps.nextId ?? (() => crypto.randomUUID());
  }

  get unknownEventCount(): number {
    return this.unknownEvents;
  }

  /** Register a live session so later events find their buffer slot. */
  adopt(sessionId: string): void {
    if (!this.buffers.has(sessionId)) this.buffers.set(sessionId, null);
  }

  /** Forget a disposed session's buffered turn (the trace is not flushed). */
  drop(sessionId: string): void {
    this.buffers.delete(sessionId);
  }

  /** Relay one `agent/error` emission onto the session's open turn. */
  annotate(
    sessionId: string,
    note: { turn?: unknown; step?: unknown; error: unknown },
  ): void {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) return;
    const error = note.error;
    const name = error instanceof Error ? error.name : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    const where =
      note.turn === undefined && note.step === undefined
        ? ""
        : ` (turn ${String(note.turn)} step ${String(note.step)})`;
    buffer.errorNotes.push(`${name}: ${message}${where}`);
  }

  ingest(sessionId: string, event: SessionEventInput): void {
    const data =
      event.data !== null && typeof event.data === "object"
        ? (event.data as Record<string, unknown>)
        : {};
    const time = typeof event.time === "number" ? event.time : Date.now();

    switch (event.type) {
      case "turn/start": {
        // A still-open buffer here means the previous turn never ended
        // (crash-orphan); v1 drops it rather than replaying stale state.
        const turnNumber = typeof data.turn === "number" ? data.turn : null;
        this.buffers.set(sessionId, {
          turnNumber,
          startedAtMs: time,
          prompt: null,
          assistant: null,
          model: null,
          usage: null,
          interrupted: false,
          tools: [],
          errorNotes: [],
        });
        return;
      }
      case "user/message": {
        const buffer = this.openBuffer(sessionId, time);
        // dsh's SessionEventMap types `user/message` data as the UserMessage
        // itself (content at data.content); tolerate a `{message}` wrapper for
        // robustness against plugin-merged re-emissions. A turn carries several
        // user-role events (the queued human prompt first, then synthetic
        // runtime-context and system-reminder injections): first wins — it is
        // the human prompt.
        const message = (data.message ?? data) as { content?: unknown } | null;
        const text = textOfContent(message?.content);
        if (this.capturePrompts && text !== null && buffer.prompt === null) buffer.prompt = text;
        return;
      }
      case "tool/call": {
        const buffer = this.openBuffer(sessionId, time);
        const callId = asString(data.callId) ?? this.nextId();
        const name = asString(data.name) ?? "unknown";
        const input = asString(data.arguments);
        buffer.tools.push({
          id: callId,
          name,
          input,
          output: null,
          level: "DEFAULT",
          statusMessage: null,
          startedAtMs: time,
          endedAtMs: null,
        });
        return;
      }
      case "tool/result": {
        const buffer = this.openBuffer(sessionId, time);
        const message = (data.message ?? null) as {
          toolCallId?: unknown;
          isError?: unknown;
          content?: unknown;
        } | null;
        const callId = asString(message?.toolCallId);
        const output = textOfContent(message?.content);
        const failed =
          message?.isError === true || (data.error !== undefined && data.error !== null);
        const errorPayload = (data.error ?? null) as {
          name?: unknown;
          code?: unknown;
          reason?: unknown;
        } | null;
        const statusMessage = failed
          ? (asString(errorPayload?.reason) ??
            `${asString(errorPayload?.name) ?? "ToolError"}: ${asString(errorPayload?.code) ?? "ERROR"}`)
          : null;

        const tool =
          (callId && buffer.tools.find((candidate) => candidate.id === callId)) ??
          [...buffer.tools].reverse().find((candidate) => candidate.endedAtMs === null) ??
          null;
        if (tool) {
          tool.output = output;
          tool.endedAtMs = time;
          if (failed) {
            tool.level = "ERROR";
            tool.statusMessage = statusMessage;
          }
        } else {
          // Result without a recorded call: keep it as its own observation.
          buffer.tools.push({
            id: callId ?? this.nextId(),
            name: "unknown",
            input: null,
            output,
            level: failed ? "ERROR" : "DEFAULT",
            statusMessage,
            startedAtMs: time,
            endedAtMs: time,
          });
        }
        return;
      }
      case "assistant/message": {
        const buffer = this.openBuffer(sessionId, time);
        const text = textOfContent(
          (data.message as { content?: unknown } | null)?.content,
        );
        if (text !== null) buffer.assistant = text;
        if (data.interrupted === true) buffer.interrupted = true;
        buffer.usage = addUsage(buffer.usage, data.usage);
        return;
      }
      case "request/context": {
        const buffer = this.openBuffer(sessionId, time);
        const model = asString(data.model);
        if (model !== null) buffer.model = model;
        return;
      }
      case "request/header": {
        const buffer = this.openBuffer(sessionId, time);
        // Context snapshots win; the header only fills the gap.
        if (buffer.model === null) {
          const model = asString(
            (data.header as { config?: { model?: unknown } } | null)?.config?.model,
          );
          if (model !== null) buffer.model = model;
        }
        return;
      }
      case "turn/end": {
        const buffer = this.buffers.get(sessionId);
        if (!buffer) return; // turn/end for a turn we never saw: nothing to report.
        this.buffers.set(sessionId, null);
        const generation: GenerationObservation | null =
          buffer.assistant !== null ||
          buffer.usage !== null ||
          buffer.model !== null
            ? {
                model: buffer.model,
                input: buffer.prompt,
                output: buffer.assistant,
                usage: buffer.usage,
                interrupted: buffer.interrupted,
              }
            : null;
        this.sink.enqueue({
          traceId: this.nextId(),
          sessionId,
          turnNumber: typeof data.turn === "number" ? data.turn : buffer.turnNumber,
          startedAtMs: buffer.startedAtMs,
          endedAtMs: time,
          prompt: buffer.prompt,
          assistantMessage: buffer.assistant,
          tools: buffer.tools,
          generation,
          errorNotes: buffer.errorNotes,
          endReason:
            typeof (data.reason as { kind?: unknown } | null)?.kind === "string"
              ? ((data.reason as { kind: string }).kind)
              : "unknown",
        });
        return;
      }
      default:
        // Unknown (plugin-merged or future) event types are ignored by design.
        this.unknownEvents += 1;
        return;
    }
  }

  /** Events may legally precede `turn/start` (implicit first buffer). */
  private openBuffer(sessionId: string, time: number): TurnBuffer {
    const existing = this.buffers.get(sessionId);
    if (existing) return existing;
    const created: TurnBuffer = {
      turnNumber: null,
      startedAtMs: time,
      prompt: null,
      assistant: null,
      model: null,
      usage: null,
      interrupted: false,
      tools: [],
      errorNotes: [],
    };
    this.buffers.set(sessionId, created);
    return created;
  }
}
