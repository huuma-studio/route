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
// level; server errors are logged with their stack. Both include the
// chain of causes, such as a parser error behind a 400.
function logException(error: unknown, status: HttpStatus): void {
  if (status < HttpStatus.INTERNAL_ERROR) {
    debug("HTTP EXCEPTION", `${status} ${describe(error, false)}`);
    return;
  }
  logError("HTTP EXCEPTION", describe(error, true));
}

function describe(error: unknown, withStack: boolean, depth = 0): string {
  if (!(error instanceof Error)) return String(error);
  const text = withStack ? (error.stack ?? error.message) : error.message;
  // Guards against cause cycles.
  if (error.cause === undefined || depth >= 5) return text;
  return `${text}\nCaused by: ${describe(error.cause, withStack, depth + 1)}`;
}
