import { parse } from "@fleetsettle/shared";
import type { DepositReleaseRow } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, HandCoins } from "lucide-react";
import { EmptyState } from "../../components/EmptyState.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface DepositReleasesScreenProps {
  onBack: () => void;
  /** Each row opens the party who is owed the money back — a deposit is money you hold, never income (CLAUDE.md → Money). */
  onSelectParty: (partyType: "customer" | "driver", partyId: string) => void;
}

/** Matches `HomeScreen.tsx`'s own `formatShortDate` exactly — no year. This screen deliberately shows the same fields as Home's section, so showing the same date two different ways would be the one thing it must not do. */
function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * GAP-183: the bell's "Deposits to release" row had no destination. Home
 * already renders this same list as a section, so this screen deliberately
 * shows the same fields rather than inventing new ones — it exists to give
 * the bell row somewhere to go, and to be a stable place to link to, not to
 * tell the reader anything Home does not.
 *
 * Reads `GET /api/home/deposit-releases`, the same endpoint Home uses, so
 * the two can never disagree about which deposits are due back.
 *
 * **A held deposit is money you hold, never income** — every figure here is
 * a liability, and the row's action is opening the party you owe it to, not
 * releasing it. Releasing runs through that party's own detail screen, where
 * the deposit's full movement history is (W-50: a release is a movement, and
 * movements belong with their deposit).
 */
export function DepositReleasesScreen({ onBack, onSelectParty }: DepositReleasesScreenProps) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["home", "deposit-releases"],
    queryFn: () => api.get<DepositReleaseRow[]>("/api/home/deposit-releases"),
  });
  const state = useQueryState(query);
  const rows = query.data ?? [];

  return (
    <Screen title="Deposits to release" onBack={onBack}>
      {state.kind === "error" ? (
        <QueryStateFailure error={state.error} retry={state.retry} of="deposits to release" />
      ) : null}

      {/* M-28/GAP-126: "nothing to release" is a real answer and must not be
          rendered while the read is still in flight — an empty list and an
          unresolved one are indistinguishable otherwise. */}
      {state.kind === "ready" && rows.length === 0 ? (
        <EmptyState
          message="Nothing to release"
          detail="No held deposit has reached its release date."
        />
      ) : null}

      {state.kind === "idle" || state.kind === "pending" ? (
        <p className="py-3 text-body-sm text-ink-muted">Loading…</p>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <button
              key={row.depositId}
              type="button"
              onClick={() => {
                onSelectParty(row.partyType, row.partyId);
              }}
              className={cn("w-full min-h-tap text-left", rowButtonFocus)}
            >
              <Card accent="warning" className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <HandCoins className="size-5 shrink-0 text-warning-ink" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-title text-ink-primary">{row.partyName ?? "—"}</p>
                    <p className="text-body-sm text-ink-muted">
                      Held since {formatShortDate(row.holdReleaseDate)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="warning">Release</Badge>
                    <Money value={parse(row.heldMinor)} />
                  </div>
                  <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                </div>
              </Card>
            </button>
          ))}
        </div>
      ) : null}
    </Screen>
  );
}
