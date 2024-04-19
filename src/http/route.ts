import type { HttpMethod } from "./http-method.ts";
import type { Handler, RouteParams } from "./request.ts";
import type { Middleware } from "../middleware/middleware.ts";
import type { CargoContext } from "../cargo.ts";

export class Route<T extends CargoContext> {
  path: URLPattern;
  method: HttpMethod;
  handler: Handler<T>;
  chain: Middleware[] = [];

  constructor({ path, method, handler }: RouteParams<T>) {
    this.path = path;
    this.method = method;
    this.handler = handler;
  }

  middleware(middleware: Middleware | Middleware[]): Route<T> {
    if (Array.isArray(middleware)) {
      for (const eachMiddleware of middleware) {
        this.chain.push(eachMiddleware);
      }
    } else {
      this.chain.push(middleware);
    }
    return this;
  }

  use(middleware: Middleware | Middleware[]): Route<T> {
    return this.middleware(middleware);
  }
}

export class RouteGroup<T extends CargoContext> {
  prefix: URLPattern;
  chain: Middleware[] = [];
  routes: Route<T>[] = [];

  link = this.middleware;

  constructor(prefix: string, route?: Route<T>[]) {
    this.prefix = new URLPattern({ pathname: prefix });
    if (route) {
      this.route(route);
    }
  }

  middleware(middleware: Middleware<T> | Middleware<T>[]): RouteGroup<T> {
    if (Array.isArray(middleware)) {
      for (const eachMiddleware of middleware) {
        this.chain.push(eachMiddleware);
      }
    } else {
      this.chain.push(middleware);
    }
    this.routes.forEach((toRoute) => {
      this.#prependMiddleware(toRoute);
    });
    return this;
  }

  use(middleware: Middleware<T> | Middleware<T>[]): RouteGroup<T> {
    return this.middleware(middleware);
  }

  route(toRoute: Route<T> | Route<T>[]): RouteGroup<T> {
    if (Array.isArray(toRoute)) {
      for (const route of toRoute) {
        this.routes.push(this.#prepare(route));
      }
    } else {
      this.routes.push(this.#prepare(toRoute));
    }
    return this;
  }

  #prepare(toRoute: Route<T>): Route<T> {
    this.#prefixRoute(toRoute);
    this.#prependMiddleware(toRoute);
    return toRoute;
  }

  #prefixRoute(toRoute: Route<T>): void {
    toRoute.path = new URLPattern({
      pathname: `${this.prefix.pathname}${toRoute.path.pathname}`,
    });
  }

  #prependMiddleware(toRoute: Route<T>): void {
    toRoute.chain = [...this.chain, ...toRoute.chain];
  }
}
