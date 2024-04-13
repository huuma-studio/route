import { RequestContext } from "../http/request.ts";
import { Next } from "./middleware.ts";

export function redirectToWithoutSlash(
  ctx: RequestContext,
  next: Next,
) {
  const url = new URL(ctx.request.url);
  if (url.pathname.at(-1) === "/" && url.pathname !== "/") {
    return Response.redirect(ctx.request.url.replace(/\/$/, ""));
  }
  return next();
}
