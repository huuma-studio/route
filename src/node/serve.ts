import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Http2ServerRequest, Http2ServerResponse } from "node:http2";
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
  /**
   * Stops the server when aborted. If it aborts before the server is
   * listening, `serve` rejects with the abort reason and no server stays open.
   */
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

/**
 * A request from `node:http`, or from `node:http2`'s compatibility API (what
 * a server created with `allowHTTP1`, such as Vite's with `server.https`,
 * passes for HTTP/2 requests).
 */
export type NodeRequest = IncomingMessage | Http2ServerRequest;

/** The response that belongs to a {@link NodeRequest}. */
export type NodeResponse = ServerResponse | Http2ServerResponse;

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

// A host that can't change the URL's path, such as `example.com:8000`.
const VALID_HOST = /^[^\s/?#@\\]+$/;

// Absolute-form request targets, as proxies send them (`http://host/path`).
const ABSOLUTE_FORM = /^https?:\/\//i;

// Connection-specific headers, which HTTP/2 doesn't allow (RFC 9113, 8.2.2).
const HTTP1_ONLY_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Serves a fetch handler with `node:http`, like `Deno.serve` does on Deno.
 * Resolves once the server is listening.
 */
export function serve(
  handler: FetchHandler,
  options?: ServeOptions,
): Promise<NodeServer> {
  const signal = options?.signal;
  if (signal?.aborted) return Promise.reject(signal.reason);

  const server = createServer((req, res) => {
    void respond(handler, req, res);
  });

  const finished = new Promise<void>((resolve) => {
    server.once("close", () => resolve());
  });
  // Tracked here because `server.listening` turns true before the listen
  // callback on Bun; closing then would skip the callback.
  let started = false;
  const shutdown = (): Promise<void> => {
    if (started) {
      started = false;
      server.close();
      server.closeIdleConnections();
    }
    return finished;
  };
  signal?.addEventListener("abort", () => void shutdown(), { once: true });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options?.port ?? 8000, options?.hostname ?? "0.0.0.0", () => {
      server.off("error", reject);
      started = true;
      // Aborted while starting: the abort listener found nothing to close yet.
      if (signal?.aborted) {
        void shutdown();
        reject(signal.reason);
        return;
      }
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

  let request: Request;
  try {
    request = toRequest(req, controller.signal);
  } catch {
    // A request target or method that a web Request can't represent.
    res.writeHead(400);
    res.end();
    return;
  }

  try {
    const response = await handler.fetch(request, {
      remoteAddr: {
        transport: "tcp",
        hostname: req.socket.remoteAddress,
        port: req.socket.remotePort,
      },
    });
    await writeResponse(response, res);
  } catch (e) {
    // A failure fails this request only, never the server.
    error("NODE", e instanceof Error ? (e.stack ?? e.message) : String(e));
    if (res.headersSent) {
      // The body failed while streaming: the client gets a truncated
      // response.
      res.destroy();
    } else {
      res.writeHead(500);
      res.end();
    }
  }
}

/**
 * Converts a Node request into a web `Request` with a streamed body, for
 * serving a fetch handler from your own Node server or middleware.
 *
 * The URL's host is the `Host` header, or HTTP/2's `:authority`, as long as
 * it can't change the path; otherwise it is `localhost`. The scheme is
 * `https` for requests over TLS. A path that starts with `//` stays a path,
 * the target `*` (`OPTIONS *`) becomes the path `/*`, and an absolute-form
 * target (`http://host/path`) is used as it is.
 *
 * `signal` becomes the request's signal; abort it when the client goes away.
 *
 * @throws {TypeError} For a request target that is neither a path, an
 * absolute `http:`/`https:` URL nor `*`, and, on Node.js, for a method a web
 * `Request` doesn't allow (`CONNECT`, `TRACE`). Answer those with
 * `400 Bad Request`.
 */
export function toRequest(req: NodeRequest, signal: AbortSignal): Request {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    // HTTP/2 pseudo-headers (`:path`) aren't valid header names.
    if (!name.startsWith(":")) headers.append(name, req.rawHeaders[i + 1]);
  }

  // HTTP/2 sends the host as the `:authority` pseudo-header instead of a
  // Host header.
  const host =
    [req.headers.host, req.headers[":authority"]].find(
      (value): value is string =>
        typeof value === "string" && VALID_HOST.test(value),
    ) ?? "localhost";
  // The scheme matters for redirects an app builds from `request.url`.
  const scheme = (req.socket as { encrypted?: boolean } | undefined)?.encrypted
    ? "https"
    : "http";
  const method = req.method ?? "GET";
  const hasBody = !BODYLESS_METHODS.has(method);

  // Concatenate instead of resolving against a base URL, so a target such as
  // `//foo/bar` stays a path instead of becoming the host `foo`.
  const target = req.url ?? "/";
  let url: string;
  if (target === "*") {
    url = `${scheme}://${host}/*`;
  } else if (target.startsWith("/")) {
    url = `${scheme}://${host}${target}`;
  } else if (ABSOLUTE_FORM.test(target)) {
    url = target;
  } else {
    throw new TypeError(`Invalid request target: ${JSON.stringify(target)}`);
  }

  return new Request(url, {
    method,
    headers,
    signal,
    body: hasBody
      ? (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>)
      : null,
    // Required by Node's fetch for streaming request bodies.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

/**
 * Writes a web `Response` to a Node response, streaming its body. Each
 * cookie gets its own `Set-Cookie` header.
 *
 * Resolves once the body is written, or when the client goes away while it
 * streams. Rejects with the body's error if the body fails while streaming;
 * the headers were sent by then, so destroy `res` to end the truncated
 * response.
 *
 * @throws {TypeError} For a network error response (`Response.error()`),
 * before anything is written, so you can still send an error response.
 */
export async function writeResponse(
  response: Response,
  res: NodeResponse,
): Promise<void> {
  if (response.type === "error") {
    throw new TypeError("The fetch handler returned a network error response");
  }
  const http2 = isHttp2(res);
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name === "set-cookie" || (http2 && HTTP1_ONLY_HEADERS.has(name))) {
      return;
    }
    headers[name] = value;
  });
  // Headers would join the cookies with ", ".
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;

  // HTTP/2 has no status message, and an empty one on HTTP/1 would replace
  // the standard reason phrase (`200 OK`) with nothing.
  if (http2) {
    res.writeHead(response.status, headers);
  } else if (response.statusText) {
    res.writeHead(response.status, response.statusText, headers);
  } else {
    res.writeHead(response.status, headers);
  }

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
  } catch (e) {
    // The client went away. The pipeline already cancelled the body.
    if ((e as { code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE") return;
    throw e;
  }
}

function isHttp2(res: NodeResponse): res is Http2ServerResponse {
  return "stream" in res;
}
