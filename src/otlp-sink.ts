import { randomBytes, randomUUID } from "node:crypto";
import type { ToolObservation, TurnTrace, UsageDetails } from "./domain/trace.js";

export interface SinkOptions {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  environment: string;
  userId?: string;
  timeoutMs: number;
  debug?: boolean;
}

export interface SinkLogger {
  warn(message: string): void;
}

/** Package identity stamped into resource attributes and the plugin tag. */
const PLUGIN_NAME = "dsh-langfuse-plugin";
const PLUGIN_VERSION = "0.1.0";
const TRACE_NAME = "DSH Turn";
const BASE_TAGS = ["dsh", PLUGIN_NAME];

// OTLP/JSON value wrappers (proto3 JSON encoding — what the official OTLP
// exporters emit and what Langfuse's v4 events ingestion reads).
type OtlpValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { arrayValue: { values: OtlpValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: OtlpValue }> } };

interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
}

/** Serialize like the Langfuse SDKs do: strings verbatim, anything else as JSON. */
function serialize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function attr(key: string, value: OtlpValue | null): OtlpAttribute | null {
  return value === null ? null : { key, value };
}
function str(key: string, value: string | null | undefined): OtlpAttribute | null {
  return value === null || value === undefined || value === "" ? null : attr(key, { stringValue: value });
}
function strArray(key: string, values: string[]): OtlpAttribute {
  return { key, value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } } };
}
function json(key: string, value: unknown): OtlpAttribute | null {
  return str(key, serialize(value));
}

function chat(content: string | null, role: "user" | "assistant"): unknown | null {
  return content === null ? null : { role, content };
}

function unixNano(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

/**
 * Trace-level identity stamped on EVERY span: the Langfuse v4 events backend
 * reads trace fields (name, session, user, tags, environment) per span, so a
 * child span without them lands detached from its trace.
 */
function traceIdentityAttributes(sessionId: string, options: SinkOptions, tags: string[]): OtlpAttribute[] {
  return [
    { key: "langfuse.trace.name", value: { stringValue: TRACE_NAME } },
    str("session.id", sessionId),
    str("user.id", options.userId),
    strArray("langfuse.trace.tags", tags),
    str("langfuse.environment", options.environment),
  ].filter((candidate): candidate is OtlpAttribute => candidate !== null);
}

function toolSpan(
  traceId: string,
  parentSpanId: string,
  tool: ToolObservation,
  identity: OtlpAttribute[],
): OtlpSpan {
  return {
    traceId,
    spanId: randomBytes(8).toString("hex"),
    parentSpanId,
    name: `tool.${tool.name}`,
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: unixNano(tool.startedAtMs ?? 0),
    endTimeUnixNano: unixNano(tool.endedAtMs ?? tool.startedAtMs ?? 0),
    attributes: [
      ...identity,
      { key: "langfuse.observation.type", value: { stringValue: "tool" } },
      json("langfuse.observation.input", tool.input),
      json("langfuse.observation.output", tool.output),
      str("langfuse.observation.level", tool.level === "ERROR" ? "ERROR" : null),
      str("langfuse.observation.status_message", tool.statusMessage),
      str("langfuse.observation.metadata.toolCallId", tool.id),
    ].filter((candidate): candidate is OtlpAttribute => candidate !== null),
  };
}

function usageDetailsOf(usage: UsageDetails | null): Record<string, number> | null {
  if (!usage) return null;
  const details: Record<string, number> = {};
  for (const [key, value] of Object.entries(usage)) {
    if (typeof value === "number") details[key] = value;
  }
  return Object.keys(details).length ? details : null;
}

function generationSpan(
  traceId: string,
  parentSpanId: string,
  trace: TurnTrace,
  identity: OtlpAttribute[],
): OtlpSpan | null {
  const generation = trace.generation;
  if (!generation) return null;
  const usage = usageDetailsOf(generation.usage);
  const attributes = (
    [
      { key: "langfuse.observation.type", value: { stringValue: "generation" } },
      json("langfuse.observation.input", chat(generation.input, "user")),
      json("langfuse.observation.output", chat(generation.output, "assistant")),
      str("langfuse.observation.model.name", generation.model),
      json("langfuse.observation.usage_details", usage),
      // agent/error relays surface as a flagged generation, never as noise elsewhere.
      str("langfuse.observation.level", trace.errorNotes.length ? "ERROR" : null),
      str("langfuse.observation.status_message", trace.errorNotes.length ? trace.errorNotes.join(" | ") : null),
    ] as Array<OtlpAttribute | null>
  ).filter((candidate): candidate is OtlpAttribute => candidate !== null);
  return {
    traceId,
    spanId: randomBytes(8).toString("hex"),
    parentSpanId,
    name: "dsh.assistant",
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: unixNano(trace.startedAtMs),
    endTimeUnixNano: unixNano(trace.endedAtMs),
    attributes: [...identity, ...attributes],
  };
}

function traceIdOf(raw: string): string {
  const hex = raw.replace(/-/g, "");
  return /^[0-9a-f]{32}$/.test(hex) ? hex : randomUUID().replaceAll("-", "");
}

/**
 * One-trace-one-POST Langfuse OTLP sink. Enqueueing is non-blocking and
 * fire-and-forget: network failures and non-OK responses only warn, never
 * throw, never retry. shutdown() waits (within a budget) for in-flight
 * requests, so a graceful harness teardown does not cut off the last turn.
 */
export class OtlpTraceSink {
  private readonly options: SinkOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: SinkLogger;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    options: SinkOptions,
    deps: { fetch?: typeof fetch; logger?: SinkLogger; nextId?: () => string } = {},
  ) {
    this.options = options;
    this.fetchImpl = deps.fetch ?? globalThis.fetch;
    this.logger = deps.logger ?? console;
  }

  /** Number of traces currently on the wire. */
  pendingCount(): number {
    return this.inFlight.size;
  }

  /** Boundary hint from session/flush; v1 sends per trace, so this is a no-op. */
  flushHint(): void {}

  /** Fire-and-forget: never throws, never blocks the session event loop. */
  enqueue(trace: TurnTrace): void {
    const promise = this.send(trace);
    this.inFlight.add(promise);
    void promise.finally(() => {
      this.inFlight.delete(promise);
    });
  }

  /** Wait for in-flight requests within the budget; failures were already warned. */
  async shutdown(timeoutMs = this.options.timeoutMs): Promise<void> {
    if (this.inFlight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        // allSettled accepts the Set directly; it never rejects.
        Promise.allSettled(this.inFlight),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private url(): string {
    return `${this.options.baseUrl.replace(/\/+$/, "")}/api/public/otel/v1/traces`;
  }

  private buildDocument(trace: TurnTrace): unknown {
    const traceId = traceIdOf(trace.traceId);
    const rootSpanId = randomBytes(8).toString("hex");
    const identity = traceIdentityAttributes(trace.sessionId, this.options, BASE_TAGS);
    const metadata = {
      "session.id": trace.sessionId,
      turn: trace.turnNumber,
      toolCount: trace.tools.length,
      environment: this.options.environment,
      userId: this.options.userId ?? null,
      endReason: trace.endReason,
      plugin: PLUGIN_VERSION,
    };
    const metadataAttributes = Object.entries(metadata)
      .filter(([, value]) => value !== null && value !== undefined)
      .map<OtlpAttribute>(([key, value]) =>
        typeof value === "number"
          ? { key: `langfuse.trace.metadata.${key}`, value: { intValue: String(value) } }
          : { key: `langfuse.trace.metadata.${key}`, value: { stringValue: String(value) } },
      );

    const rootSpan: OtlpSpan = {
      traceId,
      spanId: rootSpanId,
      name: TRACE_NAME,
      kind: "SPAN_KIND_INTERNAL",
      startTimeUnixNano: unixNano(trace.startedAtMs),
      endTimeUnixNano: unixNano(trace.endedAtMs),
      attributes: (
        [
          ...identity,
          json("langfuse.trace.input", chat(trace.prompt, "user")),
          json("langfuse.trace.output", chat(trace.assistantMessage, "assistant")),
          ...metadataAttributes,
        ] as Array<OtlpAttribute | null>
      ).filter((candidate): candidate is OtlpAttribute => candidate !== null),
    };

    const spans: OtlpSpan[] = [
      rootSpan,
      ...trace.tools.map((tool) => toolSpan(traceId, rootSpanId, tool, identity)),
    ];
    const generation = generationSpan(traceId, rootSpanId, trace, identity);
    if (generation) spans.push(generation);

    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "dsh" } },
              { key: "service.version", value: { stringValue: PLUGIN_VERSION } },
              { key: "telemetry.sdk.name", value: { stringValue: PLUGIN_NAME } },
              { key: "telemetry.sdk.language", value: { stringValue: "javascript" } },
              { key: "telemetry.sdk.version", value: { stringValue: PLUGIN_VERSION } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
              spans,
            },
          ],
        },
      ],
    };
  }

  private async send(trace: TurnTrace): Promise<void> {
    const body = JSON.stringify(this.buildDocument(trace));
    try {
      const response = await this.fetchImpl(this.url(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            `${this.options.publicKey}:${this.options.secretKey}`,
          ).toString("base64")}`,
        },
        body,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!response.ok) {
        this.logger.warn(
          `langfuse: export failed with HTTP ${response.status}${this.options.debug ? `: ${await safeText(response)}` : ""}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `langfuse: export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable>";
  }
}
