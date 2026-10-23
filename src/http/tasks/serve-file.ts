import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { isProd } from "../../utils/environment.ts";
import { NotFoundException } from "../exceptions/not-found-exception.ts";
import { HttpStatus } from "../http-status.ts";
import { isNodeError, readableStream } from "./file-stream.ts";

export type ServeFileOptions = {
  contentType: string;
  /** Stream the file instead of reading it into memory. Default: true. */
  streaming?: boolean;
  /** `Cache-Control` max-age in seconds, sent in production. */
  maxAge?: number;
};

type ByteRange = { start: number; end: number };

/** Larger files get their ETag from their metadata instead of a hash. */
const HASHED_SIZE_LIMIT = 16 * 1024 * 1024;

type Tag = { version: string; etag: Promise<string> };

// The ETags of the files served so far, by path, with the version of the
// file they were computed for.
const tags = new Map<string, Tag>();

/** The file changed while it was read. */
class FileChangedError extends Error {}

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
  try {
    return await respond(request, path, options);
  } catch (e) {
    // Answer with the new version. A second change is an error.
    if (e instanceof FileChangedError) return respond(request, path, options);
    throw e;
  }
}

async function respond(
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
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) throw new NotFoundException();
    const size = Number(stats.size);

    const etag = await entityTag(handle, path, stats);
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

    // Ranges are only defined for GET (RFC 9110, 14.2).
    const range =
      request.method === "GET" ? byteRange(request, size, etag) : undefined;
    if (range === null) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, {
        status: HttpStatus.RANGE_NOT_SATISFIABLE,
        headers,
      });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const length = end - start + 1;
    headers.set("Content-Length", String(length));
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    const status = range ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;

    if (request.method === "HEAD" || length === 0) {
      return new Response(null, { status, headers });
    }
    if (options.streaming !== false) {
      streaming = true;
      return new Response(
        readableStream(handle, { start, end }).pipeThrough(exactly(length)),
        { status, headers },
      );
    }
    return new Response(await read(handle, start, length), { status, headers });
  } finally {
    // A streamed file is closed when its stream ends.
    if (!streaming) await handle.close();
  }
}

/**
 * A hash of the content, so a file gets a new tag whenever its content
 * changes, even when its size and modification time stay the same, and the
 * same tag on every server. It's computed once per version of the file.
 * Files over `HASHED_SIZE_LIMIT` get a tag from their metadata, which also
 * changes with the content, but differs between servers.
 */
async function entityTag(
  handle: FileHandle,
  path: string,
  stats: BigIntStats,
): Promise<string> {
  const version = versionOf(stats);
  if (stats.size > HASHED_SIZE_LIMIT) return `"${version}"`;

  const cached = tags.get(path);
  if (cached?.version === version) return cached.etag;
  // Concurrent requests for a new version share one hash.
  const etag = hash(handle, Number(stats.size), version);
  tags.set(path, { version, etag });
  try {
    return await etag;
  } catch (e) {
    if (tags.get(path)?.etag === etag) tags.delete(path);
    throw e;
  }
}

async function hash(
  handle: FileHandle,
  size: number,
  version: string,
): Promise<string> {
  const digest = createHash("sha1");
  const buffer = new Uint8Array(Math.min(size, 64 * 1024));
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, size - offset),
      offset,
    );
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  // A tag for content that changed while it was hashed would be wrong.
  if (
    offset < size ||
    versionOf(await handle.stat({ bigint: true })) !== version
  ) {
    throw new FileChangedError("The file changed while it was hashed");
  }
  return `"${digest.digest("base64url")}"`;
}

// The ctime changes with every write, also when the mtime is restored.
function versionOf(stats: BigIntStats): string {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs]
    .map((value) => value.toString(16))
    .join("-");
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
    if (bytesRead === 0) {
      throw new FileChangedError(
        `The file ended after ${offset} of ${length} bytes`,
      );
    }
    offset += bytesRead;
  }
  return buffer;
}

/**
 * Fails a stream that ends before `length` bytes, so the runtime aborts the
 * response instead of ending it short of its `Content-Length`.
 */
function exactly(
  length: number,
): TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>> {
  let received = 0;
  return new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      if (received < length) {
        throw new FileChangedError(
          `The file ended after ${received} of ${length} bytes`,
        );
      }
    },
  });
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
): ByteRange | null | undefined {
  const header = request.headers.get("range");
  if (!header) return undefined;

  // Only the ETag proves the file is unchanged. The date form of If-Range
  // can't, as a change within the same second keeps the date; the client
  // then gets the whole file.
  const ifRange = request.headers.get("if-range");
  if (ifRange !== null && ifRange !== etag) return undefined;

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
