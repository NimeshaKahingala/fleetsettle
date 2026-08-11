import { parse } from "@fleetsettle/shared";
import type { DriverViewResponse, LostReason } from "@fleetsettle/shared/schemas";
import { MoreVertical } from "lucide-react";
import { Money } from "../../components/Money.js";
import { Badge, type BadgeProps } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Section } from "../../design/primitives/Section.js";
import { LOST_REASON_LABEL } from "../../lib/lostReasonLabel.js";

export interface DriverActivitySectionsProps {
  view: DriverViewResponse;
  onSettleAdvance?: (advance: DriverViewResponse["advances"][number]) => void;
}

const DAY_STATE_LABEL: Record<DriverViewResponse["days"][number]["state"], string> = {
  open: "Open",
  ran_paid_full: "Ran, paid full",
  ran_paid_short: "Ran, paid short",
  ran_unpaid: "Ran, unpaid",
  did_not_run: "Did not run",
  paused_for_trip: "Excused for trip",
};

const DAY_STATE_VARIANT: Record<
  DriverViewResponse["days"][number]["state"],
  BadgeProps["variant"]
> = {
  open: "neutral",
  ran_paid_full: "good",
  ran_paid_short: "warning",
  ran_unpaid: "serious",
  did_not_run: "critical",
  paused_for_trip: "brand",
};

const ADVANCE_STATUS_LABEL: Record<DriverViewResponse["advances"][number]["status"], string> = {
  open: "Open",
  part_settled: "Part settled",
  settled: "Settled",
};

const ADVANCE_STATUS_VARIANT: Record<
  DriverViewResponse["advances"][number]["status"],
  BadgeProps["variant"]
> = {
  open: "warning",
  part_settled: "serious",
  settled: "good",
};

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function lostReasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return reason in LOST_REASON_LABEL ? LOST_REASON_LABEL[reason as LostReason] : "Other";
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <p className="text-body text-ink-secondary">{children}</p>
    </Card>
  );
}

/**
 * Shared rendering for A5's two driver-history endpoints. Mine passes no
 * advance handler and stays read-only; staff detail passes the one GAP-100
 * write affordance that belongs to managers.
 */
export function DriverActivitySections({ view, onSettleAdvance }: DriverActivitySectionsProps) {
  return (
    <div className="flex flex-col gap-5">
      {view.days.length > 0 ? (
        <Section
          title="Recent days"
          count={view.days.length}
          items={view.days.map((day) => {
            const reason = lostReasonLabel(day.lostReason);
            return (
              <Card key={day.businessDate} className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-body text-ink-primary">{formatShortDate(day.businessDate)}</p>
                  <p className="text-caption text-ink-muted">
                    Earned <Money value={parse(day.earnedMinor)} /> · Received{" "}
                    <Money value={parse(day.receivedMinor)} />
                    {reason !== null ? <> · {reason}</> : null}
                  </p>
                </div>
                <Badge variant={DAY_STATE_VARIANT[day.state]}>{DAY_STATE_LABEL[day.state]}</Badge>
              </Card>
            );
          })}
        />
      ) : (
        <EmptyCard>No recent days.</EmptyCard>
      )}

      {view.trips.length > 0 ? (
        <Section
          title="Trips and fees"
          count={view.trips.length}
          items={view.trips.map((trip) => (
            <Card key={trip.id} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-body text-ink-primary">Closed trip</p>
                <p className="text-caption text-ink-muted">
                  {trip.closingDate !== null ? formatShortDate(trip.closingDate) : "Date not set"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-caption text-ink-muted">Driver fee</p>
                <Money value={parse(trip.driverFeeMinor)} />
              </div>
            </Card>
          ))}
        />
      ) : (
        <EmptyCard>No closed trips yet.</EmptyCard>
      )}

      {view.advances.length > 0 ? (
        <Section
          title="Advances"
          count={view.advances.length}
          items={view.advances.map((advance) => {
            const canSettle = onSettleAdvance !== undefined && advance.status !== "settled";
            const row = (
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-body text-ink-primary">{formatShortDate(advance.issuedOn)}</p>
                  <Badge variant={ADVANCE_STATUS_VARIANT[advance.status]}>
                    {ADVANCE_STATUS_LABEL[advance.status]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Money value={parse(advance.amountMinor)} />
                  {canSettle ? (
                    <MoreVertical className="size-4 text-ink-muted" aria-hidden />
                  ) : null}
                </div>
              </Card>
            );
            return canSettle ? (
              <button
                key={advance.id}
                type="button"
                className="w-full text-left"
                aria-label={`Settle advance from ${formatShortDate(advance.issuedOn)}`}
                onClick={() => onSettleAdvance(advance)}
              >
                {row}
              </button>
            ) : (
              <div key={advance.id}>{row}</div>
            );
          })}
        />
      ) : (
        <EmptyCard>No advances in this window.</EmptyCard>
      )}

      {view.offsets.length > 0 ? (
        <Section
          title="Offsets"
          count={view.offsets.length}
          items={view.offsets.map((offset) => (
            <Card key={offset.id} className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">{formatShortDate(offset.occurredOn)}</p>
              <Money value={parse(offset.amountMinor)} />
            </Card>
          ))}
        />
      ) : (
        <EmptyCard>No offsets in this window.</EmptyCard>
      )}

      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="text-body text-ink-primary">Held deposit</p>
          <p className="text-caption text-ink-muted">
            {view.deposit === null ? "No deposit held" : "Still held, never income"}
          </p>
        </div>
        {view.deposit !== null ? <Money value={parse(view.deposit.heldMinor)} /> : null}
      </Card>
    </div>
  );
}
