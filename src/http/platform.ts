import type { ProtocolConnectionInfo, ProtocolPlatform } from "../protocol.ts";

/** The Cloudflare Workers execution context, reduced to what Huuma/Route uses. */
export type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type BunServerLike = {
  requestIP(request: Request): { address: string; port: number } | null;
};

export type PlatformArguments = {
  connection?: ProtocolConnectionInfo;
  platform: ProtocolPlatform;
};

/**
 * Interprets the extra arguments a runtime passes to a `fetch` handler:
 * `(request, env, ctx)` on Cloudflare Workers, `(request, info)` with
 * `info.remoteAddr` on Deno and the Node adapter, and `(request, server)` on Bun.
 */
export function platformArguments(
  request: Request,
  info?: unknown,
  ctx?: unknown,
): PlatformArguments {
  if (isExecutionContext(ctx)) {
    const hostname = request.headers.get("CF-Connecting-IP") ?? undefined;
    return {
      connection: { remoteAddr: { transport: "tcp", hostname } },
      platform: {
        env: isRecord(info) ? info : {},
        waitUntil: (promise) => ctx.waitUntil(promise),
      },
    };
  }
  if (isRecord(info) && isRecord(info.remoteAddr)) {
    return {
      connection: info as ProtocolConnectionInfo,
      platform: {},
    };
  }
  if (isBunServer(info)) {
    const address = info.requestIP(request);
    return {
      connection: {
        remoteAddr: {
          transport: "tcp",
          hostname: address?.address,
          port: address?.port,
        },
      },
      platform: {},
    };
  }
  return { platform: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isExecutionContext(value: unknown): value is ExecutionContextLike {
  return isRecord(value) && typeof value.waitUntil === "function";
}

function isBunServer(value: unknown): value is BunServerLike {
  return isRecord(value) && typeof value.requestIP === "function";
}
