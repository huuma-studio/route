import { assert, assertEquals } from "@std/assert";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNodeError, readableStream } from "./file-stream.ts";

const CONTENT = "Hello, Huuma!";

async function withFile(fn: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "huuma-route-file-stream-"));
  try {
    const path = join(root, "file.txt");
    await writeFile(path, CONTENT);
    await fn(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

Deno.test(readableStream.name, async (t) => {
  await t.step("streams the file and closes it at the end", async () => {
    await withFile(async (path) => {
      const handle = await open(path);
      assertEquals(await new Response(readableStream(handle)).text(), CONTENT);
      assertEquals(handle.fd, -1);
    });
  });

  await t.step("closes the file when the stream is cancelled", async () => {
    await withFile(async (path) => {
      const handle = await open(path);
      await readableStream(handle).cancel();
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(handle.fd, -1);
    });
  });
});

Deno.test(isNodeError.name, async (t) => {
  await t.step("matches the errno code of filesystem errors", async () => {
    const error = await open(join(tmpdir(), "huuma-route-missing-file"))
      .catch((e) => e);
    assert(isNodeError(error, "ENOENT"));
    assert(!isNodeError(error, "EACCES"));
  });

  await t.step("rejects values without a code", () => {
    assert(!isNodeError(new Error("ENOENT"), "ENOENT"));
    assert(!isNodeError({ code: "ENOENT" }, "ENOENT"));
  });
});
