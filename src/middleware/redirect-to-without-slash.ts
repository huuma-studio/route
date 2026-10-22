import type { RequestContext } from "../http/request.ts";
import type { Next } from "./middleware.ts";

export function redirectToWithoutSlash(
  ctx: RequestContext,
  next: Next,
): Promise<Response> | Response {
  const url = new URL(ctx.request.url);
  if (url.pathname.at(-1) === "/" && url.pathname !== "/") {
    // Strip the slash from the path only, so the query and fragment stay.
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return Response.redirect(url.href);
  }
  return next();
}
