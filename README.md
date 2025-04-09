# Huuma/Route

A flexible, modern web framework for building web applications with Deno and TypeScript.

## Features

- 🚀 Lightweight and flexible HTTP routing
- 🧩 Middleware-based architecture
- 🔄 Request context management
- 🛡️ Built-in error handling
- 📦 TypeScript support out of the box
- 🧪 Easy testing

## Installation

```typescript
import { App } from "jsr:@huuma/route@^0.0.1";
```

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
app.get("/protected", (ctx) => {
  return new Response("Protected resource");
}).middleware(authMiddleware);
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

app.middleware([
  bodyParser(),
  logTimeToResponse,
]);
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

Serve static files easily:

```typescript
import { loadAssets } from "jsr:@huuma/route/http/tasks/assets";
import { Favicon } from "jsr:@huuma/route/http/tasks/favicon";

// Serve all files from the 'public' directory
await loadAssets("public", app);

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

app.post("/users", (ctx) => {
  // At this point ctx.body is validated
  return new Response(`Created user: ${ctx.body.name}`);
}).middleware(validateBody(userSchema));
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

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or pull request on our GitHub repository.

This framework is still in development and APIs may change in future versions.
