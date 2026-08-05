import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.js";
import { reader, withActor, writer } from "../db/client.js";

/**
 * Constructs both clients per request, never in module scope — isolates are
 * reused across requests, so a client held there would end up shared unsafely
 * (IG §4.1). Neither opens a connection just by being constructed, so mounting
 * this ahead of a route that turns out not to need one costs nothing.
 *
 * The pool closes in `waitUntil`, off the request path — never blocking the
 * response on connection teardown.
 *
 * `c.get("writer")` is wrapped in `withActor` (P9/F-8.6) so every domain
 * transaction is attributed to the authenticated user without any of them
 * having to ask for it — `getActorId` reads `c.get("userId")` lazily, which
 * `authMiddleware` (mounted after this) has always set by the time a handler
 * actually opens a transaction. `/api/business`'s bootstrap route is the one
 * exception (`verifyTokenMiddleware`, no `userId` yet) and gets a NULL actor,
 * the same documented fallback `audit_actor()` already gives a cron write.
 */
export const dbMiddleware = (): MiddlewareHandler<Env> => async (c, next) => {
  c.set("reader", reader(c.env.DATABASE_URL));
  const raw = writer(c.env.DATABASE_URL);
  c.set(
    "writer",
    withActor(raw, () => c.get("userId")),
  );

  await next();

  // `writer()` wraps the Pool in Drizzle (IG §1.6); `$client` is Drizzle's
  // handle back to it for teardown — read off the raw instance, since the
  // Proxy only overrides `.transaction`.
  c.executionCtx.waitUntil(raw.$client.end());
};
