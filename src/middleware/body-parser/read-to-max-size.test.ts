import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import { assertEquals, assertRejects } from "@std/assert";
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

Deno.test("readToMaxSize:", async (t) => {
  await t.step("returns empty Uint8Array for empty stream", async () => {
    const result = await readToMaxSize(streamOf(), 10);
    assertEquals(result, new Uint8Array(0));
  });

  await t.step("returns single chunk unchanged", async () => {
    const result = await readToMaxSize(streamOf(encode("hello")), 100);
    assertEquals(result, encode("hello"));
  });

  await t.step("concatenates multiple chunks in order", async () => {
    const result = await readToMaxSize(
      streamOf(encode("foo"), encode("bar"), encode("baz")),
      100,
    );
    assertEquals(result, encode("foobarbaz"));
  });

  await t.step("accepts body exactly equal to max size", async () => {
    const result = await readToMaxSize(streamOf(encode("abcde")), 5);
    assertEquals(result, encode("abcde"));
  });

  await t.step("rejects single chunk exceeding max size", async () => {
    await assertRejects(
      () => readToMaxSize(streamOf(encode("abcdefgh")), 5),
      EntityTooLargeException,
    );
  });

  await t.step(
    "rejects when chunks combined exceed max size but none alone does",
    async () => {
      // 6 + 6 = 12 > 10, but each chunk is only 6 bytes (under the 10-byte limit).
      await assertRejects(
        () => readToMaxSize(streamOf(encode("abcdef"), encode("ghijkl")), 10),
        EntityTooLargeException,
      );
    },
  );

  await t.step("rejects when many small chunks combined exceed max size", async () => {
    const chunks = Array.from({ length: 10 }, () => encode("ab")); // 20 bytes total
    await assertRejects(
      () => readToMaxSize(streamOf(...chunks), 10),
      EntityTooLargeException,
    );
  });

  await t.step("accepts many small chunks that fit within max size", async () => {
    const chunks = Array.from({ length: 5 }, () => encode("ab")); // 10 bytes total
    const result = await readToMaxSize(streamOf(...chunks), 10);
    assertEquals(result, encode("ababababab"));
  });
});