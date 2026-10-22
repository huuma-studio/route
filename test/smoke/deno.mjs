import { app } from "./app.mjs";

const server = Deno.serve(
  { port: 0, hostname: "127.0.0.1", onListen() {} },
  app.fetch,
);
const response = await fetch(`http://127.0.0.1:${server.addr.port}/`);
const body = await response.json();
await server.shutdown();

if (response.status !== 200 || body.ok !== true) {
  console.error("Smoke test failed:", response.status, body);
  Deno.exit(1);
}
console.log("Deno smoke test passed:", body);
