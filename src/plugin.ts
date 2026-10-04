import { Service, type Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { resolveCredentials } from "./credentials.js";
import { OtlpTraceSink } from "./otlp-sink.js";
import { TurnTracker, type SessionEventInput } from "./turn-tracker.js";
import type { TurnTrace } from "./domain/trace.js";

/** Resolved shape of `LangfusePlugin.Config` (see the schema below). */
export interface LangfuseConfig {
  /** Langfuse project public key; environment/file fallback is supported. */
  publicKey?: string;
  /** Langfuse project secret key; environment/file fallback is supported. */
  secretKey?: string;
  baseUrl: string;
  environment: string;
  userId?: string;
  capturePrompts: boolean;
  timeoutMs: number;
  debug: boolean;
}

export interface TraceSinkContract {
  enqueue(trace: TurnTrace): void;
  flushHint(): void;
  shutdown(timeoutMs?: number): Promise<void>;
}

/**
 * Minimal structural view of the composing context. The real cordis Context
 * is a proxy augmented by the dsh session store (`sessions`) and the event
 * bus (`on`) — everything wireLangfuse touches.
 */
export interface WireContext {
  logger: { warn(message: string): void };
  sessions: { list(): Iterable<{ id: unknown }> };
  on(name: "session/created", handler: (session: { id: unknown }) => void): void;
  on(name: "session/event", handler: (session: { id: unknown }, event: SessionEventInput) => void): void;
  on(name: "session/flush", handler: (session: { id: unknown }) => void): void;
  on(name: "session/disposed", handler: (session: { id: unknown }) => void): void;
  on(
    name: "agent/error",
    handler: (payload: {
      agent?: { session?: { id: unknown } };
      turn?: unknown;
      step?: unknown;
      error: unknown;
    }) => void,
  ): void;
  effect(dispose: () => unknown, name?: string): void;
}

export interface WireDeps {
  /** Defaults to resolveCredentials(process.env). */
  credentials?: { publicKey: string; secretKey: string } | null;
  sink?: TraceSinkContract;
  tracker?: TurnTracker;
}

/**
 * Install the Langfuse capture side onto a context, in the
 * dsh-session-telemetry coordinator's containment style: every subscription
 * is self-contained (cordis `emit` is stop-on-throw — a throwing listener
 * would starve every subscriber registered after this plugin), and teardown
 * drains the sink through a named effect. Without credentials the plugin
 * disables itself silently (one debug-level warning at most).
 */
export function wireLangfuse(ctx: WireContext, config: LangfuseConfig, deps: WireDeps = {}): void {
  const configuredCredentials =
    config.publicKey?.trim() && config.secretKey?.trim()
      ? { publicKey: config.publicKey.trim(), secretKey: config.secretKey.trim() }
      : null;
  const credentials =
    deps.credentials !== undefined
      ? deps.credentials
      : configuredCredentials ?? resolveCredentials({ env: process.env });
  if (!credentials) {
    if (config.debug) {
      ctx.logger.warn(
        "langfuse: no credentials found (LANGFUSE_PUBLIC_KEY/SECRET_KEY env or $DSH_HOME/langfuse.json); plugin disabled",
      );
    }
    return;
  }

  const sink: TraceSinkContract =
    deps.sink ??
    new OtlpTraceSink({
      baseUrl: config.baseUrl,
      publicKey: credentials.publicKey,
      secretKey: credentials.secretKey,
      environment: config.environment,
      ...(config.userId !== undefined ? { userId: config.userId } : {}),
      timeoutMs: config.timeoutMs,
      debug: config.debug,
    });
  const tracker =
    deps.tracker ?? new TurnTracker({ sink, capturePrompts: config.capturePrompts });

  // cordis emit is stop-on-throw; nothing from this plugin may escape a handler.
  const contain = (what: string, step: () => void): void => {
    try {
      step();
    } catch (error) {
      ctx.logger.warn(`langfuse: ${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const adopt = (session: { id: unknown }): void =>
    contain("session/created", () => tracker.adopt(String(session.id)));

  ctx.on("session/created", adopt);
  // A hot reload does not replay session/created: sweep already-live sessions.
  for (const session of ctx.sessions.list()) adopt(session);
  ctx.on("session/event", (session, event) =>
    contain("session/event", () => tracker.ingest(String(session.id), event)),
  );
  ctx.on("session/flush", () => contain("session/flush", () => sink.flushHint()));
  ctx.on("session/disposed", (session) =>
    contain("session/disposed", () => tracker.drop(String(session.id))),
  );
  ctx.on("agent/error", (payload) =>
    contain("agent/error", () => {
      const sessionId = payload.agent?.session?.id;
      if (sessionId === undefined || sessionId === null) return;
      tracker.annotate(String(sessionId), {
        turn: payload.turn,
        step: payload.step,
        error: payload.error,
      });
    }),
  );

  ctx.effect(() => async () => {
    try {
      await sink.shutdown(config.timeoutMs);
    } catch (error) {
      ctx.logger.warn(`langfuse: sink shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, "langfuse sink");
}

/**
 * Native dsh cordis bundle: one Langfuse trace per completed agent turn.
 * Mounts via the bundle's `cordis.patch.yml` row (`name: dsh-langfuse-plugin`).
 */
export default class LangfusePlugin extends Service {
  static inject = ["sessions"];
  // The vendored schemastery has no `.optional()`: object fields are optional
  // by default (a missing key resolves to undefined), `.default()` supplies
  // fallbacks. The resolved shape matches the SPEC contract exactly.
  static Config = z.object({
    publicKey: z.string(),
    secretKey: z.string().role("secret"),
    baseUrl: z.string().default("https://cloud.langfuse.com"),
    environment: z.string().default("development"),
    userId: z.string(),
    capturePrompts: z.boolean().default(true),
    timeoutMs: z.number().default(30_000),
    debug: z.boolean().default(false),
  });

  constructor(ctx: Context, config: LangfuseConfig) {
    super(ctx, "dsh-langfuse-plugin");
    wireLangfuse(ctx as unknown as WireContext, config);
  }
}
