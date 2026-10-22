import type { Parser } from "./body-parser.ts";

export const JSONParser: Parser<unknown> = {
  mimeType: "application/json",
  parse: (buffer: Uint8Array) => {
    return JSON.parse(new TextDecoder().decode(buffer));
  },
};
