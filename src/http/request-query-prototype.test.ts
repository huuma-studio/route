import { describe, expect, it } from "vite-plus/test";
import { App } from "../app.ts";
import { getSearchParams } from "./request.ts";

describe("query parameter names", () => {
  it("has no inherited parameters, including for an empty query", () => {
    const result = getSearchParams(new Request("http://localhost/"));
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(result.constructor).toBeUndefined();
    expect("toString" in result).toBe(false);
  });

  it("keeps prototype-related names as own query parameters", () => {
    const result = getSearchParams(
      new Request(
        "http://localhost/?__proto__=a&__proto__=b&constructor=c&toString=d&hasOwnProperty=e",
      ),
    );
    expect(Object.getPrototypeOf(result)).toBeNull();
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(result.__proto__).toEqual(["a", "b"]);
    expect(result.constructor).toBe("c");
    expect(Object.getOwnPropertyDescriptor(result, "toString")?.value).toBe(
      "d",
    );
    expect(
      Object.getOwnPropertyDescriptor(result, "hasOwnProperty")?.value,
    ).toBe("e");
    expect(result[0]).toBeUndefined();
    expect(Object.keys(result)).toEqual([
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
    ]);
  });

  it("exposes a single __proto__ value safely through request context and JSON", async () => {
    const app = new App();
    app.get("/", (ctx) => Response.json(ctx.search));
    const response = await app.fetch(
      new Request("http://localhost/?__proto__=value&normal=ok"),
    );
    expect(await response.text()).toBe('{"__proto__":"value","normal":"ok"}');
  });
});
