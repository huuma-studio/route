import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "../app.ts";
import { HookType } from "../protocol.ts";
import { NotFoundException } from "./exceptions/not-found-exception.ts";
import type { RequestContext } from "./request.ts";

type Context = { State: { user: string } };

const request = (path = "/") => new Request(`http://localhost${path}`);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

function hookedApp() {
  const app = new App<Context>();
  const events: string[] = [];
  app.use((ctx, next) => {
    ctx.set("user", "ada");
    return next();
  });
  app.get("/", () => new Response("ok"));
  app.get("/missing", () => {
    throw new NotFoundException();
  });
  const record = (hook: string) => async (ctx: RequestContext<Context>) => {
    await settle();
    events.push(`${hook} ${ctx.get("user")}`);
  };
  app.on(HookType.REQUEST_SUCCESS, record(HookType.REQUEST_SUCCESS));
  app.on(HookType.REQUEST_ERROR, record(HookType.REQUEST_ERROR));
  app.on(HookType.REQUEST_FINALLY, record(HookType.REQUEST_FINALLY));
  return { app, events };
}

describe("request hooks", () => {
  it("run in order and see the state after awaiting", async () => {
    const { app, events } = hookedApp();
    const response = await app.init()(request());
    expect(await response.text()).toBe("ok");
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events).toEqual(["request:success ada", "request:finally ada"]);
  });

  it("run the error hook for failed requests", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, events } = hookedApp();
    const response = await app.init()(request("/missing"));
    expect(response.status).toBe(404);
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events).toEqual(["request:error ada", "request:finally ada"]);
  });

  it("don't delay the response", async () => {
    const app = new App();
    app.get("/", () => new Response("ok"));
    let release!: () => void;
    app.on(
      HookType.REQUEST_FINALLY,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const response = await app.init()(request());
    expect(await response.text()).toBe("ok");
    release();
  });

  it("are kept alive with waitUntil on Workers", async () => {
    const { app, events } = hookedApp();
    const waitUntil = vi.fn();
    await app.fetch(request(), {}, { waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    expect(events).toEqual(["request:success ada", "request:finally ada"]);
  });

  it("log a failing listener and still run the next ones", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new App();
    app.get("/", () => new Response("ok"));
    const finallyListener = vi.fn();
    app.on(HookType.REQUEST_SUCCESS, () => {
      throw new Error("listener failed");
    });
    app.on(HookType.REQUEST_FINALLY, finallyListener);
    await app.init()(request());
    await vi.waitFor(() => expect(finallyListener).toHaveBeenCalled());
    expect(error.mock.calls.flat().join(" ")).toContain("listener failed");
  });
});

describe("App.init", () => {
  it("runs the APPLICATION_INIT listeners once when called twice", async () => {
    const app = new App();
    const init = vi.fn();
    app.on(HookType.APPLICATION_INIT, init);
    const handle = app.init();
    expect(app.init()).toBe(handle);
    await handle(request());
    expect(init).toHaveBeenCalledTimes(1);
  });
});

describe("middleware", () => {
  it("rejects calling next() twice", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new App();
    const handler = vi.fn(() => new Response("ok"));
    app.use(async (_ctx, next) => {
      await next();
      return next();
    });
    app.get("/", handler);
    const response = await app.init()(request());
    expect(response.status).toBe(500);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.flat().map(String).join(" ")).toContain(
      "next() was called multiple times",
    );
  });

  it("runs the chain in order", async () => {
    const app = new App();
    const order: string[] = [];
    app.use([
      async (_ctx, next) => {
        order.push("a");
        return await next();
      },
      async (_ctx, next) => {
        order.push("b");
        return await next();
      },
    ]);
    app
      .get("/", () => {
        order.push("handler");
        return new Response("ok");
      })
      .use((_ctx, next) => {
        order.push("route");
        return next();
      });
    await app.init()(request());
    expect(order).toEqual(["a", "b", "route", "handler"]);
  });
});
