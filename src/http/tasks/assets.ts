import type { Cargo } from "../../cargo.ts";
import { isProd } from "../../utils/environment.ts";
import { extension } from "../../utils/file.ts";
import { log } from "../../utils/logger.ts";
import { mimeTypeByExtension } from "../../utils/mime-types.ts";

export type AssetsOptions = {
  enableStreams?: boolean;
};

export function Assets(
  path: string,
  app: Cargo,
  options?: AssetsOptions,
): () => Promise<void> {
  return async () => {
    return await loadAssets(path, app, options);
  };
}

type LoadAssetsOptions = Pick<AssetsOptions, "enableStreams">;

async function loadAssets(
  path: string,
  app: Cargo,
  options?: LoadAssetsOptions,
): Promise<void> {
  try {
    for await (const file of Deno.readDir(path)) {
      if (file.isDirectory || file.isSymlink) {
        await loadAssets(
          `${path}/${file.name}`,
          app,
          options,
        );
      } else {
        registerAssets(`${path}/${file.name}`, app, options?.enableStreams);
      }
    }
  } catch (_err: unknown) {
    log(
      "HTTP CONTEXT",
      `No routes from the '${path}' directory loaded!`,
    );
  }
}

function registerAssets(
  path: string,
  app: Cargo,
  streamResponse?: boolean,
): void {
  app.get(`/${path}`, async () => {
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
