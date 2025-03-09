import type { AppContext } from "../app.ts";
import { handle } from "../middleware/middleware.ts";
import { log } from "../utils/logger.ts";
import { NotFoundException } from "./exceptions/not-found-exception.ts";
import type { HttpMethod } from "./http-method.ts";
import {
  type ControllerConstructor,
  type ControllerProperty,
  getUrlParams,
  type Handler,
  method,
  type RequestContext,
} from "./request.ts";
import { Route } from "./route.ts";

export class Router<T extends AppContext> {
  #routes: Route<T>[] = [];

  list() {
    this.#routes.forEach((route) =>
      log("ROUTE", `${route.method} ${route.path.pathname}`)
    );
  }
  add<P>(
    toRoute: {
      path: string;
      method: HttpMethod;
      handler: Handler<T>;
    },
  ): Route<T>;
  add<P>(
    toRoute: {
      path: string;
      method: HttpMethod;
      controller: ControllerConstructor<P>;
      handler: Handler<T> | ControllerProperty<P, T>;
    },
  ): Route<T>;
  add<P>(
    toRoute: {
      path: string;
      method: HttpMethod;
      controller?: ControllerConstructor<P>;
      handler: Handler<T> | ControllerProperty<P, T>;
    },
  ): Route<T> {
    let handler: Handler<T>;

    if (typeof toRoute.handler === "function") {
      handler = toRoute.handler;
    } else {
      handler = (ctx: RequestContext<T>) => {
        if (toRoute.controller) {
          const controller = new toRoute.controller();
          const func = controller[<ControllerProperty<P, T>> toRoute.handler];
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

    return handle(ctx, route.chain, route.handler);
  };
}
