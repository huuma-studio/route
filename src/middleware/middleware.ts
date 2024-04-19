import type { CargoContext } from "../cargo.ts";
import type { Handler, RequestContext } from "../http/request.ts";

export type Next = () => Promise<Response>;

export type Middleware<T extends CargoContext = any> = (
  cxt: RequestContext<T>,
  next: Next,
) => Promise<Response> | Response;

export function walkthroughAndHandle<T extends CargoContext>(
  ctx: RequestContext,
  chain: Middleware<T>[],
  handler: Handler<T>,
): Promise<Response> {
  let i = 0;

  function next(): Promise<Response> {
    const middleware = chain[i];
    if (typeof middleware === "function") {
      i++;
      const result = middleware(ctx, next);
      return result instanceof Promise ? result : Promise.resolve(result);
    }
    if (handler instanceof Promise) {
      return handler(ctx) as Promise<Response>;
    }
    return Promise.resolve(handler(ctx));
  }

  return next();
}
