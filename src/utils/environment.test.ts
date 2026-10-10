import { afterEach, describe, expect, it } from "bun:test";
import {
  isEnvironment,
  isProd,
  setEnv,
  setEnvironment,
} from "./environment.ts";
import { withDeniedEnv } from "../../test/env.ts";

const HUUMA_ENV = "HUUMA_ENV";

function withEnvironment(value: string, fn: () => void): void {
  const original = process.env[HUUMA_ENV];
  process.env[HUUMA_ENV] = value;
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env[HUUMA_ENV];
    } else {
      process.env[HUUMA_ENV] = original;
    }
  }
}

afterEach(() => setEnv({ [HUUMA_ENV]: undefined }));

describe("isProd", () => {
  it("returns false outside production", () => {
    withEnvironment("STAGING", () => expect(isProd()).toBe(false));
  });

  it("returns true in production", () => {
    withEnvironment("PROD", () => expect(isProd()).toBe(true));
  });
});

describe("isEnvironment", () => {
  it("returns true for the active environment", () => {
    withEnvironment(
      "STAGING",
      () => expect(isEnvironment("STAGING")).toBe(true),
    );
  });

  it("returns false for another environment", () => {
    withEnvironment("STAGING", () => expect(isEnvironment("PROD")).toBe(false));
  });
});

describe("setEnv", () => {
  it("takes precedence over process.env", () => {
    withEnvironment("STAGING", () => {
      setEnv({ [HUUMA_ENV]: "PROD" });
      expect(isProd()).toBe(true);
    });
  });

  it("falls back to process.env once an override is removed", () => {
    withEnvironment("STAGING", () => {
      setEnv({ [HUUMA_ENV]: "PROD" });
      setEnv({ [HUUMA_ENV]: undefined });
      expect(isEnvironment("STAGING")).toBe(true);
    });
  });

  it("setEnvironment sets HUUMA_ENV", () => {
    setEnvironment("PROD");
    expect(isProd()).toBe(true);
  });
});

describe("environment detection without env access", () => {
  it("returns false when env access is denied", () => {
    withDeniedEnv(() => {
      expect(isProd()).toBe(false);
      expect(isEnvironment("PROD")).toBe(false);
    });
  });

  it("still reads values set with setEnv", () => {
    setEnvironment("PROD");
    withDeniedEnv(() => expect(isProd()).toBe(true));
  });
});
