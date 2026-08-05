import type { ErrorHandler } from "hono";
import type { ErrorBody } from "@fleetsettle/shared";
import type { Env } from "../types.js";
import { AppError } from "./app-error.js";

/**
 * The one global `app.onError` (IG §3.3). Handlers throw; this is the only
 * place an error becomes an HTTP response, so the shape on the wire cannot
 * drift between flows. It also emits the request's log line for the error
 * path — `error` level with a stack for a 5xx, `warn` for a 4xx (IG §3.4) —
 * and marks the request so the logger middleware does not log it a second
 * time on the way back out.
 */
export const errorHandler: ErrorHandler<Env> = (err, c) => {
  const requestId = c.get("requestId");
  const appError = err instanceof AppError ? err : undefined;
  const status = appError?.status ?? 500;
  const level = status >= 500 ? "error" : "warn";

  // eslint-disable-next-line no-console -- IG §3.4: the one sanctioned structured-log emission point for the error path
  console.log(
    JSON.stringify({
      level,
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      businessId: c.get("businessId"),
      userId: c.get("userId"),
      // eslint-disable-next-line no-restricted-syntax -- log timestamp (a UTC instant), not a business date
      timestamp: new Date().toISOString(),
      ...(level === "error" ? { stack: err instanceof Error ? err.stack : undefined } : {}),
    }),
  );
  c.set("errorLogged", true);

  const body: ErrorBody = {
    error: appError?.message ?? "Internal error",
    code: appError?.code ?? "INTERNAL_ERROR",
    requestId,
    ...(appError?.details !== undefined ? { details: appError.details } : {}),
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "X-Request-Id": requestId },
  });
};
