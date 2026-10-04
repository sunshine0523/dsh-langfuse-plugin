import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export interface Credentials {
  publicKey: string;
  secretKey: string;
}

export interface CredentialsOptions {
  /** Environment mapping consulted for LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY. */
  env: Record<string, string | undefined>;
  /** Harness home override; defaults to resolveDshHome() (~/.dsh unless $DSH_HOME). */
  dshHome?: string;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Langfuse credential resolution, highest precedence first:
 *   1. `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` from the environment.
 *   2. `langfuse.json` (`{publicKey, secretKey}`) under the harness home.
 * Returns null when neither source yields a usable pair — the plugin then
 * silently disables itself; this function never throws.
 */
export function resolveCredentials(options: CredentialsOptions): Credentials | null {
  const fromEnv: Credentials | null =
    nonEmpty(options.env.LANGFUSE_PUBLIC_KEY) && nonEmpty(options.env.LANGFUSE_SECRET_KEY)
      ? {
          publicKey: nonEmpty(options.env.LANGFUSE_PUBLIC_KEY)!,
          secretKey: nonEmpty(options.env.LANGFUSE_SECRET_KEY)!,
        }
      : null;
  if (fromEnv) return fromEnv;

  try {
    const raw = readFileSync(join(options.dshHome ?? resolveDshHome(), "langfuse.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const publicKey = nonEmpty((parsed as { publicKey?: unknown }).publicKey as string | undefined);
      const secretKey = nonEmpty((parsed as { secretKey?: unknown }).secretKey as string | undefined);
      if (publicKey && secretKey) return { publicKey, secretKey };
    }
  } catch {
    // Missing home, missing file, or corrupt JSON: the plugin stays disabled.
  }
  return null;
}
