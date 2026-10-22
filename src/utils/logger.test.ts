import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { withDeniedEnv } from "../../test/env.ts";

const ENV_VAR = "HUUMA_LOG_LEVEL";
const HUUMA_ENV = "HUUMA_ENV";

type Logger = typeof import("./logger.ts");
type Environment = typeof import("./environment.ts");

// Each test gets fresh logger and environment modules, so the lazily resolved
// level, `setLogLevel` calls and `setEnv` overrides don't leak between tests.
async function load(): Promise<{ logger: Logger; environment: Environment }> {
  vi.resetModules();
  return {
    logger: await import("./logger.ts"),
    environment: await import("./environment.ts"),
  };
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
    vi.spyOn(console, name).mockImplementation(() => {
      calls[name]++;
    }),
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

describe("Logger colors", () => {
  const COLOR_ENV = ["NO_COLOR", "FORCE_COLOR"];
  let saved: Record<string, string | undefined>;
  let isTTY: { stdout?: boolean; stderr?: boolean };

  beforeEach(() => {
    saved = Object.fromEntries(
      COLOR_ENV.map((name) => [name, process.env[name]]),
    );
    COLOR_ENV.forEach((name) => delete process.env[name]);
    isTTY = { stdout: process.stdout.isTTY, stderr: process.stderr.isTTY };
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.stdout.isTTY = isTTY.stdout as boolean;
    process.stderr.isTTY = isTTY.stderr as boolean;
  });

  function terminal(stdout: boolean, stderr: boolean): void {
    process.stdout.isTTY = stdout;
    process.stderr.isTTY = stderr;
  }

  // Logs one line at `level` and returns it as written to the console.
  async function line(level: "info" | "error" = "error"): Promise<string> {
    const { logger } = await load();
    const sink = vi.spyOn(console, level).mockImplementation(() => {});
    try {
      logger[level]("CTX", "message");
      return String(sink.mock.calls[0][0]);
    } finally {
      sink.mockRestore();
    }
  }

  it("colors output on a terminal", async () => {
    terminal(true, true);
    expect(await line()).toContain("\x1b[31mHuuma/Route\x1b[0m");
    expect(await line("info")).toContain("\x1b[32mHuuma/Route\x1b[0m");
  });

  it("writes plain text when the output isn't a terminal", async () => {
    terminal(false, false);
    expect(await line()).toMatch(
      /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2} Huuma\/Route CTX message$/,
    );
  });

  it("checks stderr for warnings and errors, stdout for the rest", async () => {
    // `app 2> errors.log` on a terminal
    terminal(true, false);
    expect(await line("error")).not.toContain("\x1b[");
    expect(await line("info")).toContain("\x1b[");

    // `app > app.log` on a terminal
    terminal(false, true);
    expect(await line("error")).toContain("\x1b[");
    expect(await line("info")).not.toContain("\x1b[");
  });

  it("follows NO_COLOR", async () => {
    terminal(true, true);
    process.env.NO_COLOR = "1";
    expect(await line()).not.toContain("\x1b[");
  });

  it("follows FORCE_COLOR", async () => {
    terminal(false, false);
    process.env.FORCE_COLOR = "1";
    expect(await line()).toContain("\x1b[");
    process.env.FORCE_COLOR = "0";
    expect(await line()).not.toContain("\x1b[");
  });
});
