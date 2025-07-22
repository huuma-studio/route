import { parse } from "@std/path/parse";
import type { App } from "../../app.ts";
import { isProd } from "../../utils/environment.ts";
import { extension } from "../../utils/file.ts";
import { log } from "../../utils/logger.ts";
import { mimeTypeByExtension } from "../../utils/mime-types.ts";

export type AssetsOptions = {
  enableResponseStreaming?: boolean;
};

export async function loadAssets(
  path: string,
  app: App,
  options?: AssetsOptions,
): Promise<App> {
  try {
    for await (const file of Deno.readDir(path)) {
      if (file.isDirectory || file.isSymlink) {
        await loadAssets(`${path}/${file.name}`, app, options);
      } else {
        registerAssets(
          `${path}/${file.name}`,
          app,
          options?.enableResponseStreaming,
        );
      }
    }
  } catch (_err: unknown) {
    log("HTTP CONTEXT", `No routes from the '${path}' directory loaded!`);
  }
  return app;
}

function registerAssets(
  path: string,
  app: App,
  streamResponse?: boolean,
): void {
  app.get(`/_huuma/static${parse(path).base}`, async () => {
    return new Response(
      streamResponse
        ? (await Deno.open(path)).readable
        : await Deno.readFile(path),
      {
        headers: {
          "Content-Type": mimeTypeByExtension(extension(path))?.type ||
            "text/plain",
          ...(isProd() ? { "Cache-Control": "max-age=3600" } : {}),
        },
      },
    );
  });
}
