import type { AppContext } from "../app.ts";
import type { Handler, RequestContext } from "../http/request.ts";

export type Next = () => Promise<Response>;

// deno-lint-ignore no-explicit-any
export type Middleware<T extends AppContext = any> = (
  cxt: RequestContext<T>,
  next: Next,
) => Promise<Response> | Response;

export function handle<T extends AppContext>(
  ctx: RequestContext,
  chain: Middleware<T>[],
  handler: Handler<T>,
): Promise<Response> {
  let i = 0;

  async function next(): Promise<Response> {
    const middleware = chain[i];
    if (typeof middleware === "function") {
      i++;
      return await middleware(ctx, next);
    }
    return await handler(ctx);
  }

  return next();
}
