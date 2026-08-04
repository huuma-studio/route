import { assert } from "@std/assert";
import { isEnvironment, isProd } from "./environment.ts";

const HUUMA_ENV = "HUUMA_ENV";

function withEnvironment(value: string, fn: () => void): void {
  const original = Deno.env.get(HUUMA_ENV);
  Deno.env.set(HUUMA_ENV, value);
  try {
    fn();
  } finally {
    if (original === undefined) {
      Deno.env.delete(HUUMA_ENV);
    } else {
      Deno.env.set(HUUMA_ENV, original);
    }
  }
}

Deno.test("isProd", async (t) => {
  await t.step("returns false outside production", () => {
    withEnvironment("STAGING", () => assert(!isProd()));
  });

  await t.step("returns true in production", () => {
    withEnvironment("PROD", () => assert(isProd()));
  });
});

Deno.test(isEnvironment.name, async (t) => {
  await t.step("returns true for the active environment", () => {
    withEnvironment("STAGING", () => assert(isEnvironment("STAGING")));
  });

  await t.step("returns false for another environment", () => {
    withEnvironment("STAGING", () => assert(!isEnvironment("PROD")));
  });
});

Deno.test({
  name: "environment detection returns false without env permission",
  permissions: { env: false },
  fn() {
    assert(!isProd());
    assert(!isEnvironment("PROD"));
  },
});
