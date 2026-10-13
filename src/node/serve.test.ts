// Uses node:test so the adapter runs on real Node.js (`bun run test:node`)
// as well as on Bun (`bun test`).
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import { App } from "../app.ts";
import { type NodeServer, serve } from "./serve.ts";

let server: NodeServer | undefined;

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
});

async function start(app: Parameters<typeof serve>[0]): Promise<string> {
  server = await serve(app, { port: 0, hostname: "127.0.0.1" });
  return `http://127.0.0.1:${server.port}`;
}

// Sends a raw HTTP/1.1 request, so the path and Host header reach the server
// exactly as given (fetch would normalize them).
function rawGet(
  base: string,
  path: string,
  headers?: Record<string, string>,
  method = "GET",
): Promise<string> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname, port, path, headers, method },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => resolve(body));
      },
    );
    req.once("error", reject);
    req.end();
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const echoUrl = {
  fetch: (request: Request) => {
    const url = new URL(request.url);
    return new Response(`${url.host} ${url.pathname}`);
  },
};

describe("serve", () => {
  it("serves an app", async () => {
    const app = new App();
    app.get(
      "/hello/:name",
      (ctx) => new Response(`Hello ${ctx.params?.name}`),
    );
    const base = await start(app);

    const response = await fetch(`${base}/hello/node?x=1`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "Hello node");
  });

  it("passes the client address as the connection", async () => {
    const app = new App();
    app.get("/", (ctx) => Response.json(ctx.connection.remoteAddr));
    const base = await start(app);

    const remoteAddr = await (await fetch(base)).json();
    assert.equal(remoteAddr.transport, "tcp");
    assert.match(remoteAddr.hostname, /^(::ffff:)?127\.0\.0\.1$/);
    assert.equal(typeof remoteAddr.port, "number");
  });

  it("streams request bodies and keeps request headers", async () => {
    const app = new App();
    app.post("/echo", async (ctx) =>
      new Response(await ctx.request.text(), {
        headers: { "X-Echo": ctx.request.headers.get("X-Custom") ?? "" },
      }));
    const base = await start(app);

    const response = await fetch(`${base}/echo`, {
      method: "POST",
      headers: { "X-Custom": "value", "Content-Type": "text/plain" },
      body: "a".repeat(100_000),
    });
    assert.equal(response.headers.get("X-Echo"), "value");
    assert.equal((await response.text()).length, 100_000);
  });

  it("streams response bodies", async () => {
    const app = new App();
    app.get("/stream", () => {
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i === 3) return controller.close();
          controller.enqueue(new TextEncoder().encode(`chunk${i++};`));
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/plain" } });
    });
    const base = await start(app);

    const response = await fetch(`${base}/stream`);
    assert.equal(response.headers.get("Transfer-Encoding"), "chunked");
    assert.equal(await response.text(), "chunk0;chunk1;chunk2;");
  });

  it("sends multiple Set-Cookie headers", async () => {
    const app = new App();
    app.get("/cookies", () => {
      const headers = new Headers();
      headers.append("Set-Cookie", "a=1; Path=/");
      headers.append("Set-Cookie", "b=2; HttpOnly");
      return new Response(null, { status: 204, headers });
    });
    const base = await start(app);

    const response = await fetch(`${base}/cookies`);
    assert.equal(response.status, 204);
    assert.deepEqual(response.headers.getSetCookie(), [
      "a=1; Path=/",
      "b=2; HttpOnly",
    ]);
  });

  it("aborts the request signal and cancels the body when the client disconnects", async () => {
    const app = new App();
    let aborted!: Promise<void>;
    let cancelled!: Promise<void>;
    app.get("/slow", (ctx) => {
      aborted = new Promise((resolve) =>
        ctx.request.signal.addEventListener("abort", () => resolve())
      );
      let markCancelled!: () => void;
      cancelled = new Promise((resolve) => markCancelled = resolve);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("first"));
        },
        cancel: () => markCancelled(),
      });
      return new Response(body);
    });
    const base = await start(app);

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(`${base}/slow`, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.once("error", (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") {
          reject(error);
        }
      });
      req.end();
    });

    // Both resolve only when the adapter reacts to the disconnect; otherwise
    // the test times out.
    await aborted;
    await cancelled;
  });

  it("keeps a path that starts with // instead of reading it as a host", async () => {
    const base = await start(echoUrl);
    const { host } = new URL(base);
    assert.equal(await rawGet(base, "//foo/bar"), `${host} //foo/bar`);
  });

  it("routes OPTIONS * to the path /*", {
    // Bun's HTTP server answers asterisk-form requests with 400 before any
    // JavaScript runs, so only real Node.js can pass this to the adapter.
    skip: "Bun" in globalThis && "Bun rejects OPTIONS * itself",
  }, async () => {
    const app = new App();
    app.options("/*", (ctx) => new Response(new URL(ctx.request.url).pathname));
    const base = await start(app);
    assert.equal(await rawGet(base, "*", undefined, "OPTIONS"), "/*");
  });

  it("ignores a Host header that would change the path", async () => {
    const base = await start(echoUrl);
    assert.equal(
      await rawGet(base, "/page", { Host: "example.com/admin" }),
      "localhost /page",
    );
  });

  it("fails only the request when the handler returns Response.error()", async () => {
    let calls = 0;
    const base = await start({
      fetch: () => calls++ === 0 ? Response.error() : new Response("ok"),
    });
    const consoleError = console.error;
    console.error = () => {};
    try {
      assert.equal((await fetch(base)).status, 500);
    } finally {
      console.error = consoleError;
    }
    assert.equal(await (await fetch(base)).text(), "ok");
  });

  it("returns 500 when the handler throws", async () => {
    const failing = {
      fetch: () => Promise.reject(new Error("handler failed")),
    };
    server = await serve(failing, { port: 0, hostname: "127.0.0.1" });
    const consoleError = console.error;
    console.error = () => {};
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      assert.equal(response.status, 500);
    } finally {
      console.error = consoleError;
    }
  });

  it("rejects without listening when the signal is already aborted", async () => {
    const port = await freePort();
    await assert.rejects(
      serve(new App(), { port, signal: AbortSignal.abort() }),
      { name: "AbortError" },
    );
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  });

  it("closes the server when the signal aborts during startup", async () => {
    const port = await freePort();
    const controller = new AbortController();
    const starting = serve(new App(), {
      port,
      hostname: "127.0.0.1",
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(starting, { name: "AbortError" });
    await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
  });

  it("stops when the signal is aborted", async () => {
    const app = new App();
    app.get("/", () => new Response("ok"));
    const controller = new AbortController();
    const started = await serve(app, {
      port: 0,
      hostname: "127.0.0.1",
      signal: controller.signal,
    });
    const response = await fetch(`http://127.0.0.1:${started.port}/`);
    assert.equal(response.status, 200);
    await response.body?.cancel();

    controller.abort();
    await started.finished;
    await assert.rejects(fetch(`http://127.0.0.1:${started.port}/`));
  });
});
