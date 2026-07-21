import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import { UnsupportedMediaTypeException } from "../../http/exceptions/unsupported-media-type-exception.ts";
import type { RequestContext } from "../../http/request.ts";
import type { Middleware, Next } from "../middleware.ts";
import { JSONParser } from "./json-parser.ts";

export interface Parser<T> {
  mimeType: string;
  parse: (buffer: Uint8Array) => T;
}

export interface BodyParserOptions {
  maxBodySize: number;
  paser?: Parser<unknown>[];
}

const defaultOptions: BodyParserOptions = {
  maxBodySize: 1024,
  paser: [JSONParser],
};

export function bodyParser(
  parserOptions?: Partial<BodyParserOptions>,
): Middleware {
  const options = { ...defaultOptions, ...parserOptions };
  return async (ctx: RequestContext, next: Next) => {
    if (!ctx.request.body) {
      return next();
    }
    const buffer = await readToMaxSize(
      ctx.request.body,
      options.maxBodySize,
    );
    ctx.rawContent = buffer;
    const contentType = ctx.request.headers.get("content-type")?.split(" ")[0]
      ?.replace(";", "");
    if (contentType) {
      const parser = options.paser?.find((parser) => {
        return parser.mimeType === contentType;
      });
      if (typeof parser?.parse !== "function") {
        throw new UnsupportedMediaTypeException(
          "Content type of request not supported",
        );
      }
      ctx.body = parser.parse(buffer);
    }
    return next();
  };
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
      throw new EntityTooLargeException(
        `Max. body size of ${maxBodySize} bytes exceeded`,
      );
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
