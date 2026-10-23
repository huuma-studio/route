import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "./app.ts";
import { HttpProtocol } from "./http/protocol.ts";
import { HookType } from "./protocol.ts";

const request = () => new Request("http://localhost/");
afterEach(() => vi.restoreAllMocks());

describe("failed application initialization", () => {
  for (const asyncFailure of [false, true]) {
    it(`rejects requests after a ${asyncFailure ? "rejected" : "throwing"} init listener`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const app = new App();
      const failure = new Error("required setup failed");
      const init = vi.fn(() => {
        if (asyncFailure) return Promise.reject(failure);
        throw failure;
      });
      const laterInit = vi.fn();
      const middleware = vi.fn((_ctx, next) => next());
      const handler = vi.fn(() => new Response("must not serve"));
      app.on(HookType.APPLICATION_INIT, init);
      app.on(HookType.APPLICATION_INIT, laterInit);
      app.use(middleware);
      app.get("/", handler);

      const responses = await Promise.allSettled([
        app.fetch(request()),
        app.fetch(request()),
      ]);
      expect(responses).toEqual([
        { status: "rejected", reason: failure },
        { status: "rejected", reason: failure },
      ]);
      await expect(app.init()(request())).rejects.toBe(failure);
      await expect(app.handle(request())).rejects.toBe(failure);
      await expect(app.fetch(request())).rejects.toBe(failure);
      expect(init).toHaveBeenCalledTimes(1);
      expect(laterInit).not.toHaveBeenCalled();
      expect(middleware).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });
  }

  it("initializes direct handle calls instead of bypassing required setup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new App();
    const failure = new Error("setup failed");
    app.on(HookType.APPLICATION_INIT, () => {
      throw failure;
    });
    app.get("/", () => new Response("must not serve"));
    await expect(app.handle(request())).rejects.toBe(failure);
  });

  it("retains a synchronous custom protocol failure until requests arrive", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("custom protocol failed");
    const protocol = new HttpProtocol();
    const hook = vi.spyOn(protocol, "hook").mockImplementation(() => {
      throw failure;
    });
    const handle = vi.spyOn(protocol, "handle");
    const app = new App({ protocol });
    const serve = app.init();
    // Initialization may reject before any request can await it. The test
    // runner also reports an unhandled rejection if it is not observed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(serve(request())).rejects.toBe(failure);
    await expect(app.fetch(request())).rejects.toBe(failure);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
