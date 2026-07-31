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
  const pool = writer(c.env.DATABASE_URL);
  c.set("writer", pool);

  await next();

  c.executionCtx.waitUntil(pool.end());
};
