import type { MiddlewareHandler } from "hono";
import { RateLimitedError } from "../errors/app-error.js";
import type { Env } from "../types.js";

/**
 * IG §13: the Workers rate-limiting binding, not a database row per request
 * (two round trips and unbounded growth for the one thing this exists to
 * bound). Keyed by the caller's IP — `CF-Connecting-IP` is set by Cloudflare
 * at the edge, not the client, so it isn't a header a caller can spoof past.
 * Mounted globally (`*`), the same as the request logger, rather than
 * hand-listing routes that will keep growing through every later phase.
 */
export const rateLimitMiddleware = (): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const key = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await c.env.RATE_LIMITER.limit({ key });
    if (!success) throw new RateLimitedError();
    await next();
  };
};
