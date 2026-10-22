import { type FileHandle, open } from "node:fs/promises";
import { isProd } from "../../utils/environment.ts";
import { NotFoundException } from "../exceptions/not-found-exception.ts";
import { HttpStatus } from "../http-status.ts";
import { isNodeError, readableStream } from "./file-stream.ts";

export type ServeFileOptions = {
  contentType: string;
  /** Stream the file instead of reading it into memory. */
  streaming?: boolean;
  /** `Cache-Control` max-age in seconds, sent in production. */
  maxAge?: number;
};

type ByteRange = { start: number; end: number };

/**
 * Answers a GET or HEAD request with a file. Supports conditional requests
 * (`ETag`, `Last-Modified`) and single byte ranges. Throws
 * `NotFoundException` when the file doesn't exist (anymore).
 */
export async function serveFile(
  request: Request,
  path: string,
  options: ServeFileOptions,
): Promise<Response> {
  let handle: FileHandle;
  try {
    handle = await open(path);
  } catch (e) {
    if (isNodeError(e, "ENOENT") || isNodeError(e, "ENOTDIR")) {
      throw new NotFoundException();
    }
    throw e;
  }

  let streaming = false;
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new NotFoundException();

    const etag = `"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const headers = new Headers({
      "Content-Type": options.contentType,
      ETag: etag,
      "Last-Modified": stats.mtime.toUTCString(),
      "Accept-Ranges": "bytes",
    });
    if (isProd()) {
      headers.set("Cache-Control", `max-age=${options.maxAge ?? 3600}`);
    }

    if (isNotModified(request, etag, stats.mtime)) {
      return new Response(null, { status: HttpStatus.NOT_MODIFIED, headers });
    }

    const range = byteRange(request, stats.size, etag, stats.mtime);
    if (range === null) {
      headers.set("Content-Range", `bytes */${stats.size}`);
      return new Response(null, {
        status: HttpStatus.RANGE_NOT_SATISFIABLE,
        headers,
      });
    }
    const { start, end } = range ?? { start: 0, end: stats.size - 1 };
    const length = end - start + 1;
    headers.set("Content-Length", String(length));
    if (range)
      headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
    const status = range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

    if (request.method === "HEAD" || length === 0) {
      return new Response(null, { status, headers });
    }
    if (options.streaming) {
      streaming = true;
      return new Response(readableStream(handle, { start, end }), {
        status,
        headers,
      });
    }
    return new Response(await read(handle, start, length), { status, headers });
  } finally {
    // A streamed file is closed when its stream ends.
    if (!streaming) await handle.close();
  }
}

async function read(
  handle: FileHandle,
  start: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      length - offset,
      start + offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset === length ? buffer : buffer.slice(0, offset);
}

function isNotModified(request: Request, etag: string, mtime: Date): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch !== null) {
    // Weak comparison (RFC 9110, 13.1.2).
    return ifNoneMatch
      .split(",")
      .some(
        (tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag,
      );
  }
  const ifModifiedSince = Date.parse(
    request.headers.get("if-modified-since") ?? "",
  );
  return !Number.isNaN(ifModifiedSince) && seconds(mtime) <= ifModifiedSince;
}

/**
 * The requested byte range: `undefined` for the whole file, `null` when the
 * range can't be satisfied. Multiple ranges get the whole file, which RFC
 * 9110 (14.2) allows.
 */
function byteRange(
  request: Request,
  size: number,
  etag: string,
  mtime: Date,
): ByteRange | null | undefined {
  const header = request.headers.get("range");
  if (!header) return undefined;

  const ifRange = request.headers.get("if-range");
  if (ifRange !== null) {
    const matches = ifRange.startsWith('"')
      ? ifRange === etag
      : Date.parse(ifRange) === seconds(mtime);
    if (!matches) return undefined;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return undefined;

  if (match[1] === "") {
    // A suffix: the last n bytes.
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
}

// HTTP dates have a precision of seconds.
function seconds(date: Date): number {
  return Math.floor(date.getTime() / 1000) * 1000;
}
