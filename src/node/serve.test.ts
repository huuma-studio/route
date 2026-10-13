import assert from "node:assert/strict";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  connect as connectHttp2,
  createServer as createHttp2Server,
} from "node:http2";
import {
  connect as connectNet,
  createServer as createNetServer,
} from "node:net";
import { App } from "../app.ts";
import { type NodeServer, serve, toRequest, writeResponse } from "./serve.ts";
import { afterEach, describe, it } from "vite-plus/test";

let server: NodeServer | undefined;
const servers: { close(callback: () => void): void }[] = [];

afterEach(async () => {
  await server?.shutdown();
  server = undefined;
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve) => s.close(resolve))),
  );
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
        res.on("data", (chunk) => (body += chunk));
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

// Sends a raw request and resolves with the status line of the response.
function statusLine(base: string, path = "/"): Promise<string> {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = connectNet(Number(port), hostname, () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      );
    });
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (raw += chunk));
    socket.once("end", () => resolve(raw.split("\r\n")[0]));
    socket.once("error", reject);
  });
}

// A request as Node passes it, without a server: only what toRequest reads.
function nodeRequest(init: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  encrypted?: boolean;
}): IncomingMessage {
  const entries = Object.entries(init.headers ?? {});
  return {
    rawHeaders: entries.flat(),
    headers: Object.fromEntries(
      entries.map(([name, value]) => [name.toLowerCase(), value]),
    ),
    method: init.method ?? "GET",
    url: init.url,
    socket: { encrypted: init.encrypted ?? false },
  } as unknown as IncomingMessage;
}

// Serves `handle` with a plain node:http server, outside of serve().
async function listen(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
  const http = createHttpServer(handle);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  servers.push(http);
  return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
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
    app.get("/hello/:name", (ctx) => new Response(`Hello ${ctx.params?.name}`));
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
    app.post(
      "/echo",
      async (ctx) =>
        new Response(await ctx.request.text(), {
          headers: { "X-Echo": ctx.request.headers.get("X-Custom") ?? "" },
        }),
    );
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
        ctx.request.signal.addEventListener("abort", () => resolve()),
      );
      let markCancelled!: () => void;
      cancelled = new Promise((resolve) => (markCancelled = resolve));
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

  // Bun's HTTP server answers asterisk-form requests with 400 before any
  // JavaScript runs, so only real Node.js can pass this to the adapter.
  it.skipIf("Bun" in globalThis)(
    "routes OPTIONS * to the path /*",
    async () => {
      const app = new App();
      app.options(
        "/*",
        (ctx) => new Response(new URL(ctx.request.url).pathname),
      );
      const base = await start(app);
      assert.equal(await rawGet(base, "*", undefined, "OPTIONS"), "/*");
    },
  );

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
      fetch: () => (calls++ === 0 ? Response.error() : new Response("ok")),
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

describe("serve request and response handling", () => {
  it("sends the standard reason phrase when the response has no status text", async () => {
    const base = await start({
      fetch: (request: Request) =>
        new URL(request.url).pathname === "/created"
          ? new Response(null, { status: 201, statusText: "Made" })
          : new Response("ok"),
    });
    assert.equal(await statusLine(base), "HTTP/1.1 200 OK");
    assert.equal(await statusLine(base, "/created"), "HTTP/1.1 201 Made");
  });

  it("answers a malformed request target with 400", async () => {
    const base = await start(echoUrl);
    assert.match(await statusLine(base, "foo"), /^HTTP\/1\.1 400 /);
  });

  it("logs a body that fails while streaming and ends the response", async () => {
    const base = await start({
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
              setTimeout(
                () => controller.error(new Error("render failed")),
                20,
              );
            },
          }),
        ),
    });
    const logged: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => logged.push(...args);
    try {
      await assert.rejects((await fetch(base)).text());
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      console.error = consoleError;
    }
    assert.match(String(logged.join(" ")), /render failed/);
  });
});

describe("toRequest", () => {
  const signal = new AbortController().signal;

  it("keeps the scheme of HTTPS requests", () => {
    const headers = { Host: "localhost:5173" };
    assert.equal(
      toRequest(
        nodeRequest({ url: "/de/about", headers, encrypted: true }),
        signal,
      ).url,
      "https://localhost:5173/de/about",
    );
    assert.equal(
      toRequest(nodeRequest({ url: "/de/about", headers }), signal).url,
      "http://localhost:5173/de/about",
    );
  });

  it("takes the host from HTTP/2's :authority and skips pseudo-headers", () => {
    const request = toRequest(
      nodeRequest({
        url: "/de/about",
        headers: {
          ":authority": "localhost:5173",
          ":path": "/de/about",
          accept: "text/html",
        },
        encrypted: true,
      }),
      signal,
    );
    assert.equal(request.url, "https://localhost:5173/de/about");
    assert.deepEqual([...request.headers], [["accept", "text/html"]]);
  });

  it("falls back to localhost for a host that would change the path", () => {
    const request = toRequest(
      nodeRequest({
        url: "/page",
        headers: { ":authority": "example.com/admin" },
      }),
      signal,
    );
    assert.equal(request.url, "http://localhost/page");
  });

  it("maps the targets *, absolute-form and //", () => {
    const headers = { Host: "example.com" };
    const url = (target: string) =>
      toRequest(nodeRequest({ url: target, headers }), signal).url;
    assert.equal(url("*"), "http://example.com/*");
    assert.equal(
      url("https://other.example/a?b=1"),
      "https://other.example/a?b=1",
    );
    assert.equal(url("//foo/bar"), "http://example.com//foo/bar");
  });

  it("throws a TypeError for a malformed target", () => {
    for (const target of ["foo", "mailto:a@example.com", ""]) {
      assert.throws(
        () => toRequest(nodeRequest({ url: target }), signal),
        TypeError,
      );
    }
  });
});

describe("writeResponse", () => {
  it("throws on a network error response before writing anything", async () => {
    const base = await listen((_req, res) => {
      writeResponse(Response.error(), res).catch((error: unknown) => {
        res.end(`${error instanceof TypeError} ${res.headersSent}`);
      });
    });
    assert.equal(await (await fetch(base)).text(), "true false");
  });

  describe("while streaming the body", () => {
    // Serves `body` and resolves with how writeResponse ended.
    async function serveBody(body: () => ReadableStream<Uint8Array>) {
      let settled!: Promise<string>;
      const base = await listen((_req, res) => {
        settled = writeResponse(new Response(body()), res).then(
          () => "resolved",
          (error: Error) => error.message,
        );
      });
      return { base, outcome: () => settled };
    }
    const chunk = new TextEncoder().encode("partial");

    it("rejects with the error of a failing body", async () => {
      const { base, outcome } = await serveBody(
        () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              setTimeout(
                () => controller.error(new Error("render failed")),
                20,
              );
            },
          }),
      );
      // The client gets a truncated response once the caller destroys it;
      // here nobody does, so only the outcome is checked.
      const response = await fetch(base);
      await response.body?.getReader().read();
      assert.equal(await outcome(), "render failed");
    });

    it("doesn't reject when the client goes away", async () => {
      const { base, outcome } = await serveBody(
        () =>
          new ReadableStream({
            pull: (controller) =>
              new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
                controller.enqueue(chunk);
              }),
          }),
      );
      const client = new AbortController();
      const response = await fetch(base, { signal: client.signal });
      await response.body?.getReader().read();
      client.abort();
      assert.equal(await outcome(), "resolved");
    });
  });
});

describe("HTTP/2", () => {
  it("converts requests and responses without warnings", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => warnings.push(warning.message);
    process.on("warning", onWarning);

    const http2 = createHttp2Server((req, res) => {
      const request = toRequest(req, new AbortController().signal);
      const headers = new Headers({
        connection: "keep-alive",
        "x-url": request.url,
      });
      headers.append("set-cookie", "a=1");
      headers.append("set-cookie", "b=2");
      void writeResponse(
        new Response("h2", { status: 201, statusText: "Created", headers }),
        res,
      );
    });
    await new Promise<void>((resolve) => http2.listen(0, "127.0.0.1", resolve));
    servers.push(http2);
    const { port } = http2.address() as { port: number };

    const client = connectHttp2(`http://localhost:${port}`);
    try {
      const { headers, body } = await new Promise<{
        headers: Record<string, unknown>;
        body: string;
      }>((resolve, reject) => {
        const stream = client.request({ ":path": "/de/about?x=1" });
        let headers: Record<string, unknown> = {};
        let body = "";
        stream.setEncoding("utf8");
        stream.once("response", (h) => (headers = h));
        stream.on("data", (data: string) => (body += data));
        stream.once("end", () => resolve({ headers, body }));
        stream.once("error", reject);
      });
      // Warnings are emitted on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 10));

      assert.equal(headers[":status"], 201);
      assert.equal(headers["x-url"], `http://localhost:${port}/de/about?x=1`);
      assert.equal(headers.connection, undefined);
      assert.deepEqual(headers["set-cookie"], ["a=1", "b=2"]);
      assert.equal(body, "h2");
      assert.deepEqual(warnings, []);
    } finally {
      client.close();
      process.off("warning", onWarning);
    }
  });
});
