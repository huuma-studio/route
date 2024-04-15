import { assertEquals } from "@std/assert/assert-equals";

import { extension, name } from "./file.ts";

Deno.test("File utility functions: extension", () => {
  assertEquals("tsx", extension("pages/home.tsx"));
});

Deno.test("File utility functions: base", () => {
  assertEquals("home", name("pages/home.tsx"));
});
