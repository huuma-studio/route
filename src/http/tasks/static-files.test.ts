import { assertEquals, assertMatch } from "@std/assert";
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
import { App } from "../../app.ts";
import { loadStaticFiles, registerStaticFiles } from "./static-files.ts";

const HUUMA_ENV = "HUUMA_ENV";
const CONNECTION = { remoteAddr: { transport: "tcp" } };

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
  return app.handle(new Request(`http://localhost${path}`), CONNECTION);
}

Deno.test(loadStaticFiles.name, async (t) => {
  await t.step("registers files in nested directories", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          assertEquals(response.status, 200);
          assertEquals(await response.text(), content);
        }
      });
      assertEquals(streamed, 0);
    });
  });

  await t.step("follows symlinked directories", async () => {
    await withFixture(async (directory) => {
      await symlink(join(directory, "css"), join(directory, "styles"));
      const app = await loadStaticFiles(new App(), { directory });
      const response = await get(app, "/styles/app.css");
      assertEquals(response.status, 200);
      assertEquals(await response.text(), FILES["css/app.css"]);
    });
  });

  await t.step("sets the content type from the file extension", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory });
      const html = await get(app, "/index.html");
      await html.body?.cancel();
      assertMatch(html.headers.get("Content-Type") ?? "", /^text\/html/);
      const css = await get(app, "/css/app.css");
      await css.body?.cancel();
      assertMatch(css.headers.get("Content-Type") ?? "", /^text\/css/);
    });
  });

  await t.step("streams files when response streaming is enabled", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), {
        directory,
        enableResponseStreaming: true,
      });
      const streamed = await countStreamedFiles(directory, async () => {
        for (const [path, content] of Object.entries(FILES)) {
          const response = await get(app, `/${path}`);
          assertEquals(await response.text(), content);
        }
      });
      assertEquals(streamed, Object.keys(FILES).length);
    });
  });

  await t.step("sets Cache-Control only in production", async () => {
    await withFixture(async (directory) => {
      const app = await loadStaticFiles(new App(), { directory, maxAge: 60 });

      await withEnvironment("DEV", async () => {
        const response = await get(app, "/index.html");
        await response.body?.cancel();
        assertEquals(response.headers.get("Cache-Control"), null);
      });

      await withEnvironment("PROD", async () => {
        const response = await get(app, "/index.html");
        await response.body?.cancel();
        assertEquals(response.headers.get("Cache-Control"), "max-age=60");
      });
    });
  });

  await t.step("logs instead of throwing for a missing directory", async () => {
    const warn = console.warn;
    const messages: string[] = [];
    console.warn = (message: string) => messages.push(message);
    try {
      await loadStaticFiles(new App(), {
        directory: join(tmpdir(), "huuma-route-missing-static"),
      });
    } finally {
      console.warn = warn;
    }
    assertEquals(messages.length, 1);
    assertMatch(messages[0], /No routes from the '.*' directory loaded!/);
  });
});

Deno.test(registerStaticFiles.name, async (t) => {
  await t.step("defaults Cache-Control max-age to 3600", async () => {
    await withFixture(async (directory) => {
      const app = registerStaticFiles(new App(), {
        directory,
        path: "css/app.css",
      });
      await withEnvironment("PROD", async () => {
        const response = await get(app, "/css/app.css");
        assertEquals(await response.text(), FILES["css/app.css"]);
        assertEquals(response.headers.get("Cache-Control"), "max-age=3600");
      });
    });
  });

  await t.step("streams a single file", async () => {
    await withFixture(async (directory) => {
      const app = registerStaticFiles(new App(), {
        directory,
        path: "js/vendor/lib.js",
        enableResponseStreaming: true,
      });
      const streamed = await countStreamedFiles(directory, async () => {
        const response = await get(app, "/js/vendor/lib.js");
        assertEquals(await response.text(), FILES["js/vendor/lib.js"]);
      });
      assertEquals(streamed, 1);
    });
  });
});
