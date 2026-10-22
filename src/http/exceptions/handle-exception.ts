import { HttpException } from "./http-exception.ts";
import { HttpStatus } from "../http-status.ts";
import { debug, error as logError } from "../../utils/logger.ts";

interface ExceptionBody {
  status: HttpStatus;
  message: string;
  error?: string | string[];
}

export function handleException(error: unknown): Response {
  let body: ExceptionBody = {
    status: HttpStatus.INTERNAL_ERROR,
    message: "Internal Server Error",
  };
  if (error instanceof HttpException) {
    body = {
      message: error.message,
      status: error.status,
      error: error.error,
    };
  }
  logException(error, body.status);

  return Response.json(body, { status: body.status });
}

// Client errors are expected (scanners, typos), so they only show at DEBUG
// level; server errors are logged with their stack.
function logException(error: unknown, status: HttpStatus): void {
  if (status < HttpStatus.INTERNAL_ERROR) {
    const message = error instanceof Error ? error.message : String(error);
    debug("HTTP EXCEPTION", `${status} ${message}`);
    return;
  }
  logError(
    "HTTP EXCEPTION",
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
}
