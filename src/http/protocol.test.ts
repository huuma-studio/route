import { describe, expect, it } from "bun:test";
import { HttpProtocol } from "./protocol.ts";

describe("HttpProtocol deprecated body-parser options:", () => {
  it("throws when rawBody is set without useDefaultBodyParser", () => {
    expect(() => new HttpProtocol({ rawBody: true })).toThrow(
      "useDefaultBodyParser",
    );
  });

  it("throws when bodyParserOptions is set without useDefaultBodyParser", () => {
    expect(() => new HttpProtocol({ bodyParserOptions: { maxBodySize: 2048 } }))
      .toThrow("useDefaultBodyParser");
  });

  it("does not throw when useDefaultBodyParser is true with rawBody", () => {
    new HttpProtocol({ useDefaultBodyParser: true, rawBody: true });
  });

  it("does not throw when useDefaultBodyParser is true with bodyParserOptions", () => {
    new HttpProtocol({
      useDefaultBodyParser: true,
      bodyParserOptions: { maxBodySize: 2048 },
    });
  });

  it("does not throw with no options", () => {
    new HttpProtocol();
  });

  it("does not throw with only useDefaultBodyParser: true", () => {
    new HttpProtocol({ useDefaultBodyParser: true });
  });
});
