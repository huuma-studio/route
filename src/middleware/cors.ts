import type { HttpMethod } from "../http/http-method.ts";
import type { RequestContext } from "../http/request.ts";
import type { Middleware, Next } from "./middleware.ts";

interface CorsOptions {
  allowedCorsDomains?: string[];
  allowedCorsHeaders?: string[];
  allowedCorsMethods?: HttpMethod[];
}

export function Cors<T>(
  { allowedCorsDomains, allowedCorsHeaders, allowedCorsMethods }: CorsOptions,
): Middleware {
  return async (ctx: RequestContext, next: Next) => {
    const origin = ctx.request.headers.get("origin");
    const resp = await next();
    if (origin && allowedCorsDomains?.includes(origin)) {
      resp.headers.set(
        "Access-Control-Allow-Origin",
        origin,
      );
      if (allowedCorsHeaders) {
        resp.headers.set(
          "Access-Control-Allow-Headers",
          allowedCorsHeaders.join(", "),
        );
      }
      if (allowedCorsMethods) {
        resp.headers.set(
          "Access-Control-Allow-Methods",
          allowedCorsMethods.join(", "),
        );
      }
    }
    return resp;
  };
}
