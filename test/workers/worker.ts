// A Cloudflare Worker that exports the app directly, as apps are expected to.
import { App } from "../../src/mod.ts";
import { BadRequestException } from "../../src/http/exceptions/bad-request-exception.ts";
import { isProd } from "../../src/utils/environment.ts";
import { getLogLevel, LogLevel } from "../../src/utils/logger.ts";

type Env = { HUUMA_ENV: string; GREETING: string };

const app = new App<{ Env: Env }>();
let backgroundRuns = 0;

app.use(async (_ctx, next) => {
  const response = await next();
  response.headers.set("X-Middleware", "applied");
  return response;
});

app.get("/", (ctx) =>
  Response.json({
    prod: isProd(),
    logLevel: LogLevel[getLogLevel()],
    greeting: ctx.env.GREETING,
    remoteAddr: ctx.connection.remoteAddr,
    process: typeof (globalThis as { process?: unknown }).process,
  }));

app.get("/error", () => {
  throw new BadRequestException("invalid input");
});

app.get("/wait", (ctx) => {
  ctx.waitUntil(
    new Promise((resolve) => setTimeout(resolve, 20)).then(() =>
      backgroundRuns++
    ),
  );
  return new Response("scheduled");
});

app.get("/background", () => Response.json({ runs: backgroundRuns }));

export default app;
