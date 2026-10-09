import { open } from "node:fs/promises";
import type { App } from "../../app.ts";
import { isProd } from "../../utils/environment.ts";
import { isNodeError, readableStream } from "./file-stream.ts";

/**
 * Task to load a favicon from the provided path
 * and register a route (/favicon.ico) to it.
 * @param {string} path - Path to the location of the favicon
 * @param {App} app - Huuma/Route application to register the favicon
 */
export function Favicon(path: string, app: App) {
  app.get("/favicon.ico", async () => {
    try {
      const file = await open(path);
      return new Response(
        readableStream(file),
        {
          headers: {
            "Content-Type": "image/vnd.microsoft.icon",
            ...(isProd() ? { "Cache-Control": "max-age=3600" } : {}),
          },
        },
      );
    } catch (e) {
      if (isNodeError(e, "ENOENT")) {
        throw new Error("Not able to load favicon");
      }
      throw e;
    }
  });
}
