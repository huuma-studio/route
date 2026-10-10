import {
  type FileHandle,
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, spyOn } from "bun:test";
import { App } from "../../app.ts";
import { loadStaticFiles, registerStaticFiles } from "./static-files.ts";

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

// Counts the files served through `FileHandle.createReadStream`, so streaming
// can be told apart from buffering, which returns the same bytes.
async function countStreamedFiles(
  directory: string,
  fn: () => Promise<void>,
): Promise<number> {
  const handle = await open(join(directory, "index.html"));
  const prototype = Object.getPrototypeOf(handle) as FileHandle;
  await handle.close();

  const createReadStream = prototype.createReadStream;
  let count = 0;
  prototype.createReadStream = function (
    this: FileHandle,
    ...args: Parameters<FileHandle["createReadStream"]>
  ) {
    count++;
    return createReadStream.apply(this, args);
  };
  try {
    await fn();
  } finally {
    prototype.createReadStream = createReadStream;
  }
  return count;
}

function get(app: App, path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`));
}

describe("loadStaticFiles", () => {
  it("registers files in nested directories", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          expect(response.status).toEqual(200);
          expect(await response.text()).toEqual(content);
        }
      });
      expect(streamed).toEqual(0);
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
    const warn = spyOn(console, "warn").mockImplementation((message) => {
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
