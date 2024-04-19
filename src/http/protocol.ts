import {
  bodyParser,
  type BodyParserOptions,
} from "../middleware/body-parser/body-parser.ts";
import {
  type Middleware,
  walkthroughAndHandle,
} from "../middleware/middleware.ts";
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
import type { CargoContext } from "../cargo.ts";

const chain: Middleware[] = [];

export interface HttpProtocolOptions {
  rawBody?: boolean;
  legacyServe?: boolean;
  bodyParserOptions?: BodyParserOptions;
}

export class HttpProtocol<T extends CargoContext> implements Protocol<T> {
  #router: Router<T>;
  #hooks = new Map<
    HookType,
    ((...args: unknown[]) => Promise<void> | void)[]
  >();

  get router(): Router<T> {
    return this.#router;
  }

  constructor(options?: HttpProtocolOptions) {
    this.middleware([
      addSearchParamsToContext,
      options?.rawBody ? addRawBodyToContext : bodyParser(
        options?.bodyParserOptions && { ...options.bodyParserOptions },
      ),
    ]);
    this.#router = new Router();
  }

  on(
    hookName: HookType,
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
    chain.push(...Array.isArray(middleware) ? middleware : [middleware]);
    return this;
  }

  async handle(
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response> {
    const ctx = new RequestContext(request, connection);

    try {
      const resp = await walkthroughAndHandle(
        ctx,
        chain,
        this.#router.resolve,
      );
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
