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

export type Protocol = {
  handle(
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response>;
  middleware(middleware: Middleware[] | Middleware): Protocol;
  router: Router;
};
