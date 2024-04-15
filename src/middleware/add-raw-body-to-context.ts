import type { RequestContext } from "../http/request.ts";
import type { Next } from "./middleware.ts";

export function addRawBodyToContext(
  ctx: RequestContext,
  next: Next,
): Promise<Response> {
  ctx.body = ctx.request.body;
  return next();
}
