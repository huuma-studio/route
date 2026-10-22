import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { HttpStatus } from "../http-status.ts";
import { handleException } from "./handle-exception.ts";
import { HttpException } from "./http-exception.ts";
import { NotFoundException } from "./not-found-exception.ts";

describe("HttpException", () => {
  it("passes the message to Error, so stack traces show it", () => {
    const exception = new NotFoundException("No user 42");
    expect(exception.message).toBe("No user 42");
    expect(exception.stack).toContain("No user 42");
  });

  it("keeps status and error details", () => {
    const exception = new HttpException("Invalid", HttpStatus.BAD_REQUEST, [
      "name is required",
    ]);
    expect(exception.status).toBe(400);
    expect(exception.error).toEqual(["name is required"]);
  });
});

describe("handleException", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the exception's headers with the error response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exception = new HttpException(
      "Unauthorized",
      HttpStatus.UNAUTHORIZED,
      undefined,
      { "WWW-Authenticate": "Bearer" },
    );
    exception.headers.set("X-Request-Id", "abc");

    const response = handleException(exception);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(response.headers.get("x-request-id")).toBe("abc");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("answers other errors with a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = handleException(new Error("db password is hunter2"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
