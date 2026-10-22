import type { App } from "../../app.ts";
import type { RequestContext } from "../request.ts";
import { serveFile } from "./serve-file.ts";

/**
 * Task to load a favicon from the provided path
 * and register a route (/favicon.ico) to it.
 * @param {string} path - Path to the location of the favicon
 * @param {App} app - Huuma/Route application to register the favicon
 */
export function Favicon(path: string, app: App) {
  const handler = (ctx: RequestContext) =>
    serveFile(ctx.request, path, {
      contentType: "image/vnd.microsoft.icon",
      streaming: true,
    });
  app.get("/favicon.ico", handler);
  app.head("/favicon.ico", handler);
}
