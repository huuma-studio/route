import { HttpException } from "../http/exceptions/http-exception.ts";
import { InternalServerException } from "../http/exceptions/internal-server-exception.ts";
import type { HttpMethod } from "../http/http-method.ts";
import type { RequestContext } from "../http/request.ts";
import type { Middleware, Next } from "./middleware.ts";

export interface CorsOptions {
  /** Origins allowed to read responses, such as `https://example.com`. `*` allows any origin. */
  allowedCorsDomains?: string[];
  /** Request headers allowed in preflights. Default: the requested headers. */
  allowedCorsHeaders?: string[];
  /** Methods allowed in preflights. Default: the requested method. */
  allowedCorsMethods?: HttpMethod[];
  /** Response headers the browser may expose to scripts. */
  exposedCorsHeaders?: string[];
  /** Allow cookies and HTTP authentication. Default: false. */
  allowCredentials?: boolean;
  /** Seconds a browser may cache a preflight response. */
  maxAge?: number;
}

/**
 * Answers CORS preflight requests and adds CORS headers to responses,
 * including error responses. Add it as app middleware, because preflight
 * `OPTIONS` requests don't match routes.
 */
export function Cors({
  allowedCorsDomains,
  allowedCorsHeaders,
  allowedCorsMethods,
  exposedCorsHeaders,
  allowCredentials,
  maxAge,
}: CorsOptions): Middleware {
  const isAllowed = (origin: string) =>
    !!allowedCorsDomains?.some((domain) => domain === "*" || domain === origin);

  const corsHeaders = (origin: string | null): Headers => {
    // Responses differ by origin, so caches must not share them.
    const headers = new Headers({ Vary: "Origin" });
    if (!origin || !isAllowed(origin)) return headers;
    headers.set("Access-Control-Allow-Origin", origin);
    if (allowCredentials) {
      headers.set("Access-Control-Allow-Credentials", "true");
    }
    if (allowedCorsHeaders) {
      headers.set(
        "Access-Control-Allow-Headers",
        allowedCorsHeaders.join(", "),
      );
    }
    if (allowedCorsMethods) {
      headers.set(
        "Access-Control-Allow-Methods",
        allowedCorsMethods.join(", "),
      );
    }
    if (exposedCorsHeaders) {
      headers.set(
        "Access-Control-Expose-Headers",
        exposedCorsHeaders.join(", "),
      );
    }
    return headers;
  };

  return async (ctx: RequestContext, next: Next) => {
    const origin = ctx.request.headers.get("origin");
    const requestedMethod = ctx.request.headers.get(
      "access-control-request-method",
    );

    if (
      ctx.request.method === "OPTIONS" &&
      origin &&
      requestedMethod &&
      isAllowed(origin)
    ) {
      return preflight(
        corsHeaders(origin),
        requestedMethod,
        ctx.request.headers.get("access-control-request-headers"),
        maxAge,
      );
    }

    const headers = corsHeaders(origin);
    let response: Response;
    try {
      response = await next();
    } catch (e) {
      // Let the browser read error responses too. The headers go on a copy,
      // because the thrown exception can be shared between requests.
      const exception =
        e instanceof HttpException
          ? copyException(e)
          : Object.assign(new InternalServerException(), { cause: e });
      appendHeaders(exception.headers, headers);
      throw exception;
    }
    return withHeaders(response, headers);
  };
}

function preflight(
  headers: Headers,
  requestedMethod: string,
  requestedHeaders: string | null,
  maxAge?: number,
): Response {
  headers.append("Vary", "Access-Control-Request-Method");
  headers.append("Vary", "Access-Control-Request-Headers");
  if (!headers.has("Access-Control-Allow-Methods")) {
    headers.set("Access-Control-Allow-Methods", requestedMethod);
  }
  if (!headers.has("Access-Control-Allow-Headers") && requestedHeaders) {
    headers.set("Access-Control-Allow-Headers", requestedHeaders);
  }
  if (maxAge !== undefined) {
    headers.set("Access-Control-Max-Age", String(maxAge));
  }
  return new Response(null, { status: 204, headers });
}

// A copy with its own headers that keeps the class, message, stack and cause.
function copyException(exception: HttpException): HttpException {
  const copy = Object.create(
    Object.getPrototypeOf(exception) as object,
    Object.getOwnPropertyDescriptors(exception),
  ) as HttpException;
  // V8's `stack` accessor only works on the original error.
  Object.defineProperty(copy, "stack", {
    value: exception.stack,
    writable: true,
    configurable: true,
  });
  copy.headers = new Headers(exception.headers);
  return copy;
}

function appendHeaders(target: Headers, headers: Headers): void {
  headers.forEach((value, name) => {
    if (name === "vary") target.append(name, value);
    else target.set(name, value);
  });
}

function withHeaders(response: Response, headers: Headers): Response {
  try {
    appendHeaders(response.headers, headers);
    return response;
  } catch {
    // Immutable headers, as on `Response.redirect()` or a `fetch()` response.
    const copy = new Response(response.body, response);
    appendHeaders(copy.headers, headers);
    return copy;
  }
}
