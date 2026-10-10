import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "bun:test";

// Exports that may use node:* built-ins. Everything else is the runtime-neutral
// core and must bundle for any platform, including Cloudflare Workers without
// `nodejs_compat`.
const NODE_EXPORTS = /^\.\/(node|http\/tasks\/)/;

const { exports } = JSON.parse(
  await readFile(new URL("../jsr.json", import.meta.url), "utf8"),
) as { exports: Record<string, string> };

const coreExports = Object.entries(exports).filter(([name]) =>
  !NODE_EXPORTS.test(name)
);

describe("runtime-neutral core", () => {
  it.each(coreExports)(
    "bundles %s without node: or Deno references",
    async (_, path) => {
      const result = await build({
        entryPoints: [new URL(`../${path}`, import.meta.url).pathname],
        bundle: true,
        platform: "neutral",
        format: "esm",
        write: false,
        logLevel: "silent",
        // Drops comments, so only code references are checked.
        minifyWhitespace: true,
      });
      const code = result.outputFiles[0].text;
      expect(code).not.toMatch(/["']node:/);
      expect(code).not.toMatch(/\bDeno\b/);
    },
  );

  it("covers the main entry and middleware", () => {
    const names = coreExports.map(([name]) => name);
    expect(names).toContain(".");
    expect(names).toContain("./middleware");
  });
});
