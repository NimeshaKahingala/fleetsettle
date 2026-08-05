import { and, desc, eq } from "drizzle-orm";
import type { Reader, Tx, Writer } from "../db/client.js";
import { auditLog } from "../db/schema.js";

type ReadDb = Reader | Writer | Tx;

export interface AuditLogEntryRow {
  id: bigint;
  action: string;
  changedBy: string | null;
  changedAt: string;
  beforeJson: unknown;
  afterJson: unknown;
}

/**
 * F-8.6/UC-97: "from any money record — who created it, who changed it, when,
 * and from what to what," newest first (mirroring DM's own `audit_by_record`
 * index order). Scoped by `businessId` the same way every P2+ read is —
 * a foreign business's record simply matches nothing, so this never needs to
 * distinguish "no history yet" from "not yours" (both return an empty list).
 */
export async function findAuditLogForRecord(
  db: ReadDb,
  businessId: string,
  tableName: string,
  recordId: string,
): Promise<AuditLogEntryRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      changedBy: auditLog.changedBy,
      changedAt: auditLog.changedAt,
      beforeJson: auditLog.beforeJson,
      afterJson: auditLog.afterJson,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.businessId, businessId),
        eq(auditLog.tableName, tableName),
        eq(auditLog.recordId, recordId),
      ),
    )
    .orderBy(desc(auditLog.changedAt));
  return rows;
}
