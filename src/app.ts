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
import { platformArguments } from "./http/platform.ts";
import { error } from "./utils/logger.ts";
import { setEnv } from "./utils/read-env.ts";
import {
  HookType,
  type Protocol,
  type ProtocolConnectionInfo,
} from "./protocol.ts";

export type State = Record<string, unknown>;
export type AppContext = {
  State?: State;
  /** Platform bindings available as `ctx.env`, such as Cloudflare Workers `env`. */
  Env?: Record<string, unknown>;
};

// String bindings applied to the environment on the first `fetch`, so
// `isProd()` and the logger work on platforms with request-scoped env.
const ENV_BINDINGS = ["HUUMA_ENV", "HUUMA_LOG_LEVEL"];

export type AppOptions<T extends AppContext> = {
  protocol?: Protocol<T>;
  protocolOptions?: HttpProtocolOptions;
};

// deno-lint-ignore no-explicit-any
export class App<T extends AppContext = any> {
  #options: Required<Pick<AppOptions<T>, "protocol">>;
  // Settles once the APPLICATION_INIT listeners have finished.
  #ready?: Promise<void>;
  #envApplied = false;
  constructor(options?: AppOptions<T>) {
    this.#options = {
      protocol: options?.protocol ?? new HttpProtocol(options?.protocolOptions),
    };
  }

  handle = async (
    request: Request,
    connection?: ProtocolConnectionInfo,
  ): Promise<Response> => {
    await this.#ready;
    return this.#options.protocol.handle(request, connection);
  };

  /**
   * Standard fetch handler for `export default app` on Cloudflare Workers, Bun
   * and `deno serve`. Initializes the app on the first request.
   * @param info - Workers `env`, Deno `ServeHandlerInfo` or the Bun `Server`
   * @param ctx - Workers `ExecutionContext`
   */
  fetch = async (
    request: Request,
    info?: unknown,
    ctx?: unknown,
  ): Promise<Response> => {
    const { connection, platform } = platformArguments(request, info, ctx);
    if (!this.#envApplied) {
      this.#envApplied = true;
      if (platform.env) applyEnvBindings(platform.env);
    }
    if (!this.#ready) this.init();
    await this.#ready;
    return this.#options.protocol.handle(request, connection, platform);
  };

  on(
    hookName: HookType.APPLICATION_INIT,
    listener: (app: App<T>) => Promise<void> | void,
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
    // deno-lint-ignore no-explicit-any
    listener: (...args: any[]) => Promise<void> | void,
  ): () => void {
    return this.#options.protocol.on(hookName, listener);
  }

  /**
   * Runs the APPLICATION_INIT listeners. Requests through `handle` and `fetch`
   * wait until they have finished.
   */
  init(): this["handle"] {
    this.#ready = Promise.resolve(
      this.#options.protocol.hook(HookType.APPLICATION_INIT, this),
    ).catch((reason: unknown) => {
      error(
        "APPLICATION INIT",
        reason instanceof Error
          ? reason.stack ?? reason.message
          : String(reason),
      );
    });
    this.#options.protocol.router.list();
    return this.handle;
  }

  middleware(middleware: Middleware<T> | Middleware<T>[]): App<T> {
    this.#options.protocol.middleware(middleware);
    return this;
  }

  use(middleware: Middleware<T> | Middleware<T>[]): App<T> {
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

function applyEnvBindings(env: Record<string, unknown>): void {
  const values: Record<string, string> = {};
  for (const name of ENV_BINDINGS) {
    if (typeof env[name] === "string") values[name] = env[name];
  }
  if (Object.keys(values).length) setEnv(values);
}
