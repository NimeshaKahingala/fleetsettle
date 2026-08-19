import type { AdminBusiness } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface BusinessesListScreenProps {
  onBack: () => void;
}

/**
 * Design §4/INV-38: name, created date, member count — never anything else.
 * `adminBusinessSchema` structurally has no money field to accidentally
 * render, so there is nothing here to be careful about beyond not adding
 * one. Read-only: no row action, no navigation into a business's own data —
 * the platform tier cannot reach it (§4's hard boundary).
 */
export function BusinessesListScreen({ onBack }: BusinessesListScreenProps) {
  const api = useApi();

  const businessesQuery = useQuery({
    queryKey: ["admin", "businesses"],
    queryFn: () => api.get<AdminBusiness[]>("/api/admin/businesses"),
  });
  const businessesState = useQueryState(businessesQuery);
  const businesses = businessesQuery.data ?? [];

  return (
    <Screen title="Businesses" onBack={onBack}>
      {businessesState.kind === "error" ? (
        <QueryStateFailure
          error={businessesState.error}
          retry={businessesState.retry}
          of="the business list"
        />
      ) : businessesQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : businesses.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">No businesses yet.</p>
        </Card>
      ) : (
        <Section
          title="Businesses"
          count={businesses.length}
          items={businesses.map((business) => (
            <Card key={business.id} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-body text-ink-primary">{business.name}</p>
                <p className="text-caption text-ink-muted">Created {business.createdAt}</p>
              </div>
              <p className="shrink-0 text-body-sm text-ink-secondary">
                {business.memberCount} {business.memberCount === 1 ? "member" : "members"}
              </p>
            </Card>
          ))}
        />
      )}
    </Screen>
  );
}
