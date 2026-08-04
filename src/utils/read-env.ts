/** Reads an environment variable, returning `undefined` when env access is unavailable. */
export function readEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch (error) {
    if (
      error instanceof Deno.errors.NotCapable ||
      (error instanceof Error && error.name === "PermissionDenied")
    ) {
      return undefined;
    }
    throw error;
  }
}
