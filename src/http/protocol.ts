import {
  bodyParser,
  type BodyParserOptions,
} from "../middleware/body-parser/body-parser.ts";
import {
  type Middleware,
  walkthroughAndHandle,
} from "../middleware/middleware.ts";
import type { Protocol, ProtocolConnectionInfo } from "../protocol.ts";
import { addSearchParamsToContext } from "../middleware/add-search-params-to-context.ts";
import { addRawBodyToContext } from "../middleware/add-raw-body-to-context.ts";
import { Router } from "./router.ts";
import { handleException } from "./exceptions/handle-exception.ts";

const chain: Middleware[] = [];

export interface HttpProtocolOptions {
  rawBody?: boolean;
  legacyServe?: boolean;
  bodyParserOptions?: BodyParserOptions;
}

export class HttpProtocol implements Protocol {
  #router: Router;

  get router(): Router {
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

  middleware(middleware: Middleware | Middleware[]): HttpProtocol {
    chain.push(...Array.isArray(middleware) ? middleware : [middleware]);
    return this;
  }

  async handle(
    request: Request,
    connection: ProtocolConnectionInfo,
  ): Promise<Response> {
    try {
      return await walkthroughAndHandle(
        {
          request,
          connection,
        },
        chain,
        this.#router.resolve,
      );
    } catch (error: unknown) {
      return handleException(error);
    }
  }
}
