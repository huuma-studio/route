#!/usr/bin/env bash
# Installs a published @huuma/route version into a throwaway project and runs
# the smoke-test app on Node, Bun and Deno. Usage: test/smoke/run.sh <version>
set -euo pipefail

version="$1"
here="$(cd "$(dirname "$0")" && pwd)"
project="$(mktemp -d)"
trap 'rm -rf "$project"' EXIT

cp "$here"/*.mjs "$project"
cd "$project"
echo '{ "private": true, "type": "module" }' > package.json

# JSR's npm registry can lag behind a fresh publish for a short while.
for attempt in 1 2 3 4 5 6; do
  if npx -y jsr add "@huuma/route@$version"; then break; fi
  if [ "$attempt" = 6 ]; then exit 1; fi
  sleep 20
done
node node.mjs

rm -rf node_modules package-lock.json .npmrc
echo '{ "private": true, "type": "module" }' > package.json
bunx jsr add "@huuma/route@$version"
bun bun.mjs

rm -rf node_modules package.json bun.lock .npmrc
# Deno resolves subpaths such as @huuma/route/utils/environment itself.
echo "{ \"imports\": { \"@huuma/route\": \"jsr:@huuma/route@$version\" } }" > deno.json
deno run --allow-net=127.0.0.1 --allow-env=HUUMA_ENV,HUUMA_LOG_LEVEL deno.mjs
