import { readdir, realpath, stat } from "node:fs/promises";
import type { App } from "../../app.ts";
import { extension } from "../../utils/file.ts";
import { warn as log } from "../../utils/logger.ts";
import { mimeTypeByExtension } from "../../utils/mime-types.ts";
import type { RequestContext } from "../request.ts";
import { serveFile } from "./serve-file.ts";

const DEFAULT_DIRECTORY = "static";

export type StaticFilesOptions = {
  enableResponseStreaming?: boolean;
  directory?: string;
  path?: string;
  maxAge?: number;
};

export async function loadStaticFiles(
  app: App,
  options?: StaticFilesOptions,
): Promise<App> {
  await loadDirectory(
    app,
    { ...options, directory: options?.directory ?? DEFAULT_DIRECTORY },
    [],
  );
  return app;
}

async function loadDirectory(
  app: App,
  options: StaticFilesOptions & { directory: string },
  ancestors: string[],
): Promise<void> {
  const { directory } = options;
  const current = filePath(directory, options.path);
  let files;
  let real: string;
  try {
    // A symlink can point back to a directory that contains it.
    real = await realpath(current);
    if (ancestors.includes(real)) {
      log("HTTP CONTEXT", `Skipped '${current}', a directory loop`);
      return;
    }
    files = await readdir(current, { withFileTypes: true });
  } catch (_err: unknown) {
    log("HTTP CONTEXT", `No routes from the '${current}' directory loaded!`);
    return;
  }

  for (const file of files) {
    const path = options.path ? `${options.path}/${file.name}` : file.name;
    try {
      // Follow symlinks to tell files and directories apart.
      const isDirectory = file.isSymbolicLink()
        ? (await stat(filePath(directory, path))).isDirectory()
        : file.isDirectory();
      if (isDirectory) {
        await loadDirectory(app, { ...options, path }, [...ancestors, real]);
      } else {
        registerStaticFiles(app, {
          enableResponseStreaming: options.enableResponseStreaming,
          directory,
          path,
          maxAge: options.maxAge,
        });
      }
    } catch (err: unknown) {
      // One file, such as a broken symlink, doesn't stop the others.
      log(
        "HTTP CONTEXT",
        `No route for '${filePath(directory, path)}' loaded: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

interface RegisterStaticFileOptions {
  enableResponseStreaming?: boolean;
  directory: string;
  path: string;
  maxAge?: number;
}

export function registerStaticFiles(
  app: App,
  options: RegisterStaticFileOptions,
): App {
  const file = filePath(options.directory, options.path);
  const handler = (ctx: RequestContext) =>
    serveFile(ctx.request, file, {
      contentType:
        mimeTypeByExtension(extension(options.path))?.type || "text/plain",
      streaming: options.enableResponseStreaming,
      maxAge: options.maxAge,
    });
  // HEAD requests fall back to the GET route.
  app.get(routePath(options.path), handler);
  return app;
}

/**
 * The route pattern that matches exactly the request path of a file: encoded
 * like a request URL, with URLPattern syntax (`:`, `*`, `+`, `(`, ...) escaped.
 */
export function routePath(path: string): string {
  // The URL parser would remove spaces at the end and tabs and newlines
  // anywhere, so these are encoded first, like the other control characters.
  const encoded = `/${path}`.replace(
    /[\x00-\x20%?#\\]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
  const { pathname } = new URL(encoded, "http://localhost");
  return pathname.replace(/[:*+?(){}\\]/g, "\\$&");
}

function filePath(directory: string, path?: string): string {
  return path ? `${directory}/${path}` : directory;
}
