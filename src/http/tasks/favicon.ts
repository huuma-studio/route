import type { Cargo } from "../../cargo.ts";
import { isProd } from "../../utils/environment.ts";

/**
 * Task to load a favicon from the provided path
 * and register a route (/favicon.ico) to it.
 * @param {string} path - Path to the location of the favicon
 * @param {Cargo} app - Cargo application to register the favicon
 */
export function Favicon(path: string, app: Cargo) {
  app.get("/favicon.ico", async () => {
    try {
      const file = await Deno.open(path);
      return new Response(
        file.readable,
        {
          headers: {
            "Content-Type": "image/vnd.microsoft.icon",
            ...(isProd() ? { "Cache-Control": "max-age=3600" } : {}),
          },
        },
      );
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new Error("Not able to load favicon");
      }
      throw e;
    }
  });
}
