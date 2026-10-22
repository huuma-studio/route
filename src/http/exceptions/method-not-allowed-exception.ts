import { HttpStatus } from "../http-status.ts";
import { HttpException } from "./http-exception.ts";

export class MethodNotAllowedException extends HttpException {
  /** @param allow - The methods the resource supports, sent as the `Allow` header */
  constructor(message: string = "Method Not Allowed", allow: string[] = []) {
    super(
      message,
      HttpStatus.METHOD_NOT_ALLOWED,
      undefined,
      allow.length ? { Allow: allow.join(", ") } : undefined,
    );
  }
}
