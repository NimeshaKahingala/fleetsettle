import type { ErrorHandler } from "hono";
import type { ErrorBody } from "@fleetsettle/shared";
import type { Env } from "../types.js";
import { isPartyArchivedViolation } from "../db/pg-error.js";
import { AppError, PartyArchivedError } from "./app-error.js";

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

  // GAP-178/B13. Mapped here rather than at each domain call site, and
  // deliberately against this codebase's own convention for DB-enforced
  // invariants (the ~25 `isPeriodClosedViolation` catches).
  //
  // Claude's review of PR #117 found the mapping had no caller at all, so an
  // ordinary write against an archived party surfaced as an unexplained 500.
  // Adding it to every domain catch would be ~25 edits that a write path
  // added next year would silently miss — which is the same drift argument
  // that made migration 0031 a trigger rather than a lock on each write
  // path. The guard covers every money write path by construction, so its
  // mapping should too.
  //
  // `assert_period_open` stays per-site: a caller sometimes wants to handle
  // PERIOD_CLOSED rather than return it, and several do.
  const mapped = isPartyArchivedViolation(err) ? new PartyArchivedError() : err;
  const appError = mapped instanceof AppError ? mapped : undefined;
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
