import type { RouteHandler } from "@hono/zod-openapi";
import { requireBusinessId, requireCapability } from "../auth/context.js";
import { findAuditLogForRecord } from "../queries/audit-log.js";
import type { getAuditLogRoute } from "../route-defs/audit-log.js";
import type { Env } from "../types.js";

/**
 * GAP-122: `capital_contribution` and `partner_payout` are two of the
 * `auditedTableNameSchema` seventeen (@fleetsettle/shared) and, unlike the
 * rest, are `managePartnerCapital` (OWNERS) tables UC-03 denies a manager
 * direct access to — reachable through this route's own free-form
 * `tableName` param otherwise, the same "reach it by another route" shape
 * W-49 already names for the driver boundary. `ownership_share` carries no
 * `posted_period_id`, so migration `0002`'s trigger never attached to it at
 * all — not in `auditedTableNameSchema`, nothing to gate here.
 */
const OWNER_ONLY_AUDITED_TABLES: ReadonlySet<string> = new Set([
  "capital_contribution",
  "partner_payout",
]);

/**
 * F-8.6/UC-97. `dailyOperations` (STAFF) is the baseline — "most of what it
 * answers is 'did I already fix that,' asked by the person who entered it"
 * — usually a manager, not only the passive owner reading the report. The
 * two owners-only tables above narrow that per request (GAP-122).
 */
export const getAuditLogHandler: RouteHandler<typeof getAuditLogRoute, Env> = async (c) => {
  requireCapability(c, "dailyOperations");

  const businessId = requireBusinessId(c);
  const { tableName, recordId } = c.req.valid("param");
  if (OWNER_ONLY_AUDITED_TABLES.has(tableName)) {
    requireCapability(c, "managePartnerCapital");
  }

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
