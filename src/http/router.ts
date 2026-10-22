import type { AppContext } from "../app.ts";
import { handle } from "../middleware/middleware.ts";
import { debug as log, warn } from "../utils/logger.ts";
import { MethodNotAllowedException } from "./exceptions/method-not-allowed-exception.ts";
import { NotFoundException } from "./exceptions/not-found-exception.ts";
import { HttpMethod } from "./http-method.ts";
import {
  type ControllerConstructor,
  type ControllerProperty,
  type Handler,
  method,
  type RequestContext,
  type UrlParams,
} from "./request.ts";
import { Route } from "./route.ts";

type RouteMatch<T extends AppContext> = {
  route: Route<T>;
  params?: UrlParams;
};

export class Router<T extends AppContext> {
  #routes: Route<T>[] = [];

  list() {
    const seen = new Set<string>();
    this.#routes.forEach((route) => {
      const key = `${route.method} ${route.path.pathname}`;
      log("ROUTE", key);
      // Groups prefix routes after they were added, so duplicates can
      // only be found once the routes are complete.
      if (seen.has(key)) {
        warn("ROUTE", `${key} is registered twice; the first one handles it`);
      }
      seen.add(key);
    });
  }
  add<P>(toRoute: {
    path: string;
    method: HttpMethod;
    handler: Handler<T>;
  }): Route<T>;
  add<P>(toRoute: {
    path: string;
    method: HttpMethod;
    controller: ControllerConstructor<P>;
    handler: Handler<T> | ControllerProperty<P, T>;
  }): Route<T>;
  add<P>(toRoute: {
    path: string;
    method: HttpMethod;
    controller?: ControllerConstructor<P>;
    handler: Handler<T> | ControllerProperty<P, T>;
  }): Route<T> {
    let handler: Handler<T>;

    if (typeof toRoute.handler === "function") {
      handler = toRoute.handler;
    } else {
      handler = (ctx: RequestContext<T>) => {
        if (toRoute.controller) {
          const controller = new toRoute.controller();
          const func = controller[<ControllerProperty<P, T>>toRoute.handler];
          if (typeof func === "function") {
            return func.bind(controller)(ctx);
          }
        }
        throw new Error(
          "The route handler must be a function or a method of a controller",
        );
      };
    }

    const route = new Route({
      path: new URLPattern({ pathname: toRoute.path }),
      method: toRoute.method,
      handler,
    });
    const existingRoute = this.#routes.find((route) => {
      return (
        route.path.pathname === toRoute.path && route.method === toRoute.method
      );
    });
    if (existingRoute) {
      throw new Error(
        `Route for ${toRoute.method} ${toRoute.path} already exists`,
      );
    }
    this.#routes.push(route);
    return route;
  }

  resolve = (ctx: RequestContext): Promise<Response> => {
    const pathname = new URL(ctx.request.url).pathname;
    const requestMethod = method(ctx.request);
    // HEAD falls back to the GET route. The protocol removes the body.
    const match =
      this.#match(pathname, requestMethod) ??
      (requestMethod === HttpMethod.HEAD
        ? this.#match(pathname, HttpMethod.GET)
        : undefined);

    if (!match) {
      const allow = this.#allowedMethods(pathname);
      if (allow.length) {
        throw new MethodNotAllowedException(
          `The method "${requestMethod}" is not allowed for the path "${pathname}"`,
          allow,
        );
      }
      throw new NotFoundException(
        `The resource under the path "${pathname}" was not found`,
      );
    }

    ctx.params = match.params;

    return handle(ctx, match.route.chain, match.route.handler);
  };

  #match(pathname: string, method: HttpMethod): RouteMatch<T> | undefined {
    for (const route of this.#routes) {
      // Compare the method first; it is cheaper than matching the path.
      if (route.method !== method) continue;
      const result = route.path.exec({ pathname });
      if (result) return { route, params: result.pathname.groups };
    }
    return undefined;
  }

  #allowedMethods(pathname: string): string[] {
    const allow = new Set<string>();
    for (const route of this.#routes) {
      if (route.path.test({ pathname })) allow.add(route.method);
    }
    if (allow.has(HttpMethod.GET)) allow.add(HttpMethod.HEAD);
    return [...allow];
  }
}
