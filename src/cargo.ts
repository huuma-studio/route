import { RouteGroup } from "./http/group.ts";
import { HttpMethod } from "./http/http-method.ts";
import { HttpProtocol, HttpProtocolOptions } from "./http/protocol.ts";
import { Handler } from "./http/request.ts";
import { Route } from "./http/route.ts";
import { Middleware } from "./middleware/middleware.ts";
import { Protocol, type ProtocolConnectionInfo } from "./protocol.ts";

type CargoOptions = {
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

  chain(middleware: Middleware | Middleware[]): Cargo {
    return this.middleware(middleware);
  }

  middleware(middleware: Middleware | Middleware[]): Cargo {
    this.#options.protocol.middleware(middleware);
    return this;
  }

  head(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.HEAD,
      handler,
    });
  }

  get(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.GET,
      handler,
    });
  }

  post(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.POST,
      handler,
    });
  }

  put(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.PUT,
      handler,
    });
  }

  patch(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.PATCH,
      handler,
    });
  }

  delete(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.DELETE,
      handler,
    });
  }

  options(path: string, handler: Handler): Route {
    return this.#options.protocol.router().add({
      path,
      method: HttpMethod.OPTIONS,
      handler,
    });
  }

  group(path: string, routes: Route[]): RouteGroup {
    return new RouteGroup(path, routes);
  }
}
