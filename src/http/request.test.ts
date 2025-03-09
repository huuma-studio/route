import { assertEquals } from "@std/assert";

import { getSearchParams } from "./request.ts";

Deno.test("Request Helper:", async (t) => {
  await t.step("Search param: ref=https:huuma.io", () => {
    assertEquals(
      getSearchParams(
        new Request("https://huuma.io?ref=https://huuma.io", {
          method: "GET",
        }),
      ),
      {
        ref: "https://huuma.io",
      },
    );
  });
});
