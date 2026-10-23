let revision = 0;

/**
 * Changes whenever the path or method of a route changes, such as when a
 * group prefixes it, so a router knows when to rebuild its index.
 */
export function routeRevision(): number {
  return revision;
}

export function routeChanged(): void {
  revision++;
}
