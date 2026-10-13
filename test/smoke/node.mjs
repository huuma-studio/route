import { serve } from "@huuma/route/node";
import { app } from "./app.mjs";

const server = await serve(app, { port: 0, hostname: "127.0.0.1" });
const response = await fetch(`http://127.0.0.1:${server.port}/`);
const body = await response.json();
await server.shutdown();

if (response.status !== 200 || body.ok !== true) {
  console.error("Smoke test failed:", response.status, body);
  process.exit(1);
}
console.log("Node smoke test passed:", body);
