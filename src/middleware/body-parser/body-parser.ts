import { BadRequestException } from "../../http/exceptions/bad-request-exception.ts";
import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import { HttpException } from "../../http/exceptions/http-exception.ts";
import { UnsupportedMediaTypeException } from "../../http/exceptions/unsupported-media-type-exception.ts";
import type { RequestContext } from "../../http/request.ts";
import type { Middleware, Next } from "../middleware.ts";
import { JSONParser } from "./json-parser.ts";

export interface Parser<T> {
  mimeType: string;
  parse: (buffer: Uint8Array) => T;
}

export interface BodyParserOptions {
  /** Largest accepted body in bytes. Default: 1 MiB. */
  maxBodySize: number;
  /** Parsers by media type. Default: `[JSONParser]`. */
  parsers?: Parser<unknown>[];
  /** @deprecated Misspelled; use `parsers`. */
  paser?: Parser<unknown>[];
  /** Attach the raw request bytes to `ctx.rawContent` (Uint8Array). Default: false. */
  keepRaw?: boolean;
}

const defaultOptions: BodyParserOptions = {
  maxBodySize: 1024 * 1024,
  parsers: [JSONParser],
  keepRaw: false,
};

export function bodyParser(
  parserOptions?: Partial<BodyParserOptions>,
): Middleware {
  const options = { ...defaultOptions, ...parserOptions };
  const parsers =
    parserOptions?.parsers ?? parserOptions?.paser ?? defaultOptions.parsers;
  return async (ctx: RequestContext, next: Next) => {
    if (!ctx.request.body) {
      return next();
    }
    const contentLength = Number(ctx.request.headers.get("content-length"));
    if (contentLength > options.maxBodySize) {
      // Refuse before reading anything.
      void ctx.request.body.cancel().catch(() => {});
      throw tooLarge(options.maxBodySize);
    }
    const buffer = await readToMaxSize(ctx.request.body, options.maxBodySize);
    if (options.keepRaw) {
      ctx.rawContent = buffer;
    }
    const contentType = mediaType(ctx.request.headers.get("content-type"));
    if (contentType) {
      const parser = parsers?.find((parser) => {
        return parser.mimeType.toLowerCase() === contentType;
      });
      if (typeof parser?.parse !== "function") {
        throw new UnsupportedMediaTypeException(
          "Content type of request not supported",
        );
      }
      try {
        ctx.body = parser.parse(buffer);
      } catch (e) {
        if (e instanceof HttpException) throw e;
        // Keep the parser's error for debugging; the client only gets 400.
        throw Object.assign(
          new BadRequestException(`Malformed ${contentType} request body`),
          { cause: e },
        );
      }
    }
    return next();
  };
}

// The media type of a Content-Type header without its parameters
// (`application/json` for `Application/JSON; charset=utf-8`).
function mediaType(contentType: string | null): string | undefined {
  return contentType?.split(";")[0].trim().toLowerCase() || undefined;
}

function tooLarge(maxBodySize: number): EntityTooLargeException {
  return new EntityTooLargeException(
    `Max. body size of ${maxBodySize} bytes exceeded`,
  );
}

export function readToMaxSize(
  stream: ReadableStream<Uint8Array>,
  maxBodySize: number,
): Promise<Uint8Array> {
  return readAll(stream.getReader(), maxBodySize);
}

async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBodySize: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (totalLength + value.byteLength > maxBodySize) {
      // Stop the upload instead of leaving the stream locked and unread.
      void reader.cancel().catch(() => {});
      throw tooLarge(maxBodySize);
    }
    chunks.push(value);
    totalLength += value.byteLength;
  }
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }
  if (chunks.length === 1) {
    return chunks[0];
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
