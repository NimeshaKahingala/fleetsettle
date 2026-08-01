import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.js";
import { reader, writer } from "../db/client.js";

/**
 * Constructs both clients per request, never in module scope — isolates are
 * reused across requests, so a client held there would end up shared unsafely
 * (IG §4.1). Neither opens a connection just by being constructed, so mounting
 * this ahead of a route that turns out not to need one costs nothing.
 *
 * The pool closes in `waitUntil`, off the request path — never blocking the
 * response on connection teardown.
 */
export const dbMiddleware = (): MiddlewareHandler<Env> => async (c, next) => {
  c.set("reader", reader(c.env.DATABASE_URL));
  const db = writer(c.env.DATABASE_URL);
  c.set("writer", db);

  await next();

  // `writer()` wraps the Pool in Drizzle (IG §1.6); `$client` is Drizzle's
  // handle back to it for teardown.
  c.executionCtx.waitUntil(db.$client.end());
};
