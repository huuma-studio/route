import {
  bodyParser,
  type BodyParserOptions,
} from "../middleware/body-parser/body-parser.ts";
import { handle, type Middleware } from "../middleware/middleware.ts";
import {
  HookType,
  type Protocol,
  type ProtocolConnectionInfo,
} from "../protocol.ts";
import { addSearchParamsToContext } from "../middleware/add-search-params-to-context.ts";
import { addRawBodyToContext } from "../middleware/add-raw-body-to-context.ts";
import { Router } from "./router.ts";
import { handleException } from "./exceptions/handle-exception.ts";
import { RequestContext } from "./request.ts";
import type { AppContext } from "../app.ts";

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
    const hasDeprecatedOption = options?.rawBody !== undefined ||
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
      ? hooksOfType.push(<(...args: unknown[]) => void> listener)
      : this.#hooks.set(hookName, [<(...args: unknown[]) => void> listener]);
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
          console.error(e);
        }
      }
    }
  }

  middleware(middleware: Middleware<T> | Middleware<T>[]): HttpProtocol<T> {
    this.#chain.push(...(Array.isArray(middleware) ? middleware : [middleware]));
    return this;
  }

  async handle(
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response> {
    const ctx = new RequestContext(request, connection);

    try {
      const resp = await handle(ctx, this.#chain, this.#router.resolve);
      this.hook(HookType.REQUEST_SUCCESS, ctx);
      return resp;
    } catch (error: unknown) {
      this.hook(HookType.REQUEST_ERROR, ctx);
      return handleException(error);
    } finally {
      this.hook(HookType.REQUEST_FINALLY, ctx);
      ctx.clear();
    }
  }
}
