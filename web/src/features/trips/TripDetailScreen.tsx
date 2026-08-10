import { add, parse, ZERO, type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  ExpenseListRow,
  TripResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import {
  OBLIGATION_STATUS_LABEL,
  OPEN_OBLIGATION_STATUSES,
} from "../../lib/obligationStatusLabel.js";
import { ExpenseCostRow } from "../costs/ExpenseCostRow.js";
import { CollectPaymentSheet } from "../leases/CollectPaymentSheet.js";
import { CancelTripSheet } from "./CancelTripSheet.js";
import { CloseTripSheet } from "./CloseTripSheet.js";

export interface TripDetailScreenProps {
  tripId: string;
  today: BusinessDate;
  onBack: () => void;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * F-5.1→F-5.5, UI §7.5 — "the screen that serves two arrangements": one
 * screen, one mental model, for both a bus charter and a short car hire.
 * A container (UC §6.6), opened once and revisited over the trip's own
 * life, not a wizard — unlike `BookTripScreen`, nothing here is a step.
 *
 * **Received (GAP-57)** shows the real `trip_fare` obligation A6 raises —
 * `null` only for a charter with no customer or a zero agreed amount
 * (nothing was ever raised) or a cancelled trip (A6 voids it on cancel).
 * Tappable to collect, via the same `CollectPaymentSheet` a lease's dues
 * use — party-level (§6.5), never a trip-specific write.
 *
 * **Advance to him** stays `NotAvailable`: `GET /api/advance` doesn't exist
 * yet (Web-P8b's own gap, the plan already named it before this screen
 * needed it).
 *
 * A closed trip's own profit/costs/distance breakdown is likewise not
 * re-derived here — `POST /{id}/close`'s response is the only place that
 * computation is currently made, and it is not repeated on every later
 * `GET`. Recorded rather than guessed at: this screen shows what
 * `tripResponseSchema` actually carries for a closed trip (the closing
 * date) and nothing invented beyond it.
 */
export function TripDetailScreen({ tripId, today, onBack }: TripDetailScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);

  const tripQuery = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => api.get<TripResponse>(`/api/trip/${tripId}`),
  });
  const trip = tripQuery.data;

  const customerQuery = useQuery({
    queryKey: ["customer", trip?.customerId],
    queryFn: () => {
      if (trip?.customerId === null || trip?.customerId === undefined) {
        throw new Error("no customer on this trip");
      }
      return api.get<CustomerResponse>(`/api/customer/${trip.customerId}`);
    },
    enabled: trip?.customerId !== null && trip?.customerId !== undefined,
  });
  const driverQuery = useQuery({
    queryKey: ["driver", trip?.driverId],
    queryFn: () => {
      if (trip?.driverId === null || trip?.driverId === undefined) {
        throw new Error("no driver on this trip");
      }
      return api.get<DriverResponse>(`/api/driver/${trip.driverId}`);
    },
    enabled: trip?.driverId !== null && trip?.driverId !== undefined,
  });
  const expensesQuery = useQuery({
    queryKey: ["trip", tripId, "expense"],
    queryFn: () => api.get<ExpenseListRow[]>(`/api/trip/${tripId}/expense`),
  });
  const tripState = useQueryState(tripQuery);
  const expensesState = useQueryState(expensesQuery);

  const expenses = expensesQuery.data ?? [];
  const costsSoFar = expenses
    .filter((row) => row.voidedAt === null)
    .reduce((sum, row) => add(sum, parse(row.amountMinor)), ZERO);

  const canAct = trip?.status === "booked";

  // GAP-57: `null` for a charter with no customer, a zero agreed amount, or
  // a cancelled trip (A6 voids the obligation on cancel). Actionable while
  // genuinely outstanding — the same rule a lease's own dues use.
  const receivable = trip?.receivable ?? null;
  const receivableActionable =
    receivable !== null && OPEN_OBLIGATION_STATUSES.has(receivable.status);
  const receivableRow =
    receivable !== null ? (
      <div className="flex items-center justify-between gap-4">
        <span className="text-caption text-ink-muted">
          {OBLIGATION_STATUS_LABEL[receivable.status] ?? receivable.status}
        </span>
        {/* GAP-75: the amount owed, not what's been collected so far —
            `settledMinor` is 0 for every pending receivable by definition,
            which read as "nothing due" regardless of the real figure.
            `LeaseHubScreen.tsx`'s identical `leaseObligationRowSchema` row
            renders `amountMinor` for the same reason; mirrored here. */}
        <Money value={parse(receivable.amountMinor)} />
      </div>
    ) : (
      <Money value={ZERO} />
    );

  return (
    <Screen
      title={
        trip !== undefined
          ? `${formatShortDate(trip.startDate)} – ${formatShortDate(trip.endDate)}`
          : "Trip"
      }
      onBack={onBack}
      {...(canAct
        ? { action: { label: "Cancel trip", icon: Ban, onClick: () => setCancelOpen(true) } }
        : {})}
      {...(canAct
        ? { primaryAction: { label: "Close trip", onClick: () => setCloseOpen(true) } }
        : {})}
    >
      {tripState.kind === "error" ? (
        <QueryStateFailure error={tripState.error} retry={tripState.retry} of="this trip" />
      ) : trip === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-muted">
              {trip.destination ?? "No destination recorded"}
              {customerQuery.data !== undefined ? ` · ${customerQuery.data.name}` : ""}
            </p>
            <div className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">Agreed</p>
              <Money value={parse(trip.agreedAmountMinor)} />
            </div>
            {trip.customerId !== null ? (
              <div className="flex flex-col gap-1">
                <p className="text-body text-ink-primary">Received</p>
                {receivableActionable ? (
                  <button
                    type="button"
                    onClick={() => setCollectOpen(true)}
                    className="w-full text-left"
                  >
                    {receivableRow}
                  </button>
                ) : (
                  receivableRow
                )}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">Costs so far</p>
              <Money value={costsSoFar} />
            </div>
            {trip.driverId !== null ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-body text-ink-primary">Driver</p>
                <p className="text-body text-ink-secondary">
                  {driverQuery.data?.name ?? "—"} · fee <Money value={parse(trip.driverFeeMinor)} />
                </p>
              </div>
            ) : null}
            {trip.driverId !== null ? (
              <div className="flex flex-col gap-1">
                <p className="text-body text-ink-primary">Advance to him</p>
                <NotAvailable reason="advances aren't shown here yet" />
              </div>
            ) : null}
            {trip.status === "closed" ? (
              <p className="text-caption text-ink-muted">
                Closed{trip.closingDate !== null ? ` ${formatShortDate(trip.closingDate)}` : ""} —
                its full profit/costs/distance breakdown was shown at the moment of closing and
                isn't re-derived here yet.
              </p>
            ) : null}
            {trip.status === "cancelled" ? (
              <p className="text-caption text-ink-muted">
                Cancelled{trip.cancelReason !== null ? `: ${trip.cancelReason}` : ""}
                {trip.advanceDisposition !== null ? ` · advance ${trip.advanceDisposition}` : ""}
              </p>
            ) : null}
          </Card>

          {expensesState.kind === "error" ? (
            <QueryStateFailure
              error={expensesState.error}
              retry={expensesState.retry}
              of="this trip's costs"
            />
          ) : null}
          {expenses.length > 0 ? (
            <Section
              title="Costs"
              count={expenses.length}
              items={expenses.map((expense) => (
                <ExpenseCostRow
                  key={expense.id}
                  expense={expense}
                  formattedDate={formatShortDate(expense.spentOn)}
                  invalidateKeys={[["trip", tripId, "expense"]]}
                />
              ))}
            />
          ) : null}

          <CloseTripSheet
            open={closeOpen}
            onOpenChange={setCloseOpen}
            tripId={tripId}
            today={today}
            onClosed={() => setCloseOpen(false)}
          />
          <CancelTripSheet
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            tripId={tripId}
            onCancelled={() => setCancelOpen(false)}
          />
          {trip.customerId !== null && customerQuery.data !== undefined ? (
            <CollectPaymentSheet
              open={collectOpen}
              onOpenChange={setCollectOpen}
              customerId={trip.customerId}
              customerName={customerQuery.data.name}
              dues={receivable !== null ? [receivable] : []}
              today={today}
              onCollected={() => void queryClient.invalidateQueries({ queryKey: ["trip", tripId] })}
            />
          ) : null}
        </div>
      )}
    </Screen>
  );
}
