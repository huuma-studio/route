import type { AppContext } from "../app.ts";
import type { ProtocolConnectionInfo } from "../protocol.ts";
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

  #state?: T["State"];

  params?: UrlParams;
  body?: unknown;
  auth?: unknown;
  search?: SearchParams;

  constructor(request: Request, connection: ProtocolConnectionInfo) {
    this.#request = request;
    this.#connection = connection;
  }

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
