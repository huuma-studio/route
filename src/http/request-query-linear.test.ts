import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { getSearchParams } from "./request.ts";

afterEach(() => vi.restoreAllMocks());

describe("query parsing", () => {
  it("preserves values, decoding and duplicate order", () => {
    const result = getSearchParams(
      new Request(
        "http://localhost/?tag=one&empty=&tag=two&name=A+B&tag=three&constructor=own",
      ),
    );
    expect(result).toEqual({
      tag: ["one", "two", "three"],
      empty: "",
      name: "A B",
      constructor: "own",
    });
  });

  for (const distinct of [false, true]) {
    it(`avoids repeated full-query scans for ${distinct ? "distinct" : "repeated"} keys`, () => {
      const count = 4_000;
      const query = Array.from(
        { length: count },
        (_, index) => `${distinct ? `key${index}` : "key"}=${index}`,
      ).join("&");
      // Count full scans instead of asserting a machine-dependent time limit.
      const getAll = vi.spyOn(URLSearchParams.prototype, "getAll");
      const result = getSearchParams(new Request(`http://localhost/?${query}`));
      if (distinct) {
        expect(Object.keys(result)).toHaveLength(count);
        expect(result.key3999).toBe("3999");
      } else {
        expect(result.key).toEqual(
          Array.from({ length: count }, (_, index) => String(index)),
        );
      }
      expect(getAll.mock.calls.length).toBeLessThanOrEqual(1);
    });
  }
});
