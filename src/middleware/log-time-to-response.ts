import type { RequestContext } from "../http/request.ts";
import { info as log } from "../utils/logger.ts";
import type { Next } from "./middleware.ts";

export async function logTimeToResponse(
  ctx: RequestContext,
  next: Next,
): Promise<Response> {
  // Start time tracking and handle the request.
  const startTime = Date.now();
  const response = await next();

  // Stop time tracking and log the time. Only the path is logged, because
  // query strings can hold tokens and personal data.
  const stopTime = Date.now();
  const { pathname } = new URL(ctx.request.url);
  log(
    "REQUEST",
    `${ctx.request.method} ${pathname} ${response.status} took ${
      stopTime - startTime
    }ms`,
  );
  return response;
}
