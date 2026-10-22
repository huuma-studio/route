import { HttpException } from "./http-exception.ts";
import { HttpStatus } from "../http-status.ts";

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
  let headers: Headers | undefined;
  if (error instanceof HttpException) {
    body = {
      message: error.message,
      status: error.status,
      error: error.error,
    };
    headers = error.headers;
  }
  console.error(error);

  return Response.json(body, { status: body.status, headers });
}
