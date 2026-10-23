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

  describe("exact paths", () => {
    it("keeps registration order between patterns and exact paths", async () => {
      const app = new App();
      app.get("/a/:id", () => new Response("pattern"));
      app.get("/a/me", () => new Response("exact"));
      app.get("/b/me", () => new Response("exact"));
      app.get("/b/:id", () => new Response("pattern"));
      const handle = app.init();

      expect(await (await handle(request("/a/me"))).text()).toBe("pattern");
      expect(await (await handle(request("/b/me"))).text()).toBe("exact");
      expect(await (await handle(request("/b/1"))).text()).toBe("pattern");
    });

    it("matches escaped and encoded paths", async () => {
      const app = new App();
      app.get("/a\\:b", () => new Response("colon"));
      app.get("/a b/ä", () => new Response("encoded"));
      const handle = app.init();

      expect(await (await handle(request("/a:b"))).text()).toBe("colon");
      expect(await (await handle(request("/a%20b/%C3%A4"))).text()).toBe(
        "encoded",
      );
    });

    it("finds routes added or grouped after the first request", async () => {
      const app = new App();
      app.get("/", () => new Response("root"));
      expect((await app.fetch(request("/"))).status).toBe(200);

      const route = app.get("/late", () => new Response("late"));
      expect(await (await app.fetch(request("/late"))).text()).toBe("late");

      app.group("/api", [route]);
      expect((await app.fetch(request("/late"))).status).toBe(404);
      expect(await (await app.fetch(request("/api/late"))).text()).toBe("late");
    });

    it("lists the allowed methods in registration order", async () => {
      const app = new App();
      app.get("/users/:id", () => new Response());
      app.put("/users/me", () => new Response());
      app.delete("/users/:id", () => new Response());
      const response = await app.init()(request("/users/me", "POST"));
      expect(response.headers.get("allow")).toBe("GET, PUT, DELETE, HEAD");
    });

    it("doesn't match exact paths one by one", async () => {
      const app = new App();
      for (let i = 0; i < 100; i++)
        app.get(`/files/${i}.js`, () => new Response());
      app.get("/users/:id", () => new Response("user"));
      const handle = app.init();
      await handle(request("/files/0.js"));

      const exec = vi.spyOn(URLPattern.prototype, "exec");
      const test = vi.spyOn(URLPattern.prototype, "test");
      expect((await handle(request("/files/99.js"))).status).toBe(200);
      expect((await handle(request("/users/1"))).status).toBe(200);
      expect((await handle(request("/nope"))).status).toBe(404);
      // The one pattern, for /users/1 and twice for /nope (match and Allow).
      expect(exec.mock.calls.length + test.mock.calls.length).toBe(3);
    });
  });

  describe("HEAD", () => {
    it("falls back to the GET route without the body", async () => {
      const response = await app()(request("/users", "HEAD"));
      expect(response.status).toBe(200);
      expect(response.headers.get("x-a")).toBe("1");
      expect(response.body).toBeNull();
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
    it("rejects the same method and path twice", () => {
      const app = new App();
      app.get("/a", () => new Response());
      expect(() => app.get("/a", () => new Response())).toThrow(
        "Route for GET /a already exists",
      );
    });

    it("warns about grouped routes that end up with the same path", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = new App();
      app.get("/api/a", () => new Response("first"));
      app.group("/api", [app.get("/a", () => new Response("second"))]);
      const handle = app.init();

      expect(warn.mock.calls.flat().join(" ")).toContain(
        "GET /api/a is registered twice",
      );
      expect(await (await handle(request("/api/a"))).text()).toBe("first");
    });
  });
});
