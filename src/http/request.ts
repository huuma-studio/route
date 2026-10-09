import type { AppContext } from "../app.ts";
import type { ProtocolConnectionInfo, ProtocolPlatform } from "../protocol.ts";
import { error } from "../utils/logger.ts";
import type { HttpMethod } from "./http-method.ts";
import type { Route } from "./route.ts";

export type Handler<T extends AppContext> = (
  cxt: RequestContext<T>,
) => Promise<Response> | Response;

export interface ControllerConstructor<T> {
  new (...args: unknown[]): T;
}

export type ControllerProperty<T, C extends AppContext> = {
  [K in keyof T]: T[K] extends Handler<C> ? K : never;
}[keyof T];

export type SearchParams = Record<string, string | string[] | undefined>;

export type UrlParams = Record<string, string | undefined>;

// deno-lint-ignore no-empty-interface
export interface ContextStateMap {}

interface Get<T extends AppContext> {
  <Key extends keyof ContextStateMap>(key: Key): ContextStateMap[Key];
  <Key extends keyof T["State"]>(key: Key): T["State"][Key];
}

interface Set<T extends AppContext> {
  <Key extends keyof ContextStateMap>(
    key: Key,
    value: ContextStateMap[Key],
  ): void;
  <Key extends keyof T["State"]>(key: Key, value: T["State"][Key]): void;
}

/** The platform bindings type of an app, set through the `Env` key of its `AppContext`. */
export type EnvOf<T extends AppContext> = T extends
  { Env?: infer E extends Record<string, unknown> } ? E
  : Record<string, unknown>;

export class RequestContext<
  // deno-lint-ignore no-explicit-any
  T extends AppContext = any,
> {
  #request: Request;
  get request(): Request {
    return this.#request;
  }

  #connection: ProtocolConnectionInfo;
  get connection(): ProtocolConnectionInfo {
    return this.#connection;
  }

  #env: EnvOf<T>;
  /** Platform bindings, such as the Cloudflare Workers `env`. Empty when the platform has none. */
  get env(): EnvOf<T> {
    return this.#env;
  }

  #waitUntil?: (promise: Promise<unknown>) => void;

  #state?: T["State"];

  params?: UrlParams;
  body?: unknown;
  rawContent?: Uint8Array;
  auth?: unknown;
  search?: SearchParams;

  constructor(
    request: Request,
    connection?: ProtocolConnectionInfo,
    platform?: ProtocolPlatform,
  ) {
    this.#request = request;
    this.#connection = connection ?? { remoteAddr: { transport: "tcp" } };
    this.#env = (platform?.env ?? {}) as EnvOf<T>;
    this.#waitUntil = platform?.waitUntil;
  }

  /**
   * Keeps work running after the response is sent. Forwards to `ctx.waitUntil`
   * on Cloudflare Workers; elsewhere the promise keeps running and a rejection
   * is logged.
   */
  waitUntil = (promise: Promise<unknown>): void => {
    if (this.#waitUntil) {
      this.#waitUntil(promise);
      return;
    }
    promise.catch((reason: unknown) => {
      error(
        "WAIT UNTIL",
        reason instanceof Error
          ? reason.stack ?? reason.message
          : String(reason),
      );
    });
  };

  set: Set<T> = (key: string, value: unknown) => {
    this.#state ??= {};
    this.#state[key] = value;
  };

  get: Get<T> = (key: string) => {
    return this.#state ? this.#state[key] : undefined;
  };

  clear() {
    this.#state = undefined;
  }
}

export interface RouteParams<T extends AppContext> {
  path: URLPattern;
  method: HttpMethod;
  handler: Handler<T>;
}

export function path(request: Request): string {
  return new URL(request.url).pathname;
}

export function method(request: Request): HttpMethod {
  return <HttpMethod> request.method;
}

export function getSearchParams(request: Request): SearchParams {
  const searchParams = new URLSearchParams(new URL(request.url).search);
  const searchEntries = <SearchParams> {};

  for (const key of searchParams.keys()) {
    const searchParam = searchParams.getAll(key);

    searchEntries[key] = searchParam.length <= 1
      ? (searchEntries[key] = searchParam[0])
      : (searchEntries[key] = searchParam);
  }

  return searchEntries;
}

export function getUrlParams<T extends AppContext>(
  route: Route<T>,
  request: Request,
): UrlParams | undefined {
  return route.path.exec(request.url)?.pathname?.groups;
}
