import { describe, expect, it } from "vite-plus/test";
import { BadRequestException } from "./exceptions/bad-request-exception.ts";
import { HttpMethod } from "./http-method.ts";
import { getSearchParams, getUrlParams } from "./request.ts";
import { Route } from "./route.ts";

describe("Request Helper:", () => {
  it("Search param: ref=https:huuma.io", () => {
    expect(
      getSearchParams(
        new Request("https://huuma.io?ref=https://huuma.io", {
          method: "GET",
        }),
      ),
    ).toEqual({
      ref: "https://huuma.io",
    });
  });

  it("URL params: decoded once", () => {
    const route = new Route({
      path: new URLPattern({ pathname: "/blog/:slug" }),
      method: HttpMethod.GET,
      handler: () => new Response(),
    });
    expect(
      getUrlParams(
        route,
        new Request("https://huuma.io/blog/caf%C3%A9%2050%25"),
      ),
    ).toEqual({ slug: "café 50%" });
    expect(() =>
      getUrlParams(route, new Request("https://huuma.io/blog/%E0%A4%A")),
    ).toThrow(BadRequestException);
  });
});
