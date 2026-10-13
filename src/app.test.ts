import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { App } from "./app.ts";
import type { RequestContext } from "./http/request.ts";
import { HookType } from "./protocol.ts";
import { isProd, setEnv } from "./utils/environment.ts";
import { getLogLevel, LogLevel } from "./utils/logger.ts";

type Env = { HUUMA_ENV: string; DB: { name: string } };

function echoApp() {
  const app = new App<{ Env: Env }>();
  let ctx: RequestContext<{ Env: Env }> | undefined;
  app.get("/", (c) => {
    ctx = c;
    return Response.json({ prod: isProd() });
  });
  return { app, context: () => ctx! };
}

function executionContext() {
  return { waitUntil: mock(), passThroughOnException: mock() };
}

const request = () => new Request("http://localhost/");

afterEach(() => setEnv({ HUUMA_ENV: undefined, HUUMA_LOG_LEVEL: undefined }));

describe("App.fetch", () => {
  it("initializes the app once, on the first request", async () => {
    const app = new App();
    app.get("/", () => new Response("ok"));
    const init = mock();
    app.on(HookType.APPLICATION_INIT, init);

    expect(await (await app.fetch(request())).text()).toBe("ok");
    await app.fetch(request());
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("does not initialize again after init()", async () => {
    const app = new App();
    app.get("/", () => new Response("ok"));
    const init = mock();
    app.on(HookType.APPLICATION_INIT, init);
    app.init();

    await app.fetch(request());
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("waits for async APPLICATION_INIT listeners before the first request", async () => {
    const app = new App();
    app.on(HookType.APPLICATION_INIT, async (initialized) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      initialized.get("/late", () => new Response("registered on init"));
    });

    const response = await app.fetch(new Request("http://localhost/late"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("registered on init");
  });

  it("works as a detached function", async () => {
    const { app } = echoApp();
    const { fetch } = app;
    expect((await fetch(request())).status).toBe(200);
  });

  describe("on Cloudflare Workers (request, env, ctx)", () => {
    it("exposes env and forwards waitUntil to the execution context", async () => {
      const { app, context } = echoApp();
      const env = { HUUMA_ENV: "DEV", DB: { name: "main" } };
      const ctx = executionContext();

      await app.fetch(request(), env, ctx);
      expect(context().env).toBe(env);
      expect(context().env.DB.name).toBe("main");

      const work = Promise.resolve();
      context().waitUntil(work);
      expect(ctx.waitUntil).toHaveBeenCalledWith(work);
    });

    it("applies HUUMA_ENV and HUUMA_LOG_LEVEL bindings on the first request", async () => {
      const { app } = echoApp();
      const response = await app.fetch(
        request(),
        { HUUMA_ENV: "PROD", HUUMA_LOG_LEVEL: "ERROR", DB: {} },
        executionContext(),
      );
      expect(await response.json()).toEqual({ prod: true });
      expect(getLogLevel()).toBe(LogLevel.ERROR);
    });

    it("applies bindings even when init() was called at module scope", async () => {
      const { app } = echoApp();
      app.init();
      const response = await app.fetch(
        request(),
        { HUUMA_ENV: "PROD" },
        executionContext(),
      );
      expect(await response.json()).toEqual({ prod: true });
    });

    it("ignores non-string bindings", async () => {
      const { app } = echoApp();
      const response = await app.fetch(
        request(),
        { HUUMA_ENV: { not: "a string" } },
        executionContext(),
      );
      expect(await response.json()).toEqual({ prod: false });
    });

    it("reads the client address from CF-Connecting-IP", async () => {
      const { app, context } = echoApp();
      await app.fetch(
        new Request("http://localhost/", {
          headers: { "CF-Connecting-IP": "203.0.113.7" },
        }),
        {},
        executionContext(),
      );
      expect(context().connection.remoteAddr).toEqual({
        transport: "tcp",
        hostname: "203.0.113.7",
      });
    });
  });

  it("uses remoteAddr from Deno's ServeHandlerInfo", async () => {
    const { app, context } = echoApp();
    const remoteAddr = { transport: "tcp", hostname: "127.0.0.1", port: 5000 };
    await app.fetch(request(), { remoteAddr, completed: Promise.resolve() });
    expect(context().connection.remoteAddr).toBe(remoteAddr);
    expect(context().env).toEqual({} as Env);
  });

  it("reads the client address from a Bun server", async () => {
    const { app, context } = echoApp();
    const server = {
      requestIP: () => ({ address: "::1", family: "IPv6", port: 6000 }),
    };
    await app.fetch(request(), server);
    expect(context().connection.remoteAddr).toEqual({
      transport: "tcp",
      hostname: "::1",
      port: 6000,
    });
  });

  it("falls back to a default connection without platform arguments", async () => {
    const { app, context } = echoApp();
    await app.fetch(request());
    expect(context().connection.remoteAddr).toEqual({ transport: "tcp" });
    expect(context().env).toEqual({} as Env);
  });
});

describe("RequestContext.waitUntil without an execution context", () => {
  it("logs a rejected promise instead of leaving it unhandled", async () => {
    const { app, context } = echoApp();
    await app.fetch(request());
    const consoleError = spyOn(console, "error").mockImplementation(
      () => {},
    );
    try {
      context().waitUntil(Promise.reject(new Error("background failure")));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(String(consoleError.mock.calls[0][0])).toContain(
        "background failure",
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("App.handle", () => {
  it("waits for async APPLICATION_INIT listeners after init()", async () => {
    const app = new App();
    app.on(HookType.APPLICATION_INIT, async (initialized) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      initialized.get("/late", () => new Response("registered on init"));
    });

    const handle = app.init();
    const response = await handle(new Request("http://localhost/late"));
    expect(response.status).toBe(200);
  });

  it("keeps accepting an explicit connection", async () => {
    const { app, context } = echoApp();
    const connection = {
      remoteAddr: { transport: "tcp", hostname: "10.0.0.1" },
    };
    await app.init()(request(), connection);
    expect(context().connection).toBe(connection);
  });
});
