type Process = { env: Record<string, string | undefined> };

/**
 * Reads an environment variable from the global `process` (Deno, Node, Bun),
 * returning `undefined` when env access is unavailable.
 */
export function readEnv(name: string): string | undefined {
  try {
    return (globalThis as { process?: Process }).process?.env[name];
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
