import { describe, expect, it } from "vite-plus/test";
import type { RequestContext } from "../http/request.ts";
import { redirectToWithoutSlash } from "./redirect-to-without-slash.ts";

const next = () => Promise.resolve(new Response("next"));

function redirect(url: string) {
  return redirectToWithoutSlash(
    { request: new Request(url) } as RequestContext,
    next,
  );
}

describe("redirectToWithoutSlash", () => {
  it("redirects a path with a trailing slash", async () => {
    const response = await redirect("http://localhost/users/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost/users");
  });

  it("keeps the query string", async () => {
    const response = await redirect("http://localhost/users/?page=2&q=a/");
    expect(response.headers.get("location")).toBe(
      "http://localhost/users?page=2&q=a/",
    );
  });

  it("strips repeated trailing slashes in one redirect", async () => {
    const response = await redirect("http://localhost/users///");
    expect(response.headers.get("location")).toBe("http://localhost/users");
  });

  it("redirects // to the root", async () => {
    const response = await redirect("http://localhost//");
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("does not redirect the root", async () => {
    expect(await (await redirect("http://localhost/")).text()).toBe("next");
  });

  it("does not redirect a path without a trailing slash", async () => {
    expect(await (await redirect("http://localhost/users?q=a/")).text()).toBe(
      "next",
    );
  });
});
