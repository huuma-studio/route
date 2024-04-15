import { parse } from "@std/path";

export function extension(path: string): string {
  return parse(path).ext.replace(".", "");
}

export function name(path: string): string {
  return parse(path).name;
}
