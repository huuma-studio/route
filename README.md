# Huuma/Route

A flexible, modern web framework for building web applications with TypeScript. It runs on Deno, Node.js, Bun and Cloudflare Workers.

## Features

- 🚀 Lightweight and flexible HTTP routing
- 🧩 Middleware-based architecture
- 🔄 Request context management
- 🛡️ Built-in error handling
- 📦 TypeScript support out of the box
- 🧪 Easy testing

## Installation

Huuma/Route is published on [JSR](https://jsr.io/@huuma/route).

```bash
deno add jsr:@huuma/route       # Deno
npx jsr add @huuma/route        # Node.js (npm); pnpm and Yarn support jsr: natively
bunx jsr add @huuma/route       # Bun
```

Node.js needs version 24 or later (for the global `URLPattern`).

## Basic Usage

```typescript
import { App } from "jsr:@huuma/route";

const app = new App();

// Define a simple route
app.get("/", (ctx) => {
  return new Response("Hello World!");
});

// Start the server
Deno.serve(app.init());
```

## Runtimes

`App` has a standard `fetch(request, ...)` handler, so the same app runs on every runtime. It initializes the app on the first request.

```typescript
// Cloudflare Workers, Bun and `deno serve`
export default app;
```

On Node.js, serve it with the `node:http` adapter:

```typescript
import { serve } from "@huuma/route/node";

const server = await serve(app, { port: 8000 }); // defaults: port 8000, hostname 0.0.0.0
await server.shutdown(); // or pass an AbortSignal as `signal`
```

`Deno.serve(app.init())` and `app.handle(request, connection)` keep working.

## Routing

Huuma/Route comes with a flexible routing system that supports all standard HTTP methods:

```typescript
// GET request
app.get("/users", (ctx) => {
  return new Response("Get all users");
});

// POST request
app.post("/users", (ctx) => {
  return new Response("Create user");
});

// PUT request
app.put("/users/:id", (ctx) => {
  return new Response(`Update user ${ctx.params.id}`);
});

// DELETE request
app.delete("/users/:id", (ctx) => {
  return new Response(`Delete user ${ctx.params.id}`);
});

// PATCH request
app.patch("/users/:id", (ctx) => {
  return new Response(`Partially update user ${ctx.params.id}`);
});

// OPTIONS request
app.options("/users", (ctx) => {
  return new Response("Options for users");
});

// HEAD request
app.head("/users", (ctx) => {
  return new Response("Head for users");
});
```

## Route Groups

You can group routes with common prefixes and middleware:

```typescript
// Create a group of routes with a common prefix
const apiRoutes = app.group("/api", [
  app.get("/users", getUsersHandler),
  app.post("/users", createUserHandler),
  app.get("/products", getProductsHandler),
]);

// Add middleware to all routes in the group
apiRoutes.middleware(authMiddleware);
```

## Middleware

Middleware are functions that process requests before they reach your route handlers:

```typescript
// Define middleware
const loggerMiddleware = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  const ms = Date.now() - start;
  console.log(`${ctx.request.method} ${ctx.request.url} - ${ms}ms`);
  return response;
};

// Apply middleware to all routes
app.middleware(loggerMiddleware);

// Or apply to specific routes
app
  .get("/protected", (ctx) => {
    return new Response("Protected resource");
  })
  .middleware(authMiddleware);
```

Built-in middlewares:

- `bodyParser` - Parse request bodies with JSON
- `addSearchParamsToContext` - Parse query parameters
- `addRawBodyToContext` - Add raw body to context
- `logTimeToResponse` - Log request time
- `redirectToWithoutSlash` - Redirect URLs with trailing slashes
- `Cors` - CORS support

```typescript
import { bodyParser } from "jsr:@huuma/route/middleware/body-parser";
import { logTimeToResponse } from "jsr:@huuma/route/middleware/log-time-to-response";

app.middleware([bodyParser(), logTimeToResponse]);
```

## Request Context

The request context provides access to the request, parameters, body, and more:

```typescript
app.get("/users/:id", (ctx) => {
  // Access route parameters
  const userId = ctx.params.id;

  // Access query parameters
  const page = ctx.search.page;

  // Access request body (requires bodyParser middleware)
  const data = ctx.body;

  // Access request headers
  const authHeader = ctx.request.headers.get("Authorization");

  // Store data in request context
  ctx.set("user", { id: userId, name: "John" });

  // Retrieve data from request context
  const user = ctx.get("user");

  return new Response(`User: ${JSON.stringify(user)}`);
});
```

`ctx.env` holds the platform bindings, such as the Cloudflare Workers `env` (`{}` on other runtimes). Type it through the `Env` key of the app context. `ctx.waitUntil(promise)` keeps work running after the response: it forwards to `ctx.waitUntil` on Workers, and elsewhere lets the promise run and logs a rejection.

```typescript
type Env = { DB: D1Database };
const app = new App<{ Env: Env }>();

app.post("/events", (ctx) => {
  ctx.waitUntil(ctx.env.DB.prepare("INSERT INTO events DEFAULT VALUES").run());
  return new Response(null, { status: 202 });
});
```

`ctx.connection.remoteAddr` holds the client address when the runtime provides it (Deno, Bun, the Node adapter, and `CF-Connecting-IP` on Workers).

## Error Handling

Huuma/Route includes built-in exception handling:

```typescript
import { NotFoundException } from "jsr:@huuma/route/http/exception/not-found-exception";
import { BadRequestException } from "jsr:@huuma/route/http/exception/bad-request-exception";

app.get("/users/:id", (ctx) => {
  const userId = ctx.params.id;

  if (!userId) {
    throw new BadRequestException("User ID is required");
  }

  const user = findUser(userId);

  if (!user) {
    throw new NotFoundException(`User with ID ${userId} not found`);
  }

  return new Response(JSON.stringify(user));
});
```

Built-in exceptions:

- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `NotFoundException` (404)
- `EntityTooLargeException` (413)
- `UnsupportedMediaTypeException` (415)
- `InternalServerException` (500)

## Static Files

Serve static files easily on Deno, Node.js and Bun (these tasks read from the filesystem):

```typescript
import { loadAssets } from "jsr:@huuma/route/http/tasks/assets";
import { Favicon } from "jsr:@huuma/route/http/tasks/favicon";

// Serve all files from the 'public' directory
await loadAssets(app, { directory: "public" });

// Serve a favicon
Favicon("public/favicon.ico", app);
```

## Controllers

For more structured applications, you can use controllers:

```typescript
class UserController {
  getAll(ctx) {
    return new Response("Get all users");
  }

  getOne(ctx) {
    return new Response(`Get user ${ctx.params.id}`);
  }

  create(ctx) {
    return new Response("Create user");
  }
}

// Register routes using controller methods
app.get("/users", UserController, "getAll");
app.get("/users/:id", UserController, "getOne");
app.post("/users", UserController, "create");
```

## Hooks

The framework provides hooks to execute code at different points in the request lifecycle:

```typescript
import { HookType } from "jsr:@huuma/route/protocol";

// Application initialization
app.on(HookType.APPLICATION_INIT, (app) => {
  console.log("Application initialized");
});

// After successful request
app.on(HookType.REQUEST_SUCCESS, (ctx) => {
  console.log("Request succeeded");
});

// After request error
app.on(HookType.REQUEST_ERROR, (ctx) => {
  console.error("Request failed");
});

// After request (always runs)
app.on(HookType.REQUEST_FINALLY, (ctx) => {
  console.log("Request finished");
});
```

## Validation

For request validation, Huuma/Route can be integrated with [@huuma/validate](https://jsr.io/@huuma/validate):

```typescript
import { validateBody } from "jsr:@huuma/validate/middleware";
import { StringSchema } from "jsr:@huuma/validate/string";
import { ObjectSchema } from "jsr:@huuma/validate/object";

const userSchema = new ObjectSchema({
  name: new StringSchema().notEmpty(),
  email: new StringSchema().notEmpty(),
});

app
  .post("/users", (ctx) => {
    // At this point ctx.body is validated
    return new Response(`Created user: ${ctx.body.name}`);
  })
  .middleware(validateBody(userSchema));
```

## Logging

Huuma/Route logs framework events through a built-in logger with severity levels. By default the logger is verbose (`DEBUG`) so you see everything during development. When environment access is granted, the logger uses `isProd()` to read `HUUMA_ENV` and switches to `INFO` when `HUUMA_ENV=PROD`. Without environment access, production mode cannot affect the log level and the logger retains the default `DEBUG` level. Set the `HUUMA_LOG_LEVEL` environment variable to control the threshold explicitly — only messages at that level or higher are emitted. The level is resolved when the logger is first used and again after `setEnv` changes the environment.

Available levels, from most to least verbose: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`.

```bash
# Only show warnings and errors. Allow explicit log-level configuration and
# production detection via isProd().
HUUMA_LOG_LEVEL=WARN deno run --allow-env=HUUMA_LOG_LEVEL,HUUMA_ENV main.ts
```

You can also use the logger directly and override the level at runtime:

```typescript
import {
  LogLevel,
  setLogLevel,
  info,
  warn,
} from "jsr:@huuma/route/utils/logger";

setLogLevel(LogLevel.DEBUG);

info("APP", "Server started on port 8000");
warn("HTTP", "Cache headers disabled in development");
```

## Environment Detection

Detect the current environment:

```typescript
import { isProd, isEnvironment } from "jsr:@huuma/route/utils/environment";

if (isProd()) {
  // Production-specific code
}

if (isEnvironment("STAGING")) {
  // Staging-specific code
}
```

Both helpers read `HUUMA_ENV` from `process.env`. On Deno they require `--allow-env=HUUMA_ENV`; if environment access is not granted, they return `false` instead of throwing a permission error.

On platforms without a process environment, set values explicitly. They take precedence over `process.env`:

```typescript
import { setEnv, setEnvironment } from "jsr:@huuma/route/utils/environment";

setEnvironment("PROD"); // same as setEnv({ HUUMA_ENV: "PROD" })
setEnv({ HUUMA_LOG_LEVEL: "WARN" });
```

## Deploying to Cloudflare Workers

Export the app as the Worker's default export. Set `HUUMA_ENV` and `HUUMA_LOG_LEVEL` as `vars`; the app applies them on the first request, so `isProd()` and the logger work without extra code.

```jsonc
// wrangler.jsonc
{
  "name": "my-app",
  "main": "src/main.ts",
  "compatibility_date": "2026-10-01",
  "vars": { "HUUMA_ENV": "PROD" },
  // Serve static/ with Workers static assets instead of loadStaticFiles.
  "assets": { "directory": "./static" }
}
```

The core doesn't need `nodejs_compat`. Only `@huuma/route/http/tasks/*` and `@huuma/route/node` use Node.js built-ins, and they aren't meant for Workers.

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or pull request on our GitHub repository.

`package.json` holds development tooling only; the package is published to JSR from `jsr.json`.

```bash
bun install
bun run check       # tsc type check
bun test            # all tests, including Workers tests in workerd via Miniflare
bun run test:node   # the node:http adapter tests on Node.js
```

This framework is still in development and APIs may change in future versions.
