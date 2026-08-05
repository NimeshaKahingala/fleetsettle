import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { findAuditLogForRecord } from "../queries/audit-log.js";
import type { getAuditLogRoute } from "../route-defs/audit-log.js";
import type { Env } from "../types.js";

/**
 * F-8.6/UC-97. `dailyOperations` (STAFF), not an owners-only capability:
 * "most of what it answers is 'did I already fix that,' asked by the person
 * who entered it" — usually a manager, not only the passive owner reading
 * the report.
 */
export const getAuditLogHandler: RouteHandler<typeof getAuditLogRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { tableName, recordId } = c.req.valid("param");

  const rows = await findAuditLogForRecord(c.get("reader"), businessId, tableName, recordId);

  return c.json(
    {
      entries: rows.map((row) => ({
        id: row.id.toString(),
        action: row.action as "insert" | "update" | "void",
        changedBy: row.changedBy,
        changedAt: row.changedAt,
        before: row.beforeJson as Record<string, unknown> | null,
        after: row.afterJson as Record<string, unknown> | null,
      })),
    },
    200,
  );
};
