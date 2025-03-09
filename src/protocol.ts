import type { AppContext } from "./app.ts";
import type { Router } from "./http/router.ts";
import type { Middleware } from "./middleware/middleware.ts";

export type ProtocolConnectionInfo = {
  remoteAddr: ProtocolRemoteAddress;
};

export type ProtocolRemoteAddress = {
  transport: string;
  hostname?: string;
  port?: number;
};

export enum HookType {
  APPLICATION_INIT = "application:init",
  REQUEST_SUCCESS = "request:success",
  REQUEST_ERROR = "request:error",
  REQUEST_FINALLY = "request:finally",
}

export type Protocol<T extends AppContext> = {
  handle(
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response>;
  middleware(middleware: Middleware[] | Middleware): Protocol<T>;
  router: Router<T>;
  on: (
    hookType: HookType,
    // deno-lint-ignore no-explicit-any
    listener: (...args: any[]) => Promise<void> | void,
  ) => () => void;
  hook(hooksName: HookType, ctx: unknown): Promise<void> | void;
};
