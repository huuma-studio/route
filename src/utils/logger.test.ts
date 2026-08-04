import { assert } from "@std/assert";
import { isProd } from "./environment.ts";
import {
  debug,
  error,
  fatal,
  getLogLevel,
  info,
  log,
  LogLevel,
  setLogLevel,
  trace,
  warn,
} from "./logger.ts";

const ENV_VAR = "HUUMA_LOG_LEVEL";
const HUUMA_ENV = "HUUMA_ENV";

function resetLogLevel() {
  Deno.env.delete(ENV_VAR);
  setLogLevel(isProd() ? LogLevel.INFO : LogLevel.DEBUG);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
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
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = () => calls.log++;
  console.info = () => calls.info++;
  console.warn = () => calls.warn++;
  console.error = () => calls.error++;
  try {
    fn();
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
  return calls;
}

Deno.test({
  name: "defaults to DEBUG when env permission is denied",
  permissions: { env: false },
  async fn() {
    const logger = await import("./logger.ts?env-permission-denied");
    assert(logger.getLogLevel() === logger.LogLevel.DEBUG);
  },
});

Deno.test("log level", async (t) => {
  const originalLogLevel = getLogLevel();
  const originalLogLevelEnv = Deno.env.get(ENV_VAR);
  const originalHuumaEnv = Deno.env.get(HUUMA_ENV);

  try {
    await t.step("defaults to DEBUG when not in prod and no env var", () => {
      Deno.env.delete(ENV_VAR);
      Deno.env.set(HUUMA_ENV, "DEV");
      setLogLevel(isProd() ? LogLevel.INFO : LogLevel.DEBUG);
      assert(getLogLevel() === LogLevel.DEBUG);
      resetLogLevel();
    });

    await t.step("defaults to INFO in prod when no env var", () => {
      Deno.env.delete(ENV_VAR);
      Deno.env.set(HUUMA_ENV, "PROD");
      setLogLevel(isProd() ? LogLevel.INFO : LogLevel.DEBUG);
      assert(getLogLevel() === LogLevel.INFO);
      resetLogLevel();
    });

    await t.step("setLogLevel takes effect at runtime", () => {
      setLogLevel(LogLevel.WARN);
      assert(getLogLevel() === LogLevel.WARN);
      resetLogLevel();
    });

    await t.step("only emits at or above the configured level", () => {
      setLogLevel(LogLevel.WARN);
      const calls = withCountedSinks(() => {
        trace("CTX", "trace msg");
        debug("CTX", "debug msg");
        info("CTX", "info msg");
        warn("CTX", "warn msg");
        error("CTX", "error msg");
        fatal("CTX", "fatal msg");
      });

      assert(calls.log === 0); // trace/debug below WARN
      assert(calls.info === 0); // info below WARN
      assert(calls.warn === 1); // warn emitted
      assert(calls.error === 2); // error and fatal emitted
      resetLogLevel();
    });

    await t.step("emits all levels at TRACE threshold", () => {
      setLogLevel(LogLevel.TRACE);
      const calls = withCountedSinks(() => {
        trace("CTX", "trace msg");
        debug("CTX", "debug msg");
        info("CTX", "info msg");
        warn("CTX", "warn msg");
        error("CTX", "error msg");
        fatal("CTX", "fatal msg");
      });

      // trace + debug both route to console.log
      assert(calls.log === 2);
      assert(calls.info === 1);
      assert(calls.warn === 1);
      assert(calls.error === 2);
      resetLogLevel();
    });

    await t.step("nothing is emitted when level is above FATAL", () => {
      // Use a value higher than any real level to suppress everything.
      setLogLevel(LogLevel.FATAL + 1);
      const calls = withCountedSinks(() => {
        trace("CTX", "trace msg");
        debug("CTX", "debug msg");
        info("CTX", "info msg");
        warn("CTX", "warn msg");
        error("CTX", "error msg");
        fatal("CTX", "fatal msg");
      });

      assert(calls.log === 0);
      assert(calls.info === 0);
      assert(calls.warn === 0);
      assert(calls.error === 0);
      resetLogLevel();
    });

    await t.step("`log` is a debug alias", () => {
      setLogLevel(LogLevel.DEBUG);
      const calls = withCountedSinks(() => log("CTX", "log msg"));
      assert(calls.log === 1);
      resetLogLevel();
    });
  } finally {
    restoreEnv(ENV_VAR, originalLogLevelEnv);
    restoreEnv(HUUMA_ENV, originalHuumaEnv);
    setLogLevel(originalLogLevel);
  }
});
