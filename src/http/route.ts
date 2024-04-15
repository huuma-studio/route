import type { HttpMethod } from "./http-method.ts";
import type { Handler, RouteParams } from "./request.ts";
import type { Middleware } from "../middleware/middleware.ts";

export class Route {
  path: URLPattern;
  method: HttpMethod;
  handler: Handler;
  chain: Middleware[] = [];

  constructor({ path, method, handler }: RouteParams) {
    this.path = path;
    this.method = method;
    this.handler = handler;
  }

  middleware(middleware: Middleware | Middleware[]): Route {
    if (Array.isArray(middleware)) {
      for (const eachMiddleware of middleware) {
        this.chain.push(eachMiddleware);
      }
    } else {
      this.chain.push(middleware);
    }
    return this;
  }
}

export class RouteGroup {
  prefix: URLPattern;
  chain: Middleware[] = [];
  routes: Route[] = [];

  link = this.middleware;

  constructor(prefix: string, route?: Route[]) {
    this.prefix = new URLPattern({ pathname: prefix });
    if (route) {
      this.route(route);
    }
  }

  middleware(middleware: Middleware | Middleware[]): RouteGroup {
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

  route(toRoute: Route | Route[]): RouteGroup {
    if (Array.isArray(toRoute)) {
      for (const route of toRoute) {
        this.routes.push(this.#prepare(route));
      }
    } else {
      this.routes.push(this.#prepare(toRoute));
    }
    return this;
  }

  #prepare(toRoute: Route): Route {
    this.#prefixRoute(toRoute);
    this.#prependMiddleware(toRoute);
    return toRoute;
  }

  #prefixRoute(toRoute: Route): void {
    toRoute.path = new URLPattern({
      pathname: `${this.prefix.pathname}${toRoute.path.pathname}`,
    });
  }

  #prependMiddleware(toRoute: Route): void {
    toRoute.chain = [...this.chain, ...toRoute.chain];
  }
}
