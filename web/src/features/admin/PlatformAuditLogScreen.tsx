import type { PlatformAuditLogEntry } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { formatTimestamp } from "../../lib/formatTimestamp.js";
import { PLATFORM_AUDIT_ACTION_LABEL } from "../../lib/platformAuditActionLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface PlatformAuditLogScreenProps {
  onBack: () => void;
}

/**
 * F-11.2/W-67: the platform's own log — never `audit_log`, which is
 * tenant-scoped and not this tier's (design §3/§4). Read-only, newest
 * first: action (plain English, CLAUDE.md's vocabulary rule — never the raw
 * `platformAuditActionSchema` value), subject, actor (already resolved
 * server-side to `displayName ?? email ?? "Unnamed user"`, decision 28), a
 * self-action badge, and the timestamp.
 */
export function PlatformAuditLogScreen({ onBack }: PlatformAuditLogScreenProps) {
  const api = useApi();

  const logQuery = useQuery({
    queryKey: ["admin", "audit-log"],
    queryFn: () => api.get<PlatformAuditLogEntry[]>("/api/admin/audit-log"),
  });
  const logState = useQueryState(logQuery);
  const entries = logQuery.data ?? [];

  return (
    <Screen title="Platform log" onBack={onBack}>
      {logState.kind === "error" ? (
        <QueryStateFailure error={logState.error} retry={logState.retry} of="the platform log" />
      ) : logQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">Nothing recorded yet.</p>
        </Card>
      ) : (
        <Section
          title="Entries"
          count={entries.length}
          items={entries.map((entry) => (
            <Card key={entry.id} className="flex flex-col gap-1">
              <p className="text-body text-ink-primary">
                {PLATFORM_AUDIT_ACTION_LABEL[entry.action]}
              </p>
              <p className="text-caption text-ink-muted">
                {entry.actorName} · {formatTimestamp(entry.createdAt, { withTime: true })}
              </p>
              {entry.selfAction ? <Badge variant="neutral">Self</Badge> : null}
            </Card>
          ))}
        />
      )}
    </Screen>
  );
}
