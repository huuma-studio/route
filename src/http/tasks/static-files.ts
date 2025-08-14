import type { App } from "../../app.ts";
import { isProd } from "../../utils/environment.ts";
import { extension } from "../../utils/file.ts";
import { log } from "../../utils/logger.ts";
import { mimeTypeByExtension } from "../../utils/mime-types.ts";

const DEFAULT_DIRECTORY = "static";

export type StaticFilesOptions = {
  enableResponseStreaming?: boolean;
  directory?: string;
  path?: string;
};

export async function loadStaticFiles(
  app: App,
  options?: StaticFilesOptions,
): Promise<App> {
  const directory = options?.directory ?? DEFAULT_DIRECTORY;
  try {
    for await (
      const file of Deno.readDir(
        filePath(directory, options?.path),
      )
    ) {
      if (file.isDirectory || file.isSymlink) {
        await loadStaticFiles(app, {
          ...options,
          directory,
          path: options?.path ? `${options.path}/${file.name}` : file.name,
        });
      } else {
        registerStaticFiles(
          app,
          {
            directory,
            path: options?.path ? `${options.path}/${file.name}` : file.name,
          },
        );
      }
    }
  } catch (_err: unknown) {
    log(
      "HTTP CONTEXT",
      `No routes from the '${
        filePath(directory, options?.path)
      }' directory loaded!`,
    );
  }
  return app;
}

interface RegisterStaticFileOptions {
  enableResponseStreaming?: boolean;
  directory: string;
  path: string;
}

export function registerStaticFiles(
  app: App,
  options: RegisterStaticFileOptions,
): App {
  const file = filePath(options.directory, options.path);
  app.get(`/${options.path}`, async () => {
    return new Response(
      options.enableResponseStreaming
        ? (await Deno.open(file)).readable
        : await Deno.readFile(file),
      {
        headers: {
          "Content-Type": mimeTypeByExtension(extension(options.path))?.type ||
            "text/plain",
          ...(isProd() ? { "Cache-Control": "max-age=3600" } : {}),
        },
      },
    );
  });
  return app;
}

function filePath(directory: string, path?: string): string {
  return path ? `${directory}/${path}` : directory;
}
