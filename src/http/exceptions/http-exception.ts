import type { HttpStatus } from "../http-status.ts";

export class HttpException extends Error {
  status: HttpStatus;
  error?: string | string[];
  /** Sent with the error response, such as `Allow` or `WWW-Authenticate`. */
  headers: Headers;

  constructor(
    message: string,
    status: HttpStatus,
    error?: string | string[],
    headers?: HeadersInit,
  ) {
    super(message);
    this.status = status;
    this.error = error;
    this.headers = new Headers(headers);
  }
}
