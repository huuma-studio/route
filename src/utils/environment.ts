import { readEnv } from "./read-env.ts";

const HUUMA_ENV = "HUUMA_ENV";

/** Returns whether `HUUMA_ENV` is `PROD`, or `false` when env access is unavailable. */
export function isProd(): boolean {
  return readEnv(HUUMA_ENV) === "PROD";
}

/** Returns whether `HUUMA_ENV` matches `name`, or `false` when env access is unavailable. */
export function isEnvironment(name: string): boolean {
  return readEnv(HUUMA_ENV) === name;
}
