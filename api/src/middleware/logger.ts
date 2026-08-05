import type { MiddlewareHandler } from "hono";
import type { Env } from "../types.js";

/**
 * One JSON object per line, so Workers Logs can parse it without a grok
 * pattern (IG §3.4). `requestId` is echoed on the response header and in the
 * error body, so a user-reported failure maps back to exactly one log line.
 *
 * Handlers throw rather than hand-roll a response (IG §3.3), so every
 * non-2xx path already goes through the global error handler, which logs its
 * own line with the right level and a stack for a 5xx. This middleware only
 * logs the success path, and skips entirely when `errorHandler` already has
 * — never two log lines for one request.
 *
 * Never logs the request body — these bodies carry NICs, phone numbers and
 * amounts.
 */
export const requestLogger = (): MiddlewareHandler<Env> => async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);

  const start = Date.now();
  await next();

  if (c.get("errorLogged")) return;

  // eslint-disable-next-line no-console -- IG §3.4: the one sanctioned structured-log emission point for the success path
  console.log(
    JSON.stringify({
      level: "info",
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration: Date.now() - start,
      businessId: c.get("businessId"),
      userId: c.get("userId"),
      // eslint-disable-next-line no-restricted-syntax -- log timestamp (a UTC instant), not a business date
      timestamp: new Date().toISOString(),
    }),
  );
};
