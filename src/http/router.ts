import { walkthroughAndHandle } from "../middleware/middleware.ts";
import { log } from "../utils/logger.ts";
import { NotFoundException } from "./exceptions/not-found-exception.ts";
import type { HttpMethod } from "./http-method.ts";
import {
  getUrlParams,
  type Handler,
  method,
  type RequestContext,
} from "./request.ts";
import { Route } from "./route.ts";

export class Router {
  #routes: Route[] = [];

  list() {
    this.#routes.forEach((route) =>
      log("ROUTE", `${route.method} ${route.path.pathname}`)
    );
  }

  add(
    toRoute: { path: string; method: HttpMethod; handler: Handler },
  ): Route {
    const route = new Route({
      path: new URLPattern({ pathname: toRoute.path }),
      method: toRoute.method,
      handler: toRoute.handler,
    });
    this.#routes.push(route);
    return route;
  }

  resolve = (ctx: RequestContext): Promise<Response> => {
    const route = this.#routes.find((route) => {
      return (
        route.path.test(ctx.request.url) && route.method === method(ctx.request)
      );
    });

    if (!route) {
      throw new NotFoundException(
        `The resource under the path "${
          new URL(ctx.request.url).pathname
        }" was not found`,
      );
    }

    ctx.params = getUrlParams(route, ctx.request);

    return walkthroughAndHandle(ctx, route.chain, route.handler);
  };
}
