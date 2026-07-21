import { assertThrows } from "@std/assert";
import { HttpProtocol } from "./protocol.ts";

Deno.test("HttpProtocol deprecated body-parser options:", async (t) => {
  await t.step("throws when rawBody is set without useDefaultBodyParser", () => {
    assertThrows(
      () => new HttpProtocol({ rawBody: true }),
      Error,
      "useDefaultBodyParser",
    );
  });

  await t.step(
    "throws when bodyParserOptions is set without useDefaultBodyParser",
    () => {
      assertThrows(
        () => new HttpProtocol({ bodyParserOptions: { maxBodySize: 2048 } }),
        Error,
        "useDefaultBodyParser",
      );
    },
  );

  await t.step(
    "does not throw when useDefaultBodyParser is true with rawBody",
    () => {
      new HttpProtocol({ useDefaultBodyParser: true, rawBody: true });
    },
  );

  await t.step(
    "does not throw when useDefaultBodyParser is true with bodyParserOptions",
    () => {
      new HttpProtocol({
        useDefaultBodyParser: true,
        bodyParserOptions: { maxBodySize: 2048 },
      });
    },
  );

  await t.step("does not throw with no options", () => {
    new HttpProtocol();
  });

  await t.step("does not throw with only useDefaultBodyParser: true", () => {
    new HttpProtocol({ useDefaultBodyParser: true });
  });
});