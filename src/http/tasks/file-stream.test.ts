import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
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

describe("readableStream", () => {
  it("streams the file and closes it at the end", async () => {
    await withFile(async (path) => {
      const handle = await open(path);
      expect(await new Response(readableStream(handle)).text()).toBe(CONTENT);
      expect(handle.fd).toBe(-1);
    });
  });

  it("closes the file when the stream is cancelled", async () => {
    await withFile(async (path) => {
      const handle = await open(path);
      await readableStream(handle).cancel();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(handle.fd).toBe(-1);
    });
  });
});

describe("isNodeError", () => {
  it("matches the errno code of filesystem errors", async () => {
    const error = await open(join(tmpdir(), "huuma-route-missing-file"))
      .catch((e) => e);
    expect(isNodeError(error, "ENOENT")).toBe(true);
    expect(isNodeError(error, "EACCES")).toBe(false);
  });

  it("rejects values without a code", () => {
    expect(isNodeError(new Error("ENOENT"), "ENOENT")).toBe(false);
    expect(isNodeError({ code: "ENOENT" }, "ENOENT")).toBe(false);
  });
});
