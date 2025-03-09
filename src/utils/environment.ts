const HUUMA_ENV = "HUUMA_ENV";

export function isProd(): boolean {
  return Deno.env.get(HUUMA_ENV) === "PROD";
}

export function isEnvironment(name: string): boolean {
  return Deno.env.get(HUUMA_ENV) === name;
}
