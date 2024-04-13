import { HttpMethod } from "./http-method.ts";
import { Handler, RouteParams } from "./request.ts";
import { Middleware } from "../middleware/middleware.ts";

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
