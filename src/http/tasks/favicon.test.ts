import { assertEquals } from "@std/assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../app.ts";
import { Favicon } from "./favicon.ts";

const CONNECTION = { remoteAddr: { transport: "tcp" } };
const ICON = new Uint8Array([0, 0, 1, 0, 1, 0]);

function getFavicon(app: App): Promise<Response> {
  return app.handle(
    new Request("http://localhost/favicon.ico"),
    CONNECTION,
  );
}

Deno.test(Favicon.name, async (t) => {
  await t.step("serves the icon", async () => {
    const root = await mkdtemp(join(tmpdir(), "huuma-route-favicon-"));
    try {
      const path = join(root, "favicon.ico");
      await writeFile(path, ICON);
      const app = new App();
      Favicon(path, app);

      const response = await getFavicon(app);
      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("Content-Type"),
        "image/vnd.microsoft.icon",
      );
      assertEquals(new Uint8Array(await response.arrayBuffer()), ICON);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.step("throws when the icon is missing", async () => {
    const app = new App();
    Favicon(join(tmpdir(), "huuma-route-missing-favicon.ico"), app);

    const error = console.error;
    const errors: unknown[] = [];
    console.error = (e: unknown) => errors.push(e);
    try {
      const response = await getFavicon(app);
      await response.body?.cancel();
      assertEquals(response.status, 500);
    } finally {
      console.error = error;
    }
    assertEquals(errors.length, 1);
    assertEquals((errors[0] as Error).message, "Not able to load favicon");
  });
});
