import type { RequestContext } from "../http/request.ts";
import type { Next } from "./middleware.ts";

export function redirectToWithoutSlash(
  ctx: RequestContext,
  next: Next,
): Promise<Response> | Response {
  const url = new URL(ctx.request.url);
  if (url.pathname.at(-1) === "/" && url.pathname !== "/") {
    return Response.redirect(ctx.request.url.replace(/\/$/, ""));
  }
  return next();
}
