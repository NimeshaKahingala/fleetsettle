import type { AuditLogEntry, BusinessMemberResponse } from "@fleetsettle/shared/schemas";
import type { TimelineEntry } from "../../components/Timeline.js";

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function amountOf(row: Record<string, unknown> | null): string | undefined {
  const value = row?.["amountMinor"];
  return typeof value === "string" ? value : undefined;
}

function statusOf(row: Record<string, unknown> | null): string | undefined {
  const value = row?.["status"];
  return typeof value === "string" ? value : undefined;
}

/**
 * F-8.6/UC-97/W-50: `Timeline`'s own contract is a pre-composed
 * `description` — `auditLogEntrySchema` gives raw `before`/`after` row
 * snapshots and a bare `changedBy` user id instead, so this is the one
 * translation from "what the audit trigger recorded" to "what a manager
 * reads." Scoped to `payment`'s own two fields that actually change under
 * a correction (`amountMinor`, `status`) — a generic before/after differ
 * across all eighteen `assert_period_open()` tables is real, separate
 * work this screen does not need yet.
 */
export function paymentAuditEntryToTimeline(
  entry: AuditLogEntry,
  members: BusinessMemberResponse[],
): TimelineEntry {
  const who =
    members.find((m) => m.userId === entry.changedBy)?.displayName ??
    (entry.changedBy !== null ? "A former member" : "The system");

  let description: string;
  if (entry.action === "insert") {
    description = "Payment recorded";
  } else if (entry.action === "void") {
    description = "Payment voided";
  } else {
    const before = amountOf(entry.before);
    const after = amountOf(entry.after);
    const status = statusOf(entry.after);
    description =
      before !== undefined && after !== undefined && before !== after
        ? `Corrected — amount changed`
        : status !== undefined
          ? `Corrected — now ${status.replace("_", " ")}`
          : "Corrected";
  }

  return { key: entry.id, who, whenLabel: formatWhen(entry.changedAt), description };
}
