// Smoke-test app built from the published @huuma/route package.
import { App } from "@huuma/route";
import { isProd } from "@huuma/route/utils/environment";

export const app = new App();
app.get("/", () => Response.json({ ok: true, prod: isProd() }));
