import { HttpStatus } from "../http-status.ts";

export class HttpException extends Error {
  constructor(
    public message: string,
    public status: HttpStatus,
    public error?: string | string[],
  ) {
    super();
  }
}
