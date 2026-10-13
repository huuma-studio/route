import { app } from "./app.mjs";

// Same shape as `export default app`, which Bun passes to Bun.serve.
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
const response = await fetch(`http://127.0.0.1:${server.port}/`);
const body = await response.json();
server.stop(true);

if (response.status !== 200 || body.ok !== true) {
  console.error("Smoke test failed:", response.status, body);
  process.exit(1);
}
console.log("Bun smoke test passed:", body);
