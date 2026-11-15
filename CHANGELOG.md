# Changelog

All notable changes to `@huuma/route` are listed here, starting with 0.3.2. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.2] - 2026-11-15

### Breaking

- `HttpMethod`, `HttpStatus`, `HookType` and `LogLevel` are const objects with a type of the same name instead of enums, so Node.js can run the source with type stripping. Values such as `HttpMethod.GET` work as before. ([#18](https://github.com/huuma-studio/route/pull/18))
- `Cors()` throws a `TypeError` for `allowedCorsDomains: ["*"]` combined with `allowCredentials: true`, which let any website send credentialed requests and read the responses. List the allowed origins instead. ([#28](https://github.com/huuma-studio/route/pull/28))
- `loadStaticFiles` skips files and directories whose names start with a dot, such as `.env` and `.git`, except `.well-known`. Pass `dotfiles: true` to serve them as before. ([#27](https://github.com/huuma-studio/route/pull/27))
- Route parameters are percent-decoded once, so `/blog/caf%C3%A9` gives `café`. Apps that decode them again now decode twice. A malformed escape answers 400. ([#31](https://github.com/huuma-studio/route/pull/31))
- `serve()` on Node closes the remaining connections after a `shutdownTimeout` grace period, 30 seconds by default. `shutdown()` and `finished` resolve with `{ forced }` instead of `void`, so an explicit `Promise<void>` annotation on them no longer type-checks. ([#25](https://github.com/huuma-studio/route/pull/25))

### Added

- `shutdownTimeout` option for `serve()`, and `{ forced }`, which says whether the deadline had to close connections. ([#25](https://github.com/huuma-studio/route/pull/25))
- `trustProxy` option for the Node adapter, which takes the scheme from `X-Forwarded-Proto`. ([#14](https://github.com/huuma-studio/route/pull/14))
- `dotfiles` option for `loadStaticFiles`. ([#27](https://github.com/huuma-studio/route/pull/27))
- `HttpStatus.TEMPORARY_REDIRECT`, `PERMANENT_REDIRECT` and `EXPECTATION_FAILED`. The misspelled names stay as deprecated aliases. ([#18](https://github.com/huuma-studio/route/pull/18))
- Static files support caching headers and range requests, and stream their responses by default. ([#17](https://github.com/huuma-studio/route/pull/17), [#24](https://github.com/huuma-studio/route/pull/24))

### Changed

- A request for a path whose routes don't allow the method answers 405 with an `Allow` header. HEAD requests use the GET route, and each route is matched once per request. ([#16](https://github.com/huuma-studio/route/pull/16), [#30](https://github.com/huuma-studio/route/pull/30))
- Route group middleware runs once per request, in registration order. ([#21](https://github.com/huuma-studio/route/pull/21))
- CORS answers preflight requests and adds its headers to every response. ([#15](https://github.com/huuma-studio/route/pull/15))
- Exceptions are logged through the logger, colors are used only in terminals, and query strings stay out of the logs. ([#11](https://github.com/huuma-studio/route/pull/11))

### Deprecated

- `RouteGroup.link`. Use `use` or middleware instead. ([#23](https://github.com/huuma-studio/route/pull/23))

### Fixed

- Static files serve any file name and answer 404 for missing files. ([#17](https://github.com/huuma-studio/route/pull/17))
- Grouped routes can have the same path as an ungrouped route. ([#26](https://github.com/huuma-studio/route/pull/26))
- Query parameters are parsed in one pass and can't reach object prototypes, such as `?__proto__=…`. ([#19](https://github.com/huuma-studio/route/pull/19), [#22](https://github.com/huuma-studio/route/pull/22))
- Requests are blocked after the application failed to initialize. ([#20](https://github.com/huuma-studio/route/pull/20))
- Request hooks run before the request state is cleared, and stay alive on Cloudflare Workers. ([#12](https://github.com/huuma-studio/route/pull/12))
- Exceptions keep their message in stack traces and send their headers. ([#8](https://github.com/huuma-studio/route/pull/8))
- The body parser accepts `Content-Type` parameters and answers malformed bodies with 400. ([#9](https://github.com/huuma-studio/route/pull/9))
- `redirectToWithoutSlash` keeps the query string. ([#10](https://github.com/huuma-studio/route/pull/10))

[0.3.2]: https://jsr.io/@huuma/route@0.3.2
