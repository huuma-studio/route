import { describe, expect, it } from "bun:test";
import { extension, name } from "./file.ts";

// Expected values match `@std/path/posix` `parse`, which this module replaced.
const CASES: [path: string, name: string, extension: string][] = [
  ["pages/home.tsx", "home", "tsx"],
  ["file.tar.gz", "file.tar", "gz"],
  ["/abs/path/x.css", "x", "css"],
  ["dir/file.ts/", "file", "ts"],
  ["noext", "noext", ""],
  ["foo.", "foo", ""],
  [".env", ".env", ""],
  ["a/.env", ".env", ""],
  ["a/.env.local", ".env", "local"],
  [".", ".", ""],
  ["..", "..", ""],
  ["...", "..", ""],
  ["..a", ".", "a"],
  ["", "", ""],
  ["/", "", ""],
  ["a\\b.ts", "a\\b", "ts"],
  ["C:\\dir\\file.ts", "C:\\dir\\file", "ts"],
];

describe("File utility functions", () => {
  it.each(CASES)("parses %j", (path, expectedName, expectedExtension) => {
    expect(name(path)).toBe(expectedName);
    expect(extension(path)).toBe(expectedExtension);
  });
});
