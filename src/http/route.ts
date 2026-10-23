import type { HttpMethod } from "./http-method.ts";
import type { Handler, RouteParams } from "./request.ts";
import { handle, type Middleware } from "../middleware/middleware.ts";
import type { AppContext } from "../app.ts";
import { routeChanged } from "./route-revision.ts";

export class Route<T extends AppContext> {
  #path!: URLPattern;
  get path(): URLPattern {
    return this.#path;
  }
  set path(path: URLPattern) {
    this.#path = path;
    routeChanged();
  }

  #method!: HttpMethod;
  get method(): HttpMethod {
    return this.#method;
  }
  set method(method: HttpMethod) {
    this.#method = method;
    routeChanged();
  }

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

export class RouteGroup<T extends AppContext> {
  prefix: URLPattern;
  chain: Middleware[] = [];
  routes: Route<T>[] = [];

  /** @deprecated Use `use()` or `middleware()` instead. */
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
    // Attach the group once, reading its current chain on each request.
    // Later additions keep their order without duplicating earlier entries
    // or moving an inner group ahead of an outer group's middleware.
    toRoute.chain = [
      (ctx, next) => handle(ctx, this.chain, next),
      ...toRoute.chain,
    ];
  }
}
