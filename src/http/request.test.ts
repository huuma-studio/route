import { describe, expect, it } from "bun:test";
import { getSearchParams } from "./request.ts";

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
});
