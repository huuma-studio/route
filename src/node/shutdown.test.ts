import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { serve, type NodeServer, type ServeOptions } from "./serve.ts";

let server: NodeServer | undefined;
const cleanup: (() => void)[] = [];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  for (const close of cleanup.splice(0)) close();
  await server?.shutdown();
  server = undefined;
  vi.restoreAllMocks();
});

// Open a response that deliberately never finishes. Observe the stream and
// request cancellation on the server, independently of the client socket.
async function streamingServer(options: ServeOptions = {}) {
  const aborted = deferred();
  const cancelled = deferred();
  let finish!: () => void;
  server = await serve(
    {
      fetch(request) {
        request.signal.addEventListener("abort", () => aborted.resolve(), {
          once: true,
        });
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("start"));
            finish = () => controller.close();
          },
          cancel() {
            cancelled.resolve();
          },
        });
        return new Response(body);
      },
    },
    { port: 0, hostname: "127.0.0.1", ...options },
  );
  const closed = deferred();
  let received = "";
  await new Promise<void>((resolve, reject) => {
    const req = httpRequest(
      `http://127.0.0.1:${server!.port}/`,
      { agent: false },
      (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          received += chunk;
          resolve();
        });
        res.on("error", () => {});
        res.once("close", () => closed.resolve());
      },
    );
    cleanup.push(() => req.destroy());
    req.on("error", reject);
    req.end();
  });
  return {
    finish: () => finish(),
    received: () => received,
    closed: closed.promise,
    aborted: aborted.promise,
    cancelled: cancelled.promise,
  };
}

describe("shutdown deadline", () => {
  it("lets an active response finish during the grace period and clears the timer", async () => {
    const stream = await streamingServer();
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const closing = server!.shutdown();
    expect(server!.shutdown()).toBe(closing);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 30_000);
    const timer = schedule.mock.results[0].value;
    expect(timer.hasRef()).toBe(false);
    await expect(fetch(`http://127.0.0.1:${server!.port}/`)).rejects.toThrow();
    // A graceful shutdown must wait for the still-open response.
    expect(
      await Promise.race([closing.then(() => "closed"), delay(20, "waiting")]),
    ).toBe("waiting");
    stream.finish();
    await closing;
    await stream.closed;
    expect(stream.received()).toBe("start");
    expect(clear).toHaveBeenCalledWith(timer);
    expect(server!.shutdown()).toBe(closing);
  });

  for (const viaSignal of [false, true]) {
    it(`closes stalled streams after the deadline via ${viaSignal ? "AbortSignal" : "shutdown()"}`, async () => {
      const signal = new AbortController();
      const stream = await streamingServer({
        shutdownTimeout: 30,
        signal: signal.signal,
      });
      if (viaSignal) signal.abort();
      else void server!.shutdown();
      const complete = Promise.all([
        server!.finished,
        stream.closed,
        stream.aborted,
        stream.cancelled,
      ]);
      expect(
        await Promise.race([
          complete.then(() => "closed"),
          delay(1_000, "timed out"),
        ]),
      ).toBe("closed");
      await expect(
        fetch(`http://127.0.0.1:${server!.port}/`),
      ).rejects.toThrow();
    });
  }

  it("closes requests whose handler never returns a response", async () => {
    const entered = deferred();
    const aborted = deferred();
    server = await serve(
      {
        fetch(request) {
          request.signal.addEventListener("abort", aborted.resolve, {
            once: true,
          });
          entered.resolve();
          return new Promise<Response>(() => {});
        },
      },
      { port: 0, hostname: "127.0.0.1", shutdownTimeout: 30 },
    );
    const req = httpRequest(`http://127.0.0.1:${server.port}/`, {
      agent: false,
    });
    cleanup.push(() => req.destroy());
    req.on("error", () => {});
    const closed = new Promise<void>((resolve) => req.once("close", resolve));
    req.end();
    await entered.promise;
    const complete = Promise.all([server.shutdown(), closed, aborted.promise]);
    expect(
      await Promise.race([
        complete.then(() => "closed"),
        delay(1_000, "timed out"),
      ]),
    ).toBe("closed");
  });

  it("supports immediate shutdown without a grace period", async () => {
    const stream = await streamingServer({ shutdownTimeout: 0 });
    const complete = Promise.all([
      server!.shutdown(),
      stream.closed,
      stream.cancelled,
    ]);
    expect(
      await Promise.race([
        complete.then(() => "closed"),
        delay(1_000, "timed out"),
      ]),
    ).toBe("closed");
  });

  it("closes a connection with unfinished request headers", async () => {
    server = await serve(
      { fetch: () => new Response("ok") },
      {
        port: 0,
        hostname: "127.0.0.1",
        shutdownTimeout: 30,
      },
    );
    const socket = connect(server.port, "127.0.0.1");
    cleanup.push(() => socket.destroy());
    socket.on("error", () => {});
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
    const closed = new Promise<void>((resolve) =>
      socket.once("close", resolve),
    );
    socket.resume();
    expect(
      await Promise.race([
        Promise.all([server.shutdown(), closed]).then(() => "closed"),
        delay(1_000, "timed out"),
      ]),
    ).toBe("closed");
  });

  for (const timeout of [-1, NaN, Infinity, 0.5, 2 ** 31]) {
    it(`rejects an invalid shutdown timeout (${timeout}) before listening`, async () => {
      await expect(
        serve(
          { fetch: () => new Response("ok") },
          {
            port: 0,
            hostname: "127.0.0.1",
            shutdownTimeout: timeout,
          },
        ).then((started) => {
          server = started;
        }),
      ).rejects.toThrow(RangeError);
    });
  }
});
