/** Returns the extension of the last path segment without the dot (`"tsx"` for `pages/home.tsx`). */
export function extension(path: string): string {
  return parse(path).ext.replace(".", "");
}

/** Returns the last path segment without its extension (`"home"` for `pages/home.tsx`). */
export function name(path: string): string {
  return parse(path).name;
}

// POSIX-only equivalent of `@std/path`'s `parse` for `name` and `ext`. Only
// `/` separates segments, and a leading dot (`.env`) does not start an extension.
function parse(path: string): { name: string; ext: string } {
  const base = path.replace(/\/+$/, "").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || base === "..") {
    return { name: base, ext: "" };
  }
  return { name: base.slice(0, dot), ext: base.slice(dot) };
}
