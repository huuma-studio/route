import { EntityTooLargeException } from "../../http/exceptions/entity-too-large-exception.ts";
import type { RequestContext } from "../../http/request.ts";
import { bodyParser } from "./body-parser.ts";
import { assertEquals } from "@std/assert";
import { assertRejects } from "@std/assert";

const requestOptions = {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
};

Deno.test("Body Parser:", async (t) => {
  await t.step("parse if body size not exceeds the max size", async () => {
    const ctx = <RequestContext> {
      request: new Request("https://huuma.studio", {
        ...requestOptions,
        body: '"a"',
      }),
    } as any;
    await bodyParser({ maxBodySize: 3 })(ctx, () => {
      return Promise.resolve(new Response());
    });
    assertEquals("a", ctx.body);
  });

  await t.step(
    'reject if body exceededs max size with "EntityTooLargeException"',
    () => {
      const ctx = <RequestContext> {
        request: new Request("https://huuma.studio", {
          ...requestOptions,
          body: '"a"',
        }),
      };
      assertRejects(
        () => {
          return bodyParser({ maxBodySize: 2 })(ctx, () => {
            return Promise.resolve(new Response());
          }) as Promise<Response>;
        },
        EntityTooLargeException,
      );
    },
  );

  await t.step(
    "handle undefined body",
    () => {
      const ctx = <RequestContext> {
        request: new Request("https://huuma.studio", {
          ...requestOptions,
        }),
      };

      bodyParser()(ctx, () => {
        return Promise.resolve(new Response());
      });

      assertEquals(ctx.body, undefined);
    },
  );

  await t.step('"application/json": parse json with body', async () => {
    const json = {
      hello: "world",
    };
    const jsonAsString = JSON.stringify(json);

    const ctx = <RequestContext> {
      request: new Request("https://huuma.studio", {
        ...requestOptions,
        body: jsonAsString,
      }),
    };

    await bodyParser()(ctx, () => {
      return Promise.resolve(new Response());
    });
    assertEquals(json, ctx.body);
  });

  await t.step('"application/json": parse empty json body', async () => {
    const json = "";
    const jsonAsString = JSON.stringify(json);

    const ctx = <RequestContext> {
      request: new Request("https://huuma.studio", {
        ...requestOptions,
        body: jsonAsString,
      }),
    };

    await bodyParser()(ctx, () => {
      return Promise.resolve(new Response());
    });

    assertEquals(json, ctx.body);
  });

  await t.step(
    '"application/json": reject not json string with "SyntaxError"',
    () => {
      const json = "peng";

      assertRejects(
        () => {
          return bodyParser()({
            request: new Request("https://huuma.studio", {
              ...requestOptions,
              body: json,
            }),
          } as any, () => {
            return Promise.resolve(new Response());
          }) as Promise<Response>;
        },
        SyntaxError,
      );
    },
  );
});
