import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { setEnv } from "../../utils/environment.ts";
import { handleException } from "./handle-exception.ts";
import { InternalServerException } from "./internal-server-exception.ts";
import { NotFoundException } from "./not-found-exception.ts";

afterEach(() => {
  vi.restoreAllMocks();
  setEnv({ HUUMA_LOG_LEVEL: undefined });
});

function spies() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

describe("handleException logging", () => {
  it("logs client errors at DEBUG level", () => {
    const { log, error } = spies();
    handleException(new NotFoundException("No user 42"));
    expect(error).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("404 No user 42");
  });

  it("hides client errors above DEBUG level", () => {
    setEnv({ HUUMA_LOG_LEVEL: "INFO" });
    const { log, error } = spies();
    handleException(new NotFoundException());
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("logs server errors with their stack at ERROR level", () => {
    setEnv({ HUUMA_LOG_LEVEL: "ERROR" });
    const { error } = spies();
    handleException(new Error("database down"));
    handleException(new InternalServerException("broken"));
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0][0]).toContain("Error: database down");
    expect(error.mock.calls[0][0]).toContain("handle-exception.test.ts");
    expect(error.mock.calls[1][0]).toContain("broken");
  });

  it("can't be silenced past ERROR for server errors", () => {
    setEnv({ HUUMA_LOG_LEVEL: "FATAL" });
    const { error } = spies();
    handleException(new Error("database down"));
    expect(error).not.toHaveBeenCalled();
  });
});
