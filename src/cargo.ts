import { HttpMethod } from "./http/http-method.ts";
import { HttpProtocol, type HttpProtocolOptions } from "./http/protocol.ts";
import type {
  ControllerConstructor,
  ControllerProperty,
  Handler,
  RequestContext,
} from "./http/request.ts";
import { type Route, RouteGroup } from "./http/route.ts";
import type { Middleware } from "./middleware/middleware.ts";
import {
  HookType,
  type Protocol,
  type ProtocolConnectionInfo,
} from "./protocol.ts";

export type State = Record<string, unknown>;
export type CargoContext = {
  State?: State;
};

export type CargoOptions<T extends CargoContext> = {
  protocol?: Protocol<T>;
  protocolOptions?: HttpProtocolOptions;
};

export class Cargo<T extends CargoContext = any> {
  #options: Required<Pick<CargoOptions<T>, "protocol">>;
  constructor(options?: CargoOptions<T>) {
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

  on(
    hookName: HookType.APPLICATION_INIT,
    listener: (app: Cargo<T>) => Promise<void> | void,
  ): () => void;
  on(
    hookName: HookType.REQUEST_SUCCESS,
    listener: (ctx: RequestContext<T>) => Promise<void> | void,
  ): () => void;
  on(
    hookName: HookType.REQUEST_ERROR,
    listener: (ctx: RequestContext<T>) => Promise<void> | void,
  ): () => void;
  on(
    hookName: HookType.REQUEST_FINALLY,
    listener: (ctx: RequestContext<T>) => Promise<void> | void,
  ): () => void;
  on(
    hookName: HookType,
    listener: (...args: any[]) => Promise<void> | void,
  ): () => void {
    return this.#options.protocol.on(hookName, listener);
  }

  init(): this["handle"] {
    this.#options.protocol.hook(HookType.APPLICATION_INIT, this);
    this.#options.protocol.router.list();
    return this.handle;
  }

  middleware(middleware: Middleware<T> | Middleware<T>[]): Cargo<T> {
    this.#options.protocol.middleware(middleware);
    return this;
  }

  use(middleware: Middleware<T> | Middleware<T>[]): Cargo<T> {
    return this.middleware(middleware);
  }

  head<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  head<P>(path: string, handlerType: Handler<T>): Route<T>;
  head<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.HEAD,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  get<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  get<P>(path: string, handlerType: Handler<T>): Route<T>;
  get<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.GET,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  post<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  post<P>(path: string, handlerType: Handler<T>): Route<T>;
  post<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.POST,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  put<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  put<P>(path: string, handlerType: Handler<T>): Route<T>;
  put<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PUT,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  patch<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  patch<P>(path: string, handlerType: Handler<T>): Route<T>;
  patch<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.PATCH,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  delete<P>(
    path: string,
    handlerType: ControllerConstructor<P>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  delete<P>(path: string, handlerType: Handler<T>): Route<T>;
  delete<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.DELETE,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  options<P>(
    path: string,
    handlerType: ControllerConstructor<T>,
    funcName: ControllerProperty<P, T>,
  ): Route<T>;
  options<P>(path: string, handlerType: Handler<T>): Route<T>;
  options<P>(
    path: string,
    handlerType: Handler<T> | ControllerConstructor<P>,
    funcName?: ControllerProperty<P, T>,
  ): Route<T> {
    return this.#options.protocol.router.add({
      path,
      method: HttpMethod.OPTIONS,
      handler: <ControllerProperty<P, T>> funcName ?? handlerType,
      controller: <ControllerConstructor<P>> handlerType,
    });
  }

  group(path: string, routes: Route<T>[]): RouteGroup<T> {
    return new RouteGroup(path, routes);
  }
}
