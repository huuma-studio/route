type Process = { env?: Record<string, string | undefined> };

const overrides = new Map<string, string>();
let revision = 0;

/**
 * Reads an environment variable. Values set with `setEnv` take precedence over
 * the global `process.env` (Node, Bun, Deno, Workers with `nodejs_compat`).
 * Returns `undefined` when env access is unavailable.
 */
export function readEnv(name: string): string | undefined {
  if (overrides.has(name)) {
    return overrides.get(name);
  }
  try {
    return (globalThis as { process?: Process }).process?.env?.[name];
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotCapable" || error.name === "PermissionDenied")
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Merges `values` into the environment overrides read by `readEnv`.
 * An `undefined` value removes the override for that name.
 */
export function setEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      overrides.delete(name);
    } else {
      overrides.set(name, value);
    }
  }
  revision++;
}

/** Changes whenever `setEnv` is called, so cached env-derived values can be refreshed. */
export function envRevision(): number {
  return revision;
}
