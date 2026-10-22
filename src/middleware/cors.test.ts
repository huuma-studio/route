import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { App } from "../app.ts";
import { NotFoundException } from "../http/exceptions/not-found-exception.ts";
import { HttpMethod } from "../http/http-method.ts";
import { Cors, type CorsOptions } from "./cors.ts";

const ORIGIN = "https://app.example";

function corsApp(options: CorsOptions = { allowedCorsDomains: [ORIGIN] }) {
  const app = new App();
  app.use(Cors(options));
  app.get("/", () => new Response("ok"));
  app.post("/", () => new Response("created", { status: 201 }));
  app.get("/redirect", () => Response.redirect("http://localhost/"));
  app.get("/missing", () => {
    throw new NotFoundException();
  });
  app.get("/broken", () => {
    throw new Error("boom");
  });
  return app.init();
}

const get = (path: string, origin = ORIGIN) =>
  new Request(`http://localhost${path}`, { headers: { origin } });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Cors", () => {
  it("allows a listed origin", async () => {
    const response = await corsApp()(get("/"));
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(await response.text()).toBe("ok");
  });

  it("does not allow other origins, but still varies on Origin", async () => {
    const response = await corsApp()(get("/", "https://evil.example"));
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("allows any origin with *", async () => {
    const response = await corsApp({ allowedCorsDomains: ["*"] })(
      get("/", "https://any.example"),
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://any.example",
    );
  });

  it("adds credentials and exposed headers", async () => {
    const response = await corsApp({
      allowedCorsDomains: [ORIGIN],
      allowCredentials: true,
      exposedCorsHeaders: ["X-Total-Count"],
    })(get("/"));
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "X-Total-Count",
    );
  });

  it("adds headers to responses with immutable headers", async () => {
    const response = await corsApp()(get("/redirect"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("adds headers to HTTP exception responses", async () => {
    const response = await corsApp()(get("/missing"));
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("adds headers to responses for unexpected errors", async () => {
    const response = await corsApp()(get("/broken"));
    expect(response.status).toBe(500);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(await response.json()).toEqual({
      status: 500,
      message: "Internal Server Error",
    });
  });

  describe("preflight", () => {
    const preflight = (origin = ORIGIN) =>
      new Request("http://localhost/", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type, x-token",
        },
      });

    it("answers with 204 and echoes the requested method and headers", async () => {
      const response = await corsApp({
        allowedCorsDomains: [ORIGIN],
        maxAge: 600,
      })(preflight());
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
      expect(response.headers.get("access-control-allow-methods")).toBe("POST");
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "content-type, x-token",
      );
      expect(response.headers.get("access-control-max-age")).toBe("600");
      expect(response.headers.get("vary")).toBe(
        "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
      );
    });

    it("answers with the configured methods and headers", async () => {
      const response = await corsApp({
        allowedCorsDomains: [ORIGIN],
        allowedCorsMethods: [HttpMethod.GET, HttpMethod.POST],
        allowedCorsHeaders: ["Content-Type"],
      })(preflight());
      expect(response.headers.get("access-control-allow-methods")).toBe(
        "GET, POST",
      );
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Content-Type",
      );
    });

    it("passes preflights from other origins on", async () => {
      const response = await corsApp()(preflight("https://evil.example"));
      // The router answers it, as any other request without a route.
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
      expect(response.status).not.toBe(204);
    });
  });
});
