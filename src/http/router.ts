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
import { routeRevision } from "./route-revision.ts";

type RouteMatch<T extends AppContext> = {
  route: Route<T>;
  params?: UrlParams;
};

// A route with its registration position, as the first match wins.
type Entry<T extends AppContext> = { route: Route<T>; position: number };

type MethodIndex<T extends AppContext> = {
  // The first route of each exact path, such as `/users`.
  exact: Map<string, Entry<T>>;
  // Routes with parameters or wildcards, in registration order.
  patterns: Entry<T>[];
};

type RouteIndex<T extends AppContext> = {
  revision: number;
  methods: Map<HttpMethod, MethodIndex<T>>;
  // For the `Allow` header of a 405.
  exactMethods: Map<string, Entry<T>[]>;
  patterns: Entry<T>[];
};

export class Router<T extends AppContext> {
  #routes: Route<T>[] = [];
  // Exact paths are looked up instead of matched one by one, so apps with
  // many static files don't slow down every request.
  #index?: RouteIndex<T>;

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
          const func = controller[toRoute.handler as ControllerProperty<P, T>];
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
    const index = this.#indexed().methods.get(method);
    if (!index) return undefined;
    const exact = index.exact.get(pathname);
    // A pattern registered before the exact route still comes first.
    for (const { route, position } of index.patterns) {
      if (exact && position > exact.position) break;
      const result = route.path.exec({ pathname });
      if (result) return { route, params: result.pathname.groups };
    }
    return exact && { route: exact.route, params: {} };
  }

  #allowedMethods(pathname: string): string[] {
    const index = this.#indexed();
    const matches = [
      ...(index.exactMethods.get(pathname) ?? []),
      ...index.patterns.filter(({ route }) => route.path.test({ pathname })),
    ].sort((a, b) => a.position - b.position);
    const allow = new Set(matches.map(({ route }) => route.method));
    if (allow.has(HttpMethod.GET)) allow.add(HttpMethod.HEAD);
    return [...allow];
  }

  #indexed(): RouteIndex<T> {
    const revision = routeRevision();
    if (this.#index?.revision === revision) return this.#index;
    const index: RouteIndex<T> = {
      revision,
      methods: new Map(),
      exactMethods: new Map(),
      patterns: [],
    };
    this.#routes.forEach((route, position) => {
      const entry = { route, position };
      let methodIndex = index.methods.get(route.method);
      if (!methodIndex) {
        methodIndex = { exact: new Map(), patterns: [] };
        index.methods.set(route.method, methodIndex);
      }
      const path = exactPath(route.path);
      if (path === undefined) {
        methodIndex.patterns.push(entry);
        index.patterns.push(entry);
      } else if (!methodIndex.exact.has(path)) {
        methodIndex.exact.set(path, entry);
        const methods = index.exactMethods.get(path) ?? [];
        methods.push(entry);
        index.exactMethods.set(path, methods);
      }
    });
    this.#index = index;
    return index;
  }
}

// URLPattern syntax; a backslash escapes the next character.
const PATTERN_SYNTAX = new Set([":", "*", "(", ")", "{", "}", "+", "?"]);

/**
 * The one path a pattern matches, such as `/users` for `/users` or `/a:b`
 * for `/a\:b`, or `undefined` for a pattern with parameters or wildcards.
 */
function exactPath(pattern: URLPattern): string | undefined {
  const source = pattern.pathname;
  let path = "";
  for (let i = 0; i < source.length; i++) {
    let char = source[i];
    if (char === "\\") char = source[++i] ?? "";
    else if (PATTERN_SYNTAX.has(char)) return undefined;
    path += char;
  }
  // Leaves anything this parser misreads to pattern matching.
  return pattern.test({ pathname: path }) ? path : undefined;
}
