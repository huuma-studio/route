import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { withDeniedEnv } from "../../test/env.ts";

const ENV_VAR = "HUUMA_LOG_LEVEL";
const HUUMA_ENV = "HUUMA_ENV";

import * as environment from "./environment.ts";

type Logger = typeof import("./logger.ts");

let instance = 0;

// Each test gets a fresh logger module (Bun creates a new instance per query
// string), so the lazily resolved level and `setLogLevel` calls don't leak
// between tests. `setEnv` overrides are shared and cleared after each test.
async function load(): Promise<
  { logger: Logger; environment: typeof environment }
> {
  const logger: Logger = await import(`./logger.ts?test=${instance++}`);
  return { logger, environment };
}

type SinkName = "log" | "info" | "warn" | "error";

// Replaces the four console sinks with counters, runs `fn`, then restores them.
function withCountedSinks(fn: () => void): Record<SinkName, number> {
  const calls: Record<SinkName, number> = {
    log: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  const spies = (Object.keys(calls) as SinkName[]).map((name) =>
    spyOn(console, name).mockImplementation(() => {
      calls[name]++;
    })
  );
  try {
    fn();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return calls;
}

function emitAll(logger: Logger): void {
  logger.trace("CTX", "trace msg");
  logger.debug("CTX", "debug msg");
  logger.info("CTX", "info msg");
  logger.warn("CTX", "warn msg");
  logger.error("CTX", "error msg");
  logger.fatal("CTX", "fatal msg");
}

let original: Record<string, string | undefined>;

beforeEach(() => {
  original = {
    [ENV_VAR]: process.env[ENV_VAR],
    [HUUMA_ENV]: process.env[HUUMA_ENV],
  };
  delete process.env[ENV_VAR];
  delete process.env[HUUMA_ENV];
});

afterEach(() => {
  environment.setEnv({ [ENV_VAR]: undefined, [HUUMA_ENV]: undefined });
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("log level", () => {
  it("defaults to DEBUG when not in prod and no env var", async () => {
    process.env[HUUMA_ENV] = "DEV";
    const { logger } = await load();
    expect(logger.getLogLevel()).toBe(logger.LogLevel.DEBUG);
  });

  it("defaults to INFO in prod when no env var", async () => {
    process.env[HUUMA_ENV] = "PROD";
    const { logger } = await load();
    expect(logger.getLogLevel()).toBe(logger.LogLevel.INFO);
  });

  it("reads HUUMA_LOG_LEVEL case-insensitively", async () => {
    process.env[ENV_VAR] = "warn";
    const { logger } = await load();
    expect(logger.getLogLevel()).toBe(logger.LogLevel.WARN);
  });

  it("defaults to DEBUG when env access is denied", async () => {
    const { logger } = await load();
    withDeniedEnv(() => {
      expect(logger.getLogLevel()).toBe(logger.LogLevel.DEBUG);
    });
  });

  it("resolves the level on first use instead of at import", async () => {
    const { logger } = await load();
    process.env[ENV_VAR] = "ERROR";
    expect(logger.getLogLevel()).toBe(logger.LogLevel.ERROR);
  });

  it("re-resolves the level after setEnv", async () => {
    const { logger, environment } = await load();
    expect(logger.getLogLevel()).toBe(logger.LogLevel.DEBUG);

    environment.setEnv({ [ENV_VAR]: "WARN" });
    expect(logger.getLogLevel()).toBe(logger.LogLevel.WARN);

    environment.setEnv({ [ENV_VAR]: undefined, [HUUMA_ENV]: "PROD" });
    expect(logger.getLogLevel()).toBe(logger.LogLevel.INFO);
  });

  it("setLogLevel takes precedence over the environment", async () => {
    const { logger, environment } = await load();
    logger.setLogLevel(logger.LogLevel.WARN);
    environment.setEnv({ [ENV_VAR]: "TRACE" });
    expect(logger.getLogLevel()).toBe(logger.LogLevel.WARN);
  });

  it("only emits at or above the configured level", async () => {
    const { logger } = await load();
    logger.setLogLevel(logger.LogLevel.WARN);
    const calls = withCountedSinks(() => emitAll(logger));

    expect(calls.log).toBe(0); // trace/debug below WARN
    expect(calls.info).toBe(0); // info below WARN
    expect(calls.warn).toBe(1); // warn emitted
    expect(calls.error).toBe(2); // error and fatal emitted
  });

  it("emits all levels at TRACE threshold", async () => {
    const { logger } = await load();
    logger.setLogLevel(logger.LogLevel.TRACE);
    const calls = withCountedSinks(() => emitAll(logger));

    // trace + debug both route to console.log
    expect(calls).toEqual({ log: 2, info: 1, warn: 1, error: 2 });
  });

  it("nothing is emitted when level is above FATAL", async () => {
    const { logger } = await load();
    // Use a value higher than any real level to suppress everything.
    logger.setLogLevel(logger.LogLevel.FATAL + 1);
    const calls = withCountedSinks(() => emitAll(logger));

    expect(calls).toEqual({ log: 0, info: 0, warn: 0, error: 0 });
  });

  it("`log` is a debug alias", async () => {
    const { logger } = await load();
    logger.setLogLevel(logger.LogLevel.DEBUG);
    const calls = withCountedSinks(() => logger.log("CTX", "log msg"));
    expect(calls.log).toBe(1);
  });
});
