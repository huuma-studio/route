import { describe, expect, it } from "bun:test";
import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import type { RequestContext } from "../../http/request.ts";
import { bodyParser } from "./body-parser.ts";

const requestOptions = {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
};

function contextOf(body?: string): RequestContext {
  return {
    request: new Request("https://huuma.studio", { ...requestOptions, body }),
  } as RequestContext;
}

const next = () => Promise.resolve(new Response());

describe("Body Parser:", () => {
  it("parse if body size not exceeds the max size", async () => {
    const ctx = contextOf('"a"');
    await bodyParser({ maxBodySize: 3 })(ctx, next);
    expect(ctx.body).toBe("a");
  });

  it('reject if body exceededs max size with "EntityTooLargeException"', async () => {
    await expect(
      bodyParser({ maxBodySize: 2 })(contextOf('"a"'), next) as Promise<
        Response
      >,
    ).rejects.toThrow(EntityTooLargeException);
  });

  it("handle undefined body", async () => {
    const ctx = contextOf();
    await bodyParser()(ctx, next);
    expect(ctx.body).toBeUndefined();
  });

  it('"application/json": parse json with body', async () => {
    const json = {
      hello: "world",
    };
    const ctx = contextOf(JSON.stringify(json));
    await bodyParser()(ctx, next);
    expect(ctx.body).toEqual(json);
  });

  it('"application/json": parse empty json body', async () => {
    const ctx = contextOf(JSON.stringify(""));
    await bodyParser()(ctx, next);
    expect(ctx.body).toBe("");
  });

  it('"application/json": reject not json string with "SyntaxError"', async () => {
    await expect(
      bodyParser()(contextOf("peng"), next) as Promise<Response>,
    ).rejects.toThrow(SyntaxError);
  });
});

describe("Body Parser keepRaw:", () => {
  const encoder = new TextEncoder();

  it("does not attach rawContent by default", async () => {
    const ctx = contextOf('"a"');
    await bodyParser()(ctx, next);
    expect(ctx.rawContent).toBeUndefined();
    expect(ctx.body).toBe("a");
  });

  it("attaches rawContent when keepRaw is true", async () => {
    const ctx = contextOf('"hello"');
    await bodyParser({ keepRaw: true })(ctx, next);
    expect(ctx.rawContent).toEqual(encoder.encode('"hello"'));
    expect(ctx.body).toBe("hello");
  });

  it("does not attach rawContent when keepRaw is false", async () => {
    const ctx = contextOf('"a"');
    await bodyParser({ keepRaw: false })(ctx, next);
    expect(ctx.rawContent).toBeUndefined();
    expect(ctx.body).toBe("a");
  });
});
