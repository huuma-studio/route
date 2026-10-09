import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";

/**
 * Creates a Web `ReadableStream` from an open file handle.
 * The handle is closed when the stream ends, errors or is cancelled.
 */
export function readableStream(
  handle: FileHandle,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  return Readable.toWeb(handle.createReadStream()) as ReadableStream<
    Uint8Array<ArrayBuffer>
  >;
}

/** Returns whether `error` is a filesystem error with the given errno `code` (e.g. `ENOENT`). */
export function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error &&
    (error as Error & { code?: unknown }).code === code;
}
