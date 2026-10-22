import { describe, expect, it } from "vite-plus/test";
import { BadRequestException } from "../../http/exceptions/bad-request-exception.ts";
import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import { UnsupportedMediaTypeException } from "../../http/exceptions/unsupported-media-type-exception.ts";
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
      bodyParser({ maxBodySize: 2 })(
        contextOf('"a"'),
        next,
      ) as Promise<Response>,
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

  it('"application/json": reject not json string with "BadRequestException"', async () => {
    await expect(
      bodyParser()(contextOf("peng"), next) as Promise<Response>,
    ).rejects.toThrow(BadRequestException);
  });
});

describe("Body Parser content type:", () => {
  const withType = (contentType: string) =>
    ({
      request: new Request("https://huuma.studio", {
        method: "POST",
        headers: { "content-type": contentType },
        body: '{"a":1}',
      }),
    }) as RequestContext;

  for (const contentType of [
    "application/json",
    "application/json; charset=utf-8",
    "application/json;charset=utf-8",
    "Application/JSON",
    " application/json ; charset=UTF-8",
  ]) {
    it(`parses "${contentType}"`, async () => {
      const ctx = withType(contentType);
      await bodyParser()(ctx, next);
      expect(ctx.body).toEqual({ a: 1 });
    });
  }

  it('rejects other media types with "UnsupportedMediaTypeException"', async () => {
    await expect(
      bodyParser()(withType("text/plain"), next) as Promise<Response>,
    ).rejects.toThrow(UnsupportedMediaTypeException);
  });

  it("uses custom parsers", async () => {
    const ctx = withType("text/plain; charset=utf-8");
    await bodyParser({
      parsers: [{ mimeType: "text/plain", parse: () => "custom" }],
    })(ctx, next);
    expect(ctx.body).toBe("custom");
  });

  it('still accepts the deprecated "paser" option', async () => {
    const ctx = withType("text/plain");
    await bodyParser({
      paser: [{ mimeType: "text/plain", parse: () => "custom" }],
    })(ctx, next);
    expect(ctx.body).toBe("custom");
  });
});

describe("Body Parser size limit:", () => {
  it("accepts bodies up to 1 MiB by default", async () => {
    const ctx = contextOf(JSON.stringify("x".repeat(1024 * 1024 - 2)));
    await bodyParser()(ctx, next);
    expect(ctx.body).toHaveLength(1024 * 1024 - 2);
  });

  it("rejects a too large Content-Length without reading the body", async () => {
    let pulled = false;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        pulled = true;
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://huuma.studio", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "10" },
      body,
      duplex: "half",
    } as RequestInit);

    await expect(
      bodyParser({ maxBodySize: 5 })(
        { request } as RequestContext,
        next,
      ) as Promise<Response>,
    ).rejects.toThrow(EntityTooLargeException);
    await Promise.resolve();
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("cancels the body once it exceeds the max size", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://huuma.studio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);

    await expect(
      bodyParser({ maxBodySize: 10 })(
        { request } as RequestContext,
        next,
      ) as Promise<Response>,
    ).rejects.toThrow(EntityTooLargeException);
    await Promise.resolve();
    expect(cancelled).toBe(true);
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
