import type { Cargo } from "../../cargo.ts";
import { isProd } from "../../utils/environment.ts";
import { extension } from "../../utils/file.ts";
import { log } from "../../utils/logger.ts";
import { mimeTypeByExtension } from "../../utils/mime-types.ts";

export type AssetsOptions = {
  enableResponseStreaming?: boolean;
};

export async function loadAssets(
  path: string,
  cargo: Cargo,
  options?: AssetsOptions,
): Promise<Cargo> {
  try {
    for await (const file of Deno.readDir(path)) {
      if (file.isDirectory || file.isSymlink) {
        await loadAssets(`${path}/${file.name}`, cargo, options);
      } else {
        registerAssets(
          `${path}/${file.name}`,
          cargo,
          options?.enableResponseStreaming,
        );
      }
    }
  } catch (_err: unknown) {
    log("HTTP CONTEXT", `No routes from the '${path}' directory loaded!`);
  }
  return cargo;
}

function registerAssets(
  path: string,
  cargo: Cargo,
  streamResponse?: boolean,
): void {
  cargo.get(`/${path}`, async () => {
    return new Response(
      streamResponse
        ? (await Deno.open(path)).readable
        : await Deno.readFile(path),
      {
        headers: {
          "Content-Type":
            mimeTypeByExtension(extension(path))?.type || "text/plain",
          ...(isProd() ? { "Cache-Control": "max-age=3600" } : {}),
        },
      },
    );
  });
}
