import { type RequestContext } from "../http/request.ts";
import { log } from "../utils/logger.ts";
import { Next } from "./middleware.ts";

export async function logTimeToResponse(
  ctx: RequestContext,
  next: Next,
) {
  // Start time tracking and handle the request.
  const startTime = Date.now();
  const response = await next();

  // Stop time tracking and log the time.
  const stopTime = Date.now();
  log(
    "REQUEST",
    `Request to route ${ctx.request.url} took ${stopTime - startTime}ms`,
  );
  return response;
}
