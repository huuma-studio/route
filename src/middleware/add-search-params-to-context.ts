import { getSearchParams, type RequestContext } from "../http/request.ts";
import type { Next } from "./middleware.ts";

export function addSearchParamsToContext(
  ctx: RequestContext,
  next: Next,
): Promise<Response> {
  ctx.search = getSearchParams(ctx.request);
  return next();
}
