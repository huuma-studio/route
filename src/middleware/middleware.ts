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
  let called = -1;

  async function dispatch(i: number): Promise<Response> {
    // Calling next() twice would run the rest of the chain twice.
    if (i <= called) {
      throw new Error("next() was called multiple times");
    }
    called = i;
    const middleware = chain[i];
    if (typeof middleware === "function") {
      return await middleware(ctx, () => dispatch(i + 1));
    }
    return await handler(ctx);
  }

  return dispatch(0);
}
