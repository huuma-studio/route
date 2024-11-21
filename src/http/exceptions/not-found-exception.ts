import { HttpStatus } from "../http-status.ts";
import { HttpException } from "./http-exception.ts";

export class NotFoundException extends HttpException {
  constructor(message: string = "Not found") {
    super(message, HttpStatus.NOT_FOUND);
  }
}
