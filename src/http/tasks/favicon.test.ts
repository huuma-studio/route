import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { App } from "../../app.ts";
import { Favicon } from "./favicon.ts";

const ICON = new Uint8Array([0, 0, 1, 0, 1, 0]);

function getFavicon(app: App): Promise<Response> {
  return app.handle(new Request("http://localhost/favicon.ico"));
}

describe("Favicon", () => {
  it("serves the icon", async () => {
    const root = await mkdtemp(join(tmpdir(), "huuma-route-favicon-"));
    try {
      const path = join(root, "favicon.ico");
      await writeFile(path, ICON);
      const app = new App();
      Favicon(path, app);

      const response = await getFavicon(app);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "image/vnd.microsoft.icon",
      );
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(ICON);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("answers 404 when the icon is missing", async () => {
    const app = new App();
    Favicon(join(tmpdir(), "huuma-route-missing-favicon.ico"), app);

    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const response = await getFavicon(app);
      await response.body?.cancel();
      expect(response.status).toBe(404);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("answers HEAD without a body", async () => {
    const root = await mkdtemp(join(tmpdir(), "huuma-route-favicon-"));
    try {
      const path = join(root, "favicon.ico");
      await writeFile(path, ICON);
      const app = new App();
      Favicon(path, app);

      const response = await app.handle(
        new Request("http://localhost/favicon.ico", { method: "HEAD" }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Length")).toBe(String(ICON.length));
      expect(response.body).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
