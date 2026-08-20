import { parse } from "@fleetsettle/shared";
import type { DriverViewOffset, DriverViewResponse, LostReason } from "@fleetsettle/shared/schemas";
import { Money } from "../../components/Money.js";
import { Badge, type BadgeProps } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Section } from "../../design/primitives/Section.js";
import { LOST_REASON_LABEL } from "../../lib/lostReasonLabel.js";

type DriverViewDepositMovement = NonNullable<DriverViewResponse["deposit"]>["movements"][number];

export interface DriverActivitySectionsProps {
  view: DriverViewResponse;
  onSettleAdvance?: (advance: DriverViewResponse["advances"][number]) => void;
  onVoidAdvance?: (advance: DriverViewResponse["advances"][number]) => void;
  onVoidOffset?: (offset: DriverViewOffset) => void;
  onVoidDepositMovement?: (movement: DriverViewDepositMovement) => void;
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

const DEPOSIT_MOVEMENT_LABEL: Record<DriverViewDepositMovement["movementType"], string> = {
  taken: "Taken",
  topped_up: "Top up",
  reduced: "Reduced",
  applied: "Applied",
  refunded: "Refunded",
  retained: "Retained",
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
export function DriverActivitySections({
  view,
  onSettleAdvance,
  onVoidAdvance,
  onVoidOffset,
  onVoidDepositMovement,
}: DriverActivitySectionsProps) {
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
            const canVoid = onVoidAdvance !== undefined && advance.status !== "settled";
            return (
              <Card key={advance.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-body text-ink-primary">
                      {formatShortDate(advance.issuedOn)}
                    </p>
                    <Badge variant={ADVANCE_STATUS_VARIANT[advance.status]}>
                      {ADVANCE_STATUS_LABEL[advance.status]}
                    </Badge>
                  </div>
                  <Money value={parse(advance.amountMinor)} />
                </div>
                {canSettle || canVoid ? (
                  <div className="grid grid-cols-2 gap-2">
                    {canSettle ? (
                      <button
                        type="button"
                        className="min-h-tap rounded-sm border border-line-strong px-3 text-body text-ink-primary"
                        aria-label={`Settle advance from ${formatShortDate(advance.issuedOn)}`}
                        onClick={() => onSettleAdvance(advance)}
                      >
                        Settle
                      </button>
                    ) : null}
                    {canVoid ? (
                      <button
                        type="button"
                        className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                        aria-label={`Void advance from ${formatShortDate(advance.issuedOn)}`}
                        onClick={() => onVoidAdvance(advance)}
                      >
                        Void
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </Card>
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
          items={view.offsets.map((offset) => {
            const voided = offset.voidedAt !== null;
            return (
              <Card key={offset.id} className="flex items-center justify-between gap-4">
                <div>
                  <p
                    className={`text-body text-ink-primary ${voided ? "line-through decoration-critical decoration-2" : ""}`}
                  >
                    {formatShortDate(offset.occurredOn)}
                  </p>
                  {voided ? (
                    <p className="text-caption text-critical-ink">
                      Voided{offset.voidedReason !== null ? ` · ${offset.voidedReason}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <Money value={parse(offset.amountMinor)} />
                  {onVoidOffset !== undefined && !voided ? (
                    <button
                      type="button"
                      className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      aria-label={`Void offset from ${formatShortDate(offset.occurredOn)}`}
                      onClick={() => onVoidOffset(offset)}
                    >
                      Void
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        />
      ) : (
        <EmptyCard>No offsets in this window.</EmptyCard>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-body text-ink-primary">Held deposit</p>
            <p className="text-caption text-ink-muted">
              {view.deposit === null ? "No deposit held" : "Still held, never income"}
            </p>
          </div>
          {view.deposit !== null ? <Money value={parse(view.deposit.heldMinor)} /> : null}
        </div>
        {view.deposit !== null && view.deposit.movements.length > 0 ? (
          <div className="flex flex-col divide-y divide-line-soft border-t border-line-soft">
            {view.deposit.movements.map((movement) => {
              const voided = movement.voidedAt !== null;
              return (
                <div key={movement.id} className="flex flex-col gap-2 py-3 first:pt-3 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p
                        className={
                          voided
                            ? "text-body text-ink-muted line-through"
                            : "text-body text-ink-primary"
                        }
                      >
                        {DEPOSIT_MOVEMENT_LABEL[movement.movementType]}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(movement.occurredOn)}
                        {movement.reason !== null ? <> · {movement.reason}</> : null}
                      </p>
                    </div>
                    <Money value={parse(movement.amountMinor)} />
                  </div>
                  {voided ? (
                    <p className="text-caption text-critical-ink">
                      Voided
                      {movement.voidedReason !== null ? <> · {movement.voidedReason}</> : null}
                    </p>
                  ) : onVoidDepositMovement !== undefined ? (
                    <button
                      type="button"
                      className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      aria-label={`Void deposit movement from ${formatShortDate(
                        movement.occurredOn,
                      )}`}
                      onClick={() => onVoidDepositMovement(movement)}
                    >
                      Void
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
