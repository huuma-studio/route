import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "../app.ts";

function app() {
  const app = new App();
  app.get("/users", () => new Response("users", { headers: { "X-A": "1" } }));
  app.post("/users", () => new Response("created", { status: 201 }));
  app.get("/users/:id", (ctx) => Response.json(ctx.params));
  app.head("/explicit", () => new Response(null, { headers: { "X-B": "2" } }));
  app.get("/explicit", () => new Response("get"));
  return app.init();
}

const request = (path: string, method = "GET") =>
  new Request(`http://localhost${path}`, { method });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

    it("prefers a HEAD route", async () => {
      const response = await app()(request("/explicit", "HEAD"));
      expect(response.headers.get("x-b")).toBe("2");
    });

    it("answers 404 when there is no GET route either", async () => {
      expect((await app()(request("/nope", "HEAD"))).status).toBe(404);
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
