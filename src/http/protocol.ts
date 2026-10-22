import {
  bodyParser,
  type BodyParserOptions,
} from "../middleware/body-parser/body-parser.ts";
import { handle, type Middleware } from "../middleware/middleware.ts";
import {
  HookType,
  type Protocol,
  type ProtocolConnectionInfo,
  type ProtocolPlatform,
} from "../protocol.ts";
import { addSearchParamsToContext } from "../middleware/add-search-params-to-context.ts";
import { addRawBodyToContext } from "../middleware/add-raw-body-to-context.ts";
import { Router } from "./router.ts";
import { handleException } from "./exceptions/handle-exception.ts";
import { RequestContext } from "./request.ts";
import type { AppContext } from "../app.ts";
import { error as logError } from "../utils/logger.ts";

export interface HttpProtocolOptions {
  /**
   * @deprecated Body parsing is no longer part of the default protocol
   * middleware. Opt back into the legacy behavior with `useDefaultBodyParser`.
   * Prefer adding `bodyParser()` explicitly via `protocol.middleware(...)` or
   * per-route `route.use(bodyParser(...))`. This option will be removed in a
   * future release.
   */
  rawBody?: boolean;

  /**
   * @deprecated Body parsing is no longer part of the default protocol
   * middleware. Opt back into the legacy behavior with `useDefaultBodyParser`.
   * Prefer adding `bodyParser()` explicitly via `protocol.middleware(...)` or
   * per-route `route.use(bodyParser(...))`. This option will be removed in a
   * future release.
   */
  bodyParserOptions?: BodyParserOptions;

  /**
   * @deprecated Re-enables the legacy default body-parser middleware added by
   * the protocol. Prefer adding `bodyParser()` (or `addRawBodyToContext`)
   * explicitly to your middleware chain or routes. This option will be
   * removed in a future release.
   */
  useDefaultBodyParser?: boolean;
}

export class HttpProtocol<T extends AppContext> implements Protocol<T> {
  #router: Router<T>;
  #hooks = new Map<
    HookType,
    ((...args: unknown[]) => Promise<void> | void)[]
  >();

  get router(): Router<T> {
    return this.#router;
  }
  #chain: Middleware[] = [];

  constructor(options?: HttpProtocolOptions) {
    this.middleware([addSearchParamsToContext]);
    const hasDeprecatedOption =
      options?.rawBody !== undefined ||
      options?.bodyParserOptions !== undefined;
    if (hasDeprecatedOption && options?.useDefaultBodyParser !== true) {
      throw new Error(
        "`rawBody` and `bodyParserOptions` are deprecated and no longer take " +
          "effect on their own. To keep the legacy default body-parser behavior, " +
          "set `useDefaultBodyParser: true`. Prefer adding `bodyParser()` " +
          "explicitly via `protocol.middleware(...)` or " +
          "`route.use(bodyParser(...))` instead.",
      );
    }
    if (options?.useDefaultBodyParser || hasDeprecatedOption) {
      this.middleware(
        options.rawBody
          ? addRawBodyToContext
          : bodyParser(
              options.bodyParserOptions && { ...options.bodyParserOptions },
            ),
      );
    }
    this.#router = new Router();
  }

  on(
    hookName: HookType,
    // deno-lint-ignore no-explicit-any
    listener: (...args: any[]) => Promise<void> | void,
  ): () => void {
    const hooksOfType = this.#hooks.get(hookName);
    Array.isArray(hooksOfType)
      ? hooksOfType.push(<(...args: unknown[]) => void>listener)
      : this.#hooks.set(hookName, [<(...args: unknown[]) => void>listener]);
    return () => {
      const hooksOfType = this.#hooks.get(hookName);
      if (Array.isArray(hooksOfType)) {
        this.#hooks.set(
          hookName,
          hooksOfType?.filter((value) => value !== listener),
        );
      }
    };
  }

  async hook(name: HookType, ctx: unknown) {
    const hooksOfType = this.#hooks.get(name);
    if (Array.isArray(hooksOfType)) {
      for (const hook of hooksOfType) {
        try {
          await hook(ctx);
        } catch (e) {
          logError(
            `HOOK ${name}`,
            e instanceof Error ? (e.stack ?? e.message) : String(e),
          );
        }
      }
    }
  }

  middleware(middleware: Middleware<T> | Middleware<T>[]): HttpProtocol<T> {
    this.#chain.push(
      ...(Array.isArray(middleware) ? middleware : [middleware]),
    );
    return this;
  }

  async handle(
    request: Request,
    connection?: ProtocolConnectionInfo,
    platform?: ProtocolPlatform,
  ): Promise<Response> {
    const ctx = new RequestContext(request, connection, platform);

    let response: Response;
    let outcome: HookType = HookType.REQUEST_ERROR;
    try {
      response = await handle(ctx, this.#chain, this.#router.resolve);
      outcome = HookType.REQUEST_SUCCESS;
    } catch (error: unknown) {
      response = handleException(error);
    } finally {
      // Also when building the error response fails. The response doesn't
      // wait for the hooks' promises; waitUntil keeps them alive on Workers.
      ctx.waitUntil(this.#afterResponse(ctx, outcome));
    }
    return forMethod(request, response);
  }

  async #afterResponse(ctx: RequestContext, outcome: HookType): Promise<void> {
    // Clear the state only once every listener has finished with it.
    await this.hook(outcome, ctx);
    await this.hook(HookType.REQUEST_FINALLY, ctx);
    ctx.clear();
  }
}

// A HEAD response has no body (RFC 9110, 9.3.2), also when it comes from a
// GET route or is an error response. The headers stay.
function forMethod(request: Request, response: Response): Response {
  if (request.method !== "HEAD" || response.body === null) return response;
  void response.body.cancel().catch(() => {});
  return new Response(null, response);
}
