import process from "node:process";

/**
 * Runs `fn` while reading `process.env` throws like Deno does without
 * `--allow-env` (`NotCapable`).
 */
export function withDeniedEnv<T>(fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, "env")!;
  Object.defineProperty(process, "env", {
    configurable: true,
    get() {
      const error = new Error("Requires env access");
      error.name = "NotCapable";
      throw error;
    },
  });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, "env", descriptor);
  }
}
