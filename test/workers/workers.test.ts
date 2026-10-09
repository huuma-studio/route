import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Since compatibility date 2026-08-04, Node.js compatibility is on by default;
// both flags are needed to run without it, like a Worker without `nodejs_compat`.
const COMPATIBILITY_DATE = "2026-10-01";
const COMPATIBILITY_FLAGS = ["no_nodejs_compat", "no_nodejs_compat_v2"];

let mf: Miniflare;
let url: URL;

// Miniflare's `dispatchFetch` doesn't work under Bun, so requests go to its
// local server instead.
function request(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, url), init);
}

beforeAll(async () => {
  const result = await build({
    entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
    bundle: true,
    platform: "neutral",
    format: "esm",
    write: false,
    logLevel: "silent",
  });
  mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: result.outputFiles[0].text,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: COMPATIBILITY_FLAGS,
    bindings: { HUUMA_ENV: "PROD", GREETING: "hello from env" },
  }));
  url = await mf.ready;
}, 30_000);

afterAll(() => mf?.dispose());

describe("Cloudflare Workers without nodejs_compat", () => {
  it("serves `export default app` with bindings applied from the first request", async () => {
    const response = await request("/", {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Middleware")).toBe("applied");
    expect(await response.json()).toEqual({
      prod: true,
      logLevel: "INFO",
      greeting: "hello from env",
      remoteAddr: { transport: "tcp", hostname: "203.0.113.7" },
      process: "undefined",
    });
  });

  it("turns a thrown HttpException into its status", async () => {
    const response = await request("/error");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "invalid input" });
  });

  it("returns 404 for unknown routes", async () => {
    const response = await request("/missing");
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });

  it("runs work passed to ctx.waitUntil after the response", async () => {
    const response = await request("/wait");
    expect(await response.text()).toBe("scheduled");

    let runs = 0;
    for (let attempt = 0; attempt < 40 && runs === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const background = await request("/background");
      runs = (await background.json() as { runs: number }).runs;
    }
    expect(runs).toBe(1);
  });
});
