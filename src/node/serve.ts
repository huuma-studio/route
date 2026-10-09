import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ProtocolConnectionInfo } from "../protocol.ts";
import { error, info } from "../utils/logger.ts";

/** Anything with a standard fetch handler, such as an `App`. */
export type FetchHandler = {
  fetch(
    request: Request,
    info: ProtocolConnectionInfo,
  ): Response | Promise<Response>;
};

export type ServeOptions = {
  /** Defaults to `8000`. Use `0` for a random free port. */
  port?: number;
  /** Defaults to `"0.0.0.0"`. */
  hostname?: string;
  /** Stops the server when aborted. */
  signal?: AbortSignal;
};

export type NodeServer = {
  hostname: string;
  port: number;
  /** Resolves once the server is closed. */
  finished: Promise<void>;
  /** Stops accepting connections and resolves once the server is closed. */
  shutdown(): Promise<void>;
};

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

/**
 * Serves a fetch handler with `node:http`, like `Deno.serve` does on Deno.
 * Resolves once the server is listening.
 */
export function serve(
  handler: FetchHandler,
  options?: ServeOptions,
): Promise<NodeServer> {
  const server = createServer((req, res) => {
    void respond(handler, req, res);
  });

  const finished = new Promise<void>((resolve) => {
    server.once("close", () => resolve());
  });
  const shutdown = (): Promise<void> => {
    if (server.listening) {
      server.close();
      server.closeIdleConnections();
    }
    return finished;
  };
  options?.signal?.addEventListener("abort", () => void shutdown(), {
    once: true,
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 8000, options?.hostname ?? "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address() as AddressInfo;
      info("NODE", `Listening on http://${address.address}:${address.port}/`);
      resolve({
        hostname: address.address,
        port: address.port,
        finished,
        shutdown,
      });
    });
  });
}

async function respond(
  handler: FetchHandler,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  let response: Response;
  try {
    response = await handler.fetch(toRequest(req, controller.signal), {
      remoteAddr: {
        transport: "tcp",
        hostname: req.socket.remoteAddress,
        port: req.socket.remotePort,
      },
    });
  } catch (e) {
    error("NODE", e instanceof Error ? e.stack ?? e.message : String(e));
    if (!res.headersSent) res.writeHead(500);
    res.end();
    return;
  }

  await writeResponse(response, res);
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    if (!name.startsWith(":")) headers.append(name, req.rawHeaders[i + 1]);
  }

  const host = req.headers.host ?? "localhost";
  const method = req.method ?? "GET";
  const hasBody = !BODYLESS_METHODS.has(method);

  return new Request(new URL(req.url ?? "/", `http://${host}`), {
    method,
    headers,
    signal,
    body: hasBody
      ? Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>
      : null,
    // Required by Node's fetch for streaming request bodies.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

async function writeResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, response.statusText, headers);

  if (!response.body) {
    res.end();
    return;
  }
  try {
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>,
      ),
      res,
    );
  } catch {
    // The client disconnected or the body errored; the pipeline already
    // destroyed both streams, which cancels the response body.
  }
}
