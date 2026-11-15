import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { App } from "../app.ts";
import { NotFoundException } from "./exceptions/not-found-exception.ts";

function app() {
  const app = new App();
  app.get("/users", () => new Response("users", { headers: { "X-A": "1" } }));
  app.post("/users", () => new Response("created", { status: 201 }));
  app.get("/users/:id", (ctx) => Response.json(ctx.params));
  app.head("/explicit", () => new Response(null, { headers: { "X-B": "2" } }));
  app.get("/explicit", () => new Response("get"));
  app.head("/explicit-body", () => new Response("not allowed"));
  app.get("/missing", () => {
    throw new NotFoundException("missing");
  });
  app.post("/only-post", () => new Response("created", { status: 201 }));
  return app.init();
}

const request = (path: string, method = "GET") =>
  new Request(`http://localhost${path}`, { method });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Router", () => {
  it("matches routes by method and path", async () => {
    const handle = app();
    expect(await (await handle(request("/users"))).text()).toBe("users");
    expect((await handle(request("/users", "POST"))).status).toBe(201);
  });

  it("passes the path parameters", async () => {
    const response = await app()(request("/users/42?x=1"));
    expect(await response.json()).toEqual({ id: "42" });
  });

  it("answers an unknown path with 404", async () => {
    expect((await app()(request("/nope"))).status).toBe(404);
  });

  describe("HEAD", () => {
    it("falls back to the GET route without the body", async () => {
      const response = await app()(request("/users", "HEAD"));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-a")).toBe("1");
      expect(response.body).toBeNull();
    });

    it("answers with the status and headers of the GET route", async () => {
      const app = new App();
      app.get(
        "/accepted",
        () =>
          new Response("queued", {
            status: 202,
            statusText: "Accepted",
            headers: { "Content-Type": "text/plain", "X-A": "1" },
          }),
      );
      const handle = app.init();

      const get = await handle(request("/accepted"));
      const head = await handle(request("/accepted", "HEAD"));
      expect(head.status).toBe(get.status);
      expect(head.statusText).toBe(get.statusText);
      expect([...head.headers]).toEqual([...get.headers]);
      expect(head.body).toBeNull();
      expect(await get.text()).toBe("queued");
    });

    it("cancels the body of the GET route", async () => {
      const cancel = vi.fn();
      const app = new App();
      app.get(
        "/stream",
        () => new Response(new ReadableStream({ pull() {}, cancel })),
      );

      const response = await app.init()(request("/stream", "HEAD"));
      expect(response.body).toBeNull();
      await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    });

    it("runs the middleware of the GET route", async () => {
      const seen: string[] = [];
      const app = new App();
      app.use(async (ctx, next) => {
        seen.push(`app ${ctx.request.method}`);
        return await next();
      });
      app
        .get("/guarded", () => new Response("guarded"))
        .use(async (ctx, next) => {
          seen.push(`route ${ctx.request.method}`);
          const response = await next();
          response.headers.set("X-Route", "1");
          return response;
        });
      app
        .group("/api", [app.get("/a", () => new Response("a"))])
        .use(async (ctx, next) => {
          seen.push(`group ${ctx.request.method}`);
          return await next();
        });
      const handle = app.init();

      const response = await handle(request("/guarded", "HEAD"));
      expect(response.headers.get("x-route")).toBe("1");
      expect(response.body).toBeNull();
      await handle(request("/api/a", "HEAD"));
      expect(seen).toEqual([
        "app HEAD",
        "route HEAD",
        "app HEAD",
        "group HEAD",
      ]);
    });

    it("prefers a HEAD route", async () => {
      const response = await app()(request("/explicit", "HEAD"));
      expect(response.headers.get("x-b")).toBe("2");
    });

    it("answers 404 when there is no GET route either", async () => {
      const response = await app()(request("/nope", "HEAD"));
      expect(response.status).toBe(404);
      expect(response.body).toBeNull();
    });

    it("drops the body of an error from the GET route", async () => {
      const response = await app()(request("/missing", "HEAD"));
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.body).toBeNull();
    });

    it("drops the body of a 405", async () => {
      const response = await app()(request("/only-post", "HEAD"));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(response.body).toBeNull();
    });

    it("drops the body a HEAD route returns", async () => {
      const response = await app()(request("/explicit-body", "HEAD"));
      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
    });
  });

  describe("405", () => {
    it("answers a path that exists for other methods with 405 and Allow", async () => {
      const response = await app()(request("/users", "DELETE"));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, POST, HEAD");
      expect((await response.json()).message).toBe(
        'The method "DELETE" is not allowed for the path "/users"',
      );
    });

    it("lists only the methods of matching routes", async () => {
      const response = await app()(request("/users/1", "PUT"));
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    });
  });

  describe("duplicates", () => {
    it("warns about the same method and path twice and keeps the first", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = new App();
      app.get("/a", () => new Response("first"));
      app.get("/a", () => new Response("second"));
      const handle = app.init();

      expect(await (await handle(request("/a"))).text()).toBe("first");
      expect(warn.mock.calls.flat().join(" ")).toContain(
        "GET /a is registered twice",
      );
    });

    it("warns about grouped routes that end up with the same path", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = new App();
      app.get("/api/a", () => new Response("first"));
      app.group("/api", [app.get("/a", () => new Response("second"))]);
      const handle = app.init();

      expect(await (await handle(request("/api/a"))).text()).toBe("first");
      expect(warn.mock.calls.flat().join(" ")).toContain(
        "GET /api/a is registered twice",
      );
    });

    it("allows a grouped route with the path of a route outside the group", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = new App();
      app.get("/users", () => new Response("top"));
      app.group("/api", [app.get("/users", () => new Response("api"))]);
      const handle = app.init();

      expect(await (await handle(request("/users"))).text()).toBe("top");
      expect(await (await handle(request("/api/users"))).text()).toBe("api");
      expect(warn).not.toHaveBeenCalled();
    });

    it("warns about duplicates added by APPLICATION_INIT listeners", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = new App();
      app.get("/a", () => new Response("first"));
      app.on("application:init", (app) => {
        app.get("/a", () => new Response("second"));
      });
      const handle = app.init();

      expect(await (await handle(request("/a"))).text()).toBe("first");
      expect(warn.mock.calls.flat().join(" ")).toContain(
        "GET /a is registered twice",
      );
    });
  });
});
