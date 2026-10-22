import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vite-plus/test";

const { exports } = JSON.parse(
  await readFile(new URL("../jsr.json", import.meta.url), "utf8"),
) as { exports: Record<string, string> };

// Node.js runs TypeScript by stripping types, which fails on syntax that
// needs a transform (enums, parameter properties, `<T>value` assertions).
// tsconfig's erasableSyntaxOnly catches it while editing; this checks that
// every export really loads. Bun transpiles everything, so it can't tell.
describe.skipIf("Bun" in globalThis)("Node.js type stripping", () => {
  it.each(Object.entries(exports))("loads %s", async (_, path) => {
    const { stderr } = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "--no-warnings",
      "-e",
      `await import(${JSON.stringify(new URL(`../${path}`, import.meta.url).href)})`,
    ]);
    expect(stderr).toBe("");
  });
});
