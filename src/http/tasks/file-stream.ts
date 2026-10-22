import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Creates a Web `ReadableStream` from an open file handle, optionally of the
 * bytes from `start` to `end` (inclusive).
 * The handle is closed when the stream ends, errors or is cancelled.
 */
export function readableStream(
  handle: FileHandle,
  range?: { start?: number; end?: number },
): ReadableStream<Uint8Array<ArrayBuffer>> {
  // Node's stream/web types differ from the Web types; the runtime object is
  // a standard ReadableStream.
  return Readable.toWeb(
    handle.createReadStream(range),
  ) as unknown as ReadableStream<Uint8Array<ArrayBuffer>>;
}

/** Returns whether `error` is a filesystem error with the given errno `code` (e.g. `ENOENT`). */
export function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: unknown }).code === code
  );
}
