import { HttpStatus } from "../http-status.ts";
import { HttpException } from "./http-exception.ts";

export class BadRequestException extends HttpException {
  constructor(message: string = "Bad Request Error") {
    super(message, HttpStatus.BAD_REQUEST);
  }
}
