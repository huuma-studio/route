import { describe, expect, it } from "vite-plus/test";
import { App } from "../app.ts";
import { bodyParser } from "../middleware/body-parser/body-parser.ts";
import type { Middleware } from "../middleware/middleware.ts";

const request = (path: string) => new Request(`http://localhost${path}`);
const record =
  (events: string[], name: string): Middleware =>
  async (_ctx, next) => {
    events.push(name);
    const response = await next();
    events.push(`${name}:after`);
    return response;
  };

describe("route group middleware", () => {
  it("runs incremental middleware once in registration order, before route middleware", async () => {
    const events: string[] = [];
    const app = new App();
    const route = app
      .get("/", () => {
        events.push("handler");
        return new Response("ok");
      })
      .use(record(events, "route"));
    const group = app.group("/api", [route]);
    group.use(record(events, "first"));
    group.middleware([record(events, "second"), record(events, "third")]);
    route.use(record(events, "late-route"));
    expect((await app.fetch(request("/api/"))).status).toBe(200);
    expect(events).toEqual([
      "first",
      "second",
      "third",
      "route",
      "late-route",
      "handler",
      "late-route:after",
      "route:after",
      "third:after",
      "second:after",
      "first:after",
    ]);
  });

  it("does not consume the JSON request body twice", async () => {
    const app = new App();
    const group = app.group("/api", [
      app.post("/data", (ctx) => Response.json(ctx.body)),
    ]);
    group.use(bodyParser());
    group.use((_ctx, next) => next());
    const response = await app.fetch(
      new Request("http://localhost/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"ok":true}',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("applies the same middleware to existing and subsequently added routes", async () => {
    const app = new App();
    const events: string[] = [];
    const group = app.group("/api", [
      app.get("/early", () => new Response("ok")),
    ]);
    group.use(record(events, "first"));
    group.route(app.get("/late", () => new Response("ok")));
    group.use(record(events, "second"));
    for (const path of ["early", "late"]) {
      events.length = 0;
      expect((await app.fetch(request(`/api/${path}`))).status).toBe(200);
      expect(events).toEqual([
        "first",
        "second",
        "second:after",
        "first:after",
      ]);
    }
  });

  it("keeps outer middleware ahead of inner middleware added later", async () => {
    const app = new App();
    const events: string[] = [];
    const route = app.get("/", () => new Response("ok"));
    const inner = app.group("/inner", [route]);
    inner.use(record(events, "inner-first"));
    const outer = app.group("/outer", inner.routes);
    outer.use(record(events, "outer"));
    inner.use(record(events, "inner-late"));
    expect((await app.fetch(request("/outer/inner/"))).status).toBe(200);
    expect(events).toEqual([
      "outer",
      "inner-first",
      "inner-late",
      "inner-late:after",
      "inner-first:after",
      "outer:after",
    ]);
  });

  it("preserves deliberate registrations of the same middleware function", async () => {
    const app = new App();
    const events: string[] = [];
    const middleware = record(events, "repeat");
    const group = app.group("/api", [app.get("/", () => new Response("ok"))]);
    group.use(middleware).use(middleware);
    await app.fetch(request("/api/"));
    expect(events).toEqual([
      "repeat",
      "repeat",
      "repeat:after",
      "repeat:after",
    ]);
  });
});
