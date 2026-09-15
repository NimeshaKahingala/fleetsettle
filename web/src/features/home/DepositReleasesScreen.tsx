import { parse, type BusinessDate } from "@fleetsettle/shared";
import type { DepositReleaseRow } from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, HandCoins } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../../components/EmptyState.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { ReleaseDepositSheet } from "./ReleaseDepositSheet.js";

export interface DepositReleasesScreenProps {
  onBack: () => void;
  /** Each row's own name/date opens the party who is owed the money back — a deposit is money you hold, never income (CLAUDE.md → Money). */
  onSelectParty: (partyType: "customer" | "driver", partyId: string) => void;
  today: BusinessDate;
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
 * a liability. GAP-230, 13 Sept 2026, the owner's own answer on where the
 * release action lives: **this screen**, not the party's own detail screen —
 * a "Release" button beside each row opens `ReleaseDepositSheet` directly.
 * The row's name/date still opens the party, unchanged, for the movement
 * history a release adds to.
 */
export function DepositReleasesScreen({
  onBack,
  onSelectParty,
  today,
}: Readonly<DepositReleasesScreenProps>) {
  const api = useApi();
  const query = useQuery({
    queryKey: ["home", "deposit-releases"],
    queryFn: () => api.get<DepositReleaseRow[]>("/api/home/deposit-releases"),
  });
  const state = useQueryState(query);
  const rows = query.data ?? [];
  const [releasing, setReleasing] = useState<DepositReleaseRow | null>(null);

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
            <Card key={row.depositId} accent="warning" className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => {
                  onSelectParty(row.partyType, row.partyId);
                }}
                className={cn(
                  "flex min-w-0 min-h-tap flex-1 items-center gap-3 text-left",
                  rowButtonFocus,
                )}
              >
                <HandCoins className="size-5 shrink-0 text-warning-ink" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-title text-ink-primary">{row.partyName ?? "—"}</p>
                  <p className="text-body-sm text-ink-muted">
                    Held since {formatShortDate(row.holdReleaseDate)}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </button>
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="warning">Due</Badge>
                  <Money value={parse(row.heldMinor)} />
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReleasing(row);
                  }}
                >
                  Release
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {releasing !== null ? (
        <ReleaseDepositSheet
          open
          onOpenChange={(open) => {
            if (!open) setReleasing(null);
          }}
          depositId={releasing.depositId}
          heldMinor={parse(releasing.heldMinor)}
          today={today}
        />
      ) : null}
    </Screen>
  );
}
