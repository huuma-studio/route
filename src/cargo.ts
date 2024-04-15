import { HttpMethod } from "./http/http-method.ts";
import { HttpProtocol, type HttpProtocolOptions } from "./http/protocol.ts";
import type {
  ControllerConstructor,
  ControllerProperty,
  Handler,
} from "./http/request.ts";
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

  head<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  head<T>(path: string, handlerType: Handler): Route;
  head<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.HEAD,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  get<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  get<T>(path: string, handlerType: Handler): Route;
  get<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.GET,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  post<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  post<T>(path: string, handlerType: Handler): Route;
  post<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.POST,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  put<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  put<T>(path: string, handlerType: Handler): Route;
  put<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PUT,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  patch<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  patch<T>(path: string, handlerType: Handler): Route;
  patch<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PATCH,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  delete<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  delete<T>(path: string, handlerType: Handler): Route;
  delete<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.DELETE,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  options<T>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<T>,
  ): Route;
  options<T>(path: string, handlerType: Handler): Route;
  options<T>(
    path: string,
    handlerType: Handler | ControllerConstructor<T>,
    funcName?: ControllerProperty<T>,
  ): Route {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.OPTIONS,
      handler: <ControllerProperty<T>> funcName ?? handlerType,
      controller: <ControllerConstructor<T>> handlerType,
    });
  }

  group(path: string, routes: Route[]): RouteGroup {
    return new RouteGroup(path, routes);
  }
}
