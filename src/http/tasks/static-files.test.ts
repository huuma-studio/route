import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { statSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vite-plus/test";
import { App } from "../../app.ts";
import {
  loadStaticFiles,
  registerStaticFiles,
  routePath,
} from "./static-files.ts";

const HUUMA_ENV = "HUUMA_ENV";

const FILES: Record<string, string> = {
  "index.html": "<h1>Hello</h1>",
  "css/app.css": "body { margin: 0; }",
  "js/vendor/lib.js": "export const lib = 1;",
};

async function withFixture(
  fn: (directory: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "huuma-route-static-"));
  const directory = join(root, "static");
  try {
    for (const [path, content] of Object.entries(FILES)) {
      const file = join(directory, path);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, content);
    }
    await fn(directory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function withEnvironment(
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const original = process.env[HUUMA_ENV];
  if (value === undefined) delete process.env[HUUMA_ENV];
  else process.env[HUUMA_ENV] = value;
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env[HUUMA_ENV];
    else process.env[HUUMA_ENV] = original;
  }
}

// Calls `before` ahead of every call of `FileHandle[method]` while `fn` runs.
async function beforeFileHandle(
  file: string,
  method: "read" | "createReadStream",
  before: (handle: FileHandle) => void,
  fn: () => Promise<void>,
): Promise<void> {
  const handle = await open(file);
  const prototype = Object.getPrototypeOf(handle) as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  await handle.close();

  const original = prototype[method];
  prototype[method] = function (this: FileHandle, ...args: unknown[]) {
    before(this);
    return original.apply(this, args);
  };
  try {
    await fn();
  } finally {
    prototype[method] = original;
  }
}

// Counts the files served through `FileHandle.createReadStream`, so streaming
// can be told apart from buffering, which returns the same bytes.
async function countStreamedFiles(
  directory: string,
  fn: () => Promise<void>,
): Promise<number> {
  let count = 0;
  await beforeFileHandle(
    join(directory, "index.html"),
    "createReadStream",
    () => count++,
    fn,
  );
  return count;
}

// Shortens `file` by one byte before each of the first `times` calls of
// `FileHandle[method]`, as an in-place update would.
function withShrinkingFile(
  file: string,
  method: "read" | "createReadStream",
  times: number,
  fn: () => Promise<void>,
): Promise<void> {
  let shrunk = 0;
  return beforeFileHandle(
    file,
    method,
    () => {
      const { size } = statSync(file);
      if (shrunk++ < times && size > 0) truncateSync(file, size - 1);
    },
    fn,
  );
}

function get(app: App, path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

describe("loadStaticFiles", () => {
  it("registers and streams files in nested directories by default", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          expect(response.status).toEqual(200);
          expect(await response.text()).toEqual(content);
        }
      });
      expect(streamed).toEqual(Object.keys(FILES).length);
    });
  });

  it("follows symlinked directories", async () => {
    await withFixture(async (directory) => {
      await symlink(join(directory, "css"), join(directory, "styles"));
      const app = await loadStaticFiles(new App(), { directory });
      const response = await get(app, "/styles/app.css");
      expect(response.status).toEqual(200);
      expect(await response.text()).toEqual(FILES["css/app.css"]);
    });
  });

  describe("hidden files", () => {
    const HIDDEN: Record<string, string> = {
      ".env": "SECRET=1",
      ".git/config": "[core]",
      "css/.cache": "cached",
      "css/.private/key.txt": "key",
      ".well-known/security.txt": "Contact: mailto:security@example.com",
      ".well-known/.hidden": "hidden",
    };

    async function withHiddenFiles(
      fn: (directory: string) => Promise<void>,
    ): Promise<void> {
      await withFixture(async (directory) => {
        for (const [path, content] of Object.entries(HIDDEN)) {
          const file = join(directory, path);
          await mkdir(join(file, ".."), { recursive: true });
          await writeFile(file, content);
        }
        await fn(directory);
      });
    }

    it("skips files and directories whose names start with a dot", async () => {
      await withHiddenFiles(async (directory) => {
        const app = await loadStaticFiles(new App(), { directory });
        for (const path of [
          "/.env",
          "/.git/config",
          "/css/.cache",
          "/css/.private/key.txt",
          "/.well-known/.hidden",
        ]) {
          const response = await get(app, path);
          await response.body?.cancel();
          expect(response.status, path).toEqual(404);
        }
        expect((await get(app, "/css/app.css")).status).toEqual(200);
      });
    });

    it("serves .well-known", async () => {
      await withHiddenFiles(async (directory) => {
        const app = await loadStaticFiles(new App(), { directory });
        const response = await get(app, "/.well-known/security.txt");
        expect(response.status).toEqual(200);
        expect(await response.text()).toEqual(
          HIDDEN[".well-known/security.txt"],
        );
      });
    });

    it("skips a hidden path option", async () => {
      await withHiddenFiles(async (directory) => {
        for (const [path, file] of [
          [".git", "/.git/config"],
          ["css/.private", "/css/.private/key.txt"],
        ]) {
          const app = await loadStaticFiles(new App(), { directory, path });
          const response = await get(app, file);
          await response.body?.cancel();
          expect(response.status, path).toEqual(404);
        }
      });
    });

    it("serves a hidden path option with dotfiles: true", async () => {
      await withHiddenFiles(async (directory) => {
        const app = await loadStaticFiles(new App(), {
          directory,
          path: "css/.private",
          dotfiles: true,
        });
        const response = await get(app, "/css/.private/key.txt");
        expect(response.status).toEqual(200);
        expect(await response.text()).toEqual("key");
      });
    });

    it("serves .well-known as the path option", async () => {
      await withHiddenFiles(async (directory) => {
        const app = await loadStaticFiles(new App(), {
          directory,
          path: ".well-known",
        });
        const served = await get(app, "/.well-known/security.txt");
        expect(served.status).toEqual(200);
        expect(await served.text()).toEqual(HIDDEN[".well-known/security.txt"]);
        const hidden = await get(app, "/.well-known/.hidden");
        await hidden.body?.cancel();
        expect(hidden.status).toEqual(404);
      });
    });

    it("serves hidden files with dotfiles: true", async () => {
      await withHiddenFiles(async (directory) => {
        const app = await loadStaticFiles(new App(), {
          directory,
          dotfiles: true,
        });
        for (const [path, content] of Object.entries(HIDDEN)) {
          const response = await get(app, `/${path}`);
          expect(response.status, path).toEqual(200);
          expect(await response.text()).toEqual(content);
        }
      });
    });
  });

  it("sets the content type from the file extension", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory });
      const html = await get(app, "/index.html");
      await html.body?.cancel();
      expect(html.headers.get("Content-Type") ?? "").toMatch(/^text\/html/);
      const css = await get(app, "/css/app.css");
      await css.body?.cancel();
      expect(css.headers.get("Content-Type") ?? "").toMatch(/^text\/css/);
    });
  });

  it("streams files when response streaming is enabled", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), {
        directory,
        enableResponseStreaming: true,
      });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          expect(await response.text()).toEqual(content);
        }
      });
      expect(streamed).toEqual(Object.keys(FILES).length);
    });
  });

  it("buffers files when response streaming is explicitly disabled", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), {
        directory,
        enableResponseStreaming: false,
      });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          expect(await response.text()).toEqual(content);
        }
      });
      expect(streamed).toBe(0);
    });
  });

  it("streams large files without buffering and closes them on cancellation", async () => {
    await withFixture(async (directory) => {
      const file = join(directory, "large.bin");
      const size = 32 * 1024 * 1024;
      const fixture = await open(file, "w");
      await fixture.truncate(size);
      await fixture.close();
      const app = registerStaticFiles(new App(), {
        directory,
        path: "large.bin",
      });
      let opened: FileHandle | undefined;
      let bufferedReads = 0;
      await beforeFileHandle(
        file,
        "createReadStream",
        (handle) => {
          opened = handle;
        },
        async () => {
          await beforeFileHandle(
            file,
            "read",
            () => bufferedReads++,
            async () => {
              const response = await get(app, "/large.bin");
              const reader = response.body!.getReader();
              try {
                expect(response.headers.get("Content-Length")).toBe(
                  String(size),
                );
                expect(opened).toBeDefined();
                expect(bufferedReads).toBe(0);
                const chunk = await reader.read();
                expect(chunk.done).toBe(false);
                expect(chunk.value!.byteLength).toBeLessThan(size);
              } finally {
                await reader.cancel();
              }
              await vi.waitFor(() => expect(opened?.fd).toBe(-1));
            },
          );
        },
      );
    });
  });

  it("sets Cache-Control only in production", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory, maxAge: 60 });

      await withEnvironment("DEV", async () => {
        const response = await get(app, "/index.html");
        await response.body?.cancel();
        expect(response.headers.get("Cache-Control")).toEqual(null);
      });

      await withEnvironment("PROD", async () => {
        const response = await get(app, "/index.html");
        await response.body?.cancel();
        expect(response.headers.get("Cache-Control")).toEqual("max-age=60");
      });
    });
  });

  it("logs instead of throwing for a missing directory", async () => {
    const messages: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((message) => {
      messages.push(message);
    });
    try {
      await loadStaticFiles(new App(), {
        directory: join(tmpdir(), "huuma-route-missing-static"),
      });
    } finally {
      warn.mockRestore();
    }
    expect(messages.length).toEqual(1);
    expect(messages[0]).toMatch(/No routes from the '.*' directory loaded!/);
  });
});

describe("registerStaticFiles", () => {
  it("defaults Cache-Control max-age to 3600", async () => {
    await withFixture(async (directory) => {
      const app = registerStaticFiles(new App(), {
        directory,
        path: "css/app.css",
      });
      await withEnvironment("PROD", async () => {
        const response = await get(app, "/css/app.css");
        expect(await response.text()).toEqual(FILES["css/app.css"]);
        expect(response.headers.get("Cache-Control")).toEqual("max-age=3600");
      });
    });
  });

  it("streams a single file", async () => {
    await withFixture(async (directory) => {
      const app = registerStaticFiles(new App(), {
        directory,
        path: "js/vendor/lib.js",
        enableResponseStreaming: true,
      });
      const streamed = await countStreamedFiles(directory, async () => {
        const response = await get(app, "/js/vendor/lib.js");
        expect(await response.text()).toEqual(FILES["js/vendor/lib.js"]);
      });
      expect(streamed).toEqual(1);
    });
  });
});

describe("loadStaticFiles file names", () => {
  // File names and the paths a browser requests them with. `Request`
  // encodes the rest, such as spaces.
  const NAMES: Record<string, string> = {
    "a+b.txt": "/a+b.txt",
    "img(1).png": "/img(1).png",
    "my file.txt": "/my file.txt",
    "100%.txt": "/100%25.txt",
    "what?.txt": "/what%3F.txt",
    "hash#tag.txt": "/hash%23tag.txt",
    "colon:name.txt": "/colon:name.txt",
    "star*.txt": "/star*.txt",
    "{braces}.txt": "/{braces}.txt",
    "ümlaut.txt": "/ümlaut.txt",
    "trailing.txt ": "/trailing.txt%20",
    "tab\tname.txt": "/tab%09name.txt",
    "new\nline.txt": "/new%0Aline.txt",
  };

  it("serves files whose names contain URL or URLPattern syntax", async () => {
    await withFixture(async (directory) => {
      for (const name of Object.keys(NAMES)) {
        await writeFile(join(directory, name), name);
      }
      const app = await loadStaticFiles(new App(), { directory });
      for (const [name, path] of Object.entries(NAMES)) {
        const response = await get(app, path);
        expect(response.status, name).toEqual(200);
        expect(await response.text()).toEqual(name);
      }
      // The pattern no longer matches other paths.
      for (const path of ["/img1.png", "/trailing.txt", "/tabname.txt"]) {
        const response = await get(app, path);
        await response.body?.cancel();
        expect(response.status, path).toEqual(404);
      }
    });
  });

  it("escapes route paths", () => {
    expect(routePath("a+b.txt")).toEqual("/a\\+b.txt");
    expect(routePath("img(1).png")).toEqual("/img\\(1\\).png");
    expect(routePath("css/app.css")).toEqual("/css/app.css");
    expect(routePath("a.txt ")).toEqual("/a.txt%20");
    expect(routePath("a\tb.txt")).toEqual("/a%09b.txt");
  });
});

describe("loadStaticFiles symlinks and errors", () => {
  it("serves symlinked files", async () => {
    await withFixture(async (directory) => {
      await symlink(
        join(directory, "index.html"),
        join(directory, "home.html"),
      );
      const app = await loadStaticFiles(new App(), { directory });
      expect(await (await get(app, "/home.html")).text()).toEqual(
        FILES["index.html"],
      );
    });
  });

  it("stops at symlink loops and broken symlinks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withFixture(async (directory) => {
        await symlink(directory, join(directory, "css", "loop"));
        await symlink(join(directory, "gone"), join(directory, "broken.txt"));
        const app = await loadStaticFiles(new App(), { directory });
        expect(await (await get(app, "/css/app.css")).text()).toEqual(
          FILES["css/app.css"],
        );
        expect(await (await get(app, "/index.html")).text()).toEqual(
          FILES["index.html"],
        );
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("answers 404 for a file deleted after loading", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withFixture(async (directory) => {
        const app = await loadStaticFiles(new App(), { directory });
        await rm(join(directory, "index.html"));
        const response = await get(app, "/index.html");
        await response.body?.cancel();
        expect(response.status).toEqual(404);
      });
    } finally {
      error.mockRestore();
    }
  });
});

describe("static file responses", () => {
  async function withApp(
    fn: (app: App, directory: string) => Promise<void>,
    streaming?: boolean,
  ) {
    await withFixture(async (directory) => {
      await writeFile(join(directory, "digits.txt"), "0123456789");
      const app = await loadStaticFiles(new App(), {
        directory,
        enableResponseStreaming: streaming,
      });
      await fn(app, directory);
    });
  }

  it("answers HEAD with the headers and no body", async () => {
    await withApp(async (app) => {
      const response = await get(app, "/digits.txt", { method: "HEAD" });
      expect(response.status).toEqual(200);
      expect(response.headers.get("Content-Length")).toEqual("10");
      expect(response.headers.get("Accept-Ranges")).toEqual("bytes");
      expect(response.body).toBeNull();
    });
  });

  it("answers 304 for a matching ETag", async () => {
    await withApp(async (app) => {
      const first = await get(app, "/digits.txt");
      await first.body?.cancel();
      const etag = first.headers.get("ETag")!;
      expect(etag).toMatch(/^"[\w-]{27}"$/);

      for (const ifNoneMatch of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
        const response = await get(app, "/digits.txt", {
          headers: { "If-None-Match": ifNoneMatch },
        });
        expect(response.status, ifNoneMatch).toEqual(304);
        expect(response.body).toBeNull();
      }
      const changed = await get(app, "/digits.txt", {
        headers: { "If-None-Match": '"other"' },
      });
      expect(await changed.text()).toEqual("0123456789");
    });
  });

  it("gives a changed file a new ETag, also with the same size and mtime", async () => {
    await withApp(async (app, directory) => {
      const file = join(directory, "digits.txt");
      const modified = new Date("2026-01-01T00:00:00.000Z");
      await utimes(file, modified, modified);
      const first = await get(app, "/digits.txt");
      await first.body?.cancel();

      await writeFile(file, "9876543210");
      await utimes(file, modified, modified);
      const response = await get(app, "/digits.txt", {
        headers: { "If-None-Match": first.headers.get("ETag")! },
      });
      expect(response.status).toEqual(200);
      expect(response.headers.get("ETag")).not.toEqual(
        first.headers.get("ETag"),
      );
      expect(await response.text()).toEqual("9876543210");
    });
  });

  it("gives the same content the same ETag", async () => {
    await withFixture(async (directory) => {
      await writeFile(join(directory, "a.txt"), "same");
      await writeFile(join(directory, "b.txt"), "same");
      const modified = new Date("2026-01-01T00:00:00.000Z");
      await utimes(join(directory, "b.txt"), modified, modified);
      const app = await loadStaticFiles(new App(), { directory });

      const a = await get(app, "/a.txt", { method: "HEAD" });
      const b = await get(app, "/b.txt", { method: "HEAD" });
      expect(a.headers.get("ETag")).toEqual(b.headers.get("ETag"));
    });
  });

  it("hashes a version of a file once", async () => {
    await withApp(async (app, directory) => {
      const first = await get(app, "/digits.txt");
      await first.body?.cancel();

      let reads = 0;
      const file = join(directory, "digits.txt");
      await beforeFileHandle(
        file,
        "read",
        () => reads++,
        async () => {
          const response = await get(app, "/digits.txt", { method: "HEAD" });
          expect(response.headers.get("ETag")).toEqual(
            first.headers.get("ETag"),
          );
        },
      );
      expect(reads).toEqual(0);
    });
  });

  it("tags files over 16 MiB by their metadata", async () => {
    await withFixture(async (directory) => {
      const size = 16 * 1024 * 1024 + 1;
      const file = join(directory, "large.bin");
      await writeFile(file, new Uint8Array(size));
      const app = await loadStaticFiles(new App(), { directory });

      let reads = 0;
      let etag = "";
      await beforeFileHandle(
        file,
        "read",
        () => reads++,
        async () => {
          const response = await get(app, "/large.bin", { method: "HEAD" });
          etag = response.headers.get("ETag")!;
        },
      );
      expect(reads).toEqual(0);
      expect(etag).toMatch(/^"[0-9a-f]+(-[0-9a-f]+){4}"$/);

      const cached = await get(app, "/large.bin", {
        headers: { "If-None-Match": etag },
      });
      expect(cached.status).toEqual(304);

      // Unhashed files are checked while they are buffered, too.
      const bufferedApp = await loadStaticFiles(new App(), {
        directory,
        enableResponseStreaming: false,
      });
      await withShrinkingFile(file, "read", 1, async () => {
        const response = await get(bufferedApp, "/large.bin");
        expect(response.headers.get("Content-Length")).toEqual(
          String(size - 1),
        );
        expect((await response.arrayBuffer()).byteLength).toEqual(size - 1);
      });
    });
  });

  it("answers 304 when not modified since", async () => {
    await withApp(async (app, directory) => {
      const modified = new Date("2026-01-01T00:00:00.000Z");
      await utimes(join(directory, "digits.txt"), modified, modified);

      const response = await get(app, "/digits.txt", {
        headers: { "If-Modified-Since": modified.toUTCString() },
      });
      expect(response.status).toEqual(304);
      expect(response.headers.get("Last-Modified")).toEqual(
        modified.toUTCString(),
      );

      const earlier = await get(app, "/digits.txt", {
        headers: { "If-Modified-Since": "Wed, 31 Dec 2025 00:00:00 GMT" },
      });
      expect(earlier.status).toEqual(200);
      await earlier.body?.cancel();
    });
  });

  for (const streaming of [false, true]) {
    describe(streaming ? "streamed ranges" : "buffered ranges", () => {
      const cases: [string, number, string | null, string][] = [
        ["bytes=2-5", 206, "bytes 2-5/10", "2345"],
        ["bytes=7-", 206, "bytes 7-9/10", "789"],
        ["bytes=-3", 206, "bytes 7-9/10", "789"],
        ["bytes=5-100", 206, "bytes 5-9/10", "56789"],
        ["bytes=0-1, 4-5", 200, null, "0123456789"],
        ["items=0-1", 200, null, "0123456789"],
      ];
      for (const [range, status, contentRange, body] of cases) {
        it(`answers "${range}" with ${status}`, async () => {
          await withApp(async (app) => {
            const response = await get(app, "/digits.txt", {
              headers: { Range: range },
            });
            expect(response.status).toEqual(status);
            expect(response.headers.get("Content-Range")).toEqual(contentRange);
            expect(response.headers.get("Content-Length")).toEqual(
              String(body.length),
            );
            expect(await response.text()).toEqual(body);
          }, streaming);
        });
      }

      it("answers an unsatisfiable range with 416", async () => {
        await withApp(async (app) => {
          const response = await get(app, "/digits.txt", {
            headers: { Range: "bytes=10-" },
          });
          expect(response.status).toEqual(416);
          expect(response.headers.get("Content-Range")).toEqual("bytes */10");
        }, streaming);
      });
    });
  }

  it("ignores Range on HEAD", async () => {
    await withApp(async (app) => {
      for (const range of ["bytes=2-5", "bytes=10-"]) {
        const response = await get(app, "/digits.txt", {
          method: "HEAD",
          headers: { Range: range },
        });
        expect(response.status, range).toEqual(200);
        expect(response.headers.get("Content-Length")).toEqual("10");
        expect(response.headers.get("Content-Range")).toBeNull();
      }
    });
  });

  it("ignores Range when If-Range is a date", async () => {
    await withApp(async (app) => {
      const first = await get(app, "/digits.txt");
      await first.body?.cancel();
      const response = await get(app, "/digits.txt", {
        headers: {
          Range: "bytes=0-1",
          "If-Range": first.headers.get("Last-Modified")!,
        },
      });
      expect(response.status).toEqual(200);
      expect(await response.text()).toEqual("0123456789");
    });
  });

  it("answers with the new version of a file shortened while it is read", async () => {
    await withApp(async (app, directory) => {
      const file = join(directory, "digits.txt");
      await withShrinkingFile(file, "read", 1, async () => {
        const response = await get(app, "/digits.txt");
        expect(response.status).toEqual(200);
        expect(response.headers.get("Content-Length")).toEqual("9");
        expect(await response.text()).toEqual("012345678");
      });
    });
  });

  it("fails instead of answering short when the file keeps changing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withApp(async (app, directory) => {
        const file = join(directory, "digits.txt");
        await withShrinkingFile(file, "read", Infinity, async () => {
          const response = await get(app, "/digits.txt");
          expect(response.status).toEqual(500);
          await response.body?.cancel();
        });
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("fails a stream that ends before its Content-Length", async () => {
    await withApp(async (app, directory) => {
      const file = join(directory, "digits.txt");
      await withShrinkingFile(file, "createReadStream", 1, async () => {
        const response = await get(app, "/digits.txt");
        expect(response.headers.get("Content-Length")).toEqual("10");
        await expect(response.text()).rejects.toThrow();
      });
    }, true);
  });

  it("ignores Range when If-Range doesn't match", async () => {
    await withApp(async (app) => {
      const response = await get(app, "/digits.txt", {
        headers: { Range: "bytes=0-1", "If-Range": '"stale"' },
      });
      expect(response.status).toEqual(200);
      expect(await response.text()).toEqual("0123456789");

      const etag = response.headers.get("ETag")!;
      const ranged = await get(app, "/digits.txt", {
        headers: { Range: "bytes=0-1", "If-Range": etag },
      });
      expect(ranged.status).toEqual(206);
      expect(await ranged.text()).toEqual("01");
    });
  });
});
