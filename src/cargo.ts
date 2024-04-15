import { HttpMethod } from "./http/http-method.ts";
import { HttpProtocol, type HttpProtocolOptions } from "./http/protocol.ts";
import type { Handler } from "./http/request.ts";
import { type Route, RouteGroup } from "./http/route.ts";
import type { Middleware } from "./middleware/middleware.ts";
import type { Protocol, ProtocolConnectionInfo } from "./protocol.ts";

export type CargoOptions = {
  protocol?: Protocol;
  protocolOptions?: HttpProtocolOptions;
};

export class Cargo {
  #options: Required<Pick<CargoOptions, "protocol">>;
  constructor(options?: CargoOptions) {
    this.#options = {
      protocol: options?.protocol ?? new HttpProtocol(options?.protocolOptions),
    };
  }

  handle = (
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response> => {
    return this.#options.protocol.handle(request, connection);
  };

  use(middleware: Middleware | Middleware[]): Cargo {
    return this.middleware(middleware);
  }

  init(): this["handle"] {
    this.#options.protocol.router.list();
    return this.handle;
  }

  chain(middleware: Middleware | Middleware[]): Cargo {
    return this.middleware(middleware);
  }

  middleware(middleware: Middleware | Middleware[]): Cargo {
    this.#options.protocol.middleware(middleware);
    return this;
  }

  head(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.HEAD,
      handler,
    });
  }

  get(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.GET,
      handler,
    });
  }

  post(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.POST,
      handler,
    });
  }

  put(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PUT,
      handler,
    });
  }

  patch(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PATCH,
      handler,
    });
  }

  delete(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.DELETE,
      handler,
    });
  }

  options(path: string, handler: Handler): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.OPTIONS,
      handler,
    });
  }

  group(path: string, routes: Route[]): RouteGroup {
    return new RouteGroup(path, routes);
  }
}
