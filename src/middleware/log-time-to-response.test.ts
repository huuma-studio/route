import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { RequestContext } from "../http/request.ts";
import { logTimeToResponse } from "./log-time-to-response.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logTimeToResponse", () => {
  it("logs method, path and status without the query string", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const ctx = {
      request: new Request("http://localhost/reset?token=secret", {
        method: "POST",
      }),
    } as RequestContext;

    const response = await logTimeToResponse(ctx, () =>
      Promise.resolve(new Response(null, { status: 204 })),
    );

    expect(response.status).toBe(204);
    const line = String(info.mock.calls[0][0]);
    expect(line).toMatch(/POST \/reset 204 took \d+ms$/);
    expect(line).not.toContain("secret");
  });
});
