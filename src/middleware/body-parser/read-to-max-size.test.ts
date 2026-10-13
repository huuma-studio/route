import { describe, expect, it } from "bun:test";
import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import { readToMaxSize } from "./body-parser.ts";

const encoder = new TextEncoder();
const encode = (value: string): Uint8Array => encoder.encode(value);

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("readToMaxSize:", () => {
  it("returns empty Uint8Array for empty stream", async () => {
    const result = await readToMaxSize(streamOf(), 10);
    expect(result).toEqual(new Uint8Array(0));
  });

  it("returns single chunk unchanged", async () => {
    const result = await readToMaxSize(streamOf(encode("hello")), 100);
    expect(result).toEqual(encode("hello"));
  });

  it("concatenates multiple chunks in order", async () => {
    const result = await readToMaxSize(
      streamOf(encode("foo"), encode("bar"), encode("baz")),
      100,
    );
    expect(result).toEqual(encode("foobarbaz"));
  });

  it("accepts body exactly equal to max size", async () => {
    const result = await readToMaxSize(streamOf(encode("abcde")), 5);
    expect(result).toEqual(encode("abcde"));
  });

  it("rejects single chunk exceeding max size", async () => {
    await expect(readToMaxSize(streamOf(encode("abcdefgh")), 5)).rejects
      .toThrow(EntityTooLargeException);
  });

  it("rejects when chunks combined exceed max size but none alone does", async () => {
    // 6 + 6 = 12 > 10, but each chunk is only 6 bytes (under the 10-byte limit).
    await expect(
      readToMaxSize(streamOf(encode("abcdef"), encode("ghijkl")), 10),
    ).rejects.toThrow(EntityTooLargeException);
  });

  it("rejects when many small chunks combined exceed max size", async () => {
    const chunks = Array.from({ length: 10 }, () => encode("ab")); // 20 bytes total
    await expect(readToMaxSize(streamOf(...chunks), 10)).rejects.toThrow(
      EntityTooLargeException,
    );
  });

  it("accepts many small chunks that fit within max size", async () => {
    const chunks = Array.from({ length: 5 }, () => encode("ab")); // 10 bytes total
    const result = await readToMaxSize(streamOf(...chunks), 10);
    expect(result).toEqual(encode("ababababab"));
  });
});
