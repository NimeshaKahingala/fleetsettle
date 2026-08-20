import { add, parse, ZERO, type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  ExpenseListRow,
  TripResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
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
import { PostClosureChargeSheet } from "../leases/PostClosureChargeSheet.js";
import { AdvanceSheet } from "../people/AdvanceSheet.js";
import { CancelTripSheet } from "./CancelTripSheet.js";
import { CloseTripSheet } from "./CloseTripSheet.js";

export interface TripDetailScreenProps {
  tripId: string;
  today: BusinessDate;
  onBack: () => void;
}

function formatShortDate(date: string, options: { year?: boolean } = {}): string {
  const { year = true } = options;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(year ? { year: "numeric" as const } : {}),
  }).format(new Date(`${date}T00:00:00`));
}

const TRIP_STATUS_LABEL: Record<string, string> = {
  hold: "Hold",
  booked: "Booked",
  in_progress: "In progress",
  closed: "Closed",
  cancelled: "Cancelled",
};

function tripStatusVariant(status: string): "brand" | "good" | "warning" | "critical" | "neutral" {
  if (status === "closed") return "good";
  if (status === "cancelled") return "critical";
  if (status === "hold") return "warning";
  if (status === "in_progress") return "brand";
  return "neutral";
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
 * **Advance to him** can be recorded for a booked trip with a driver. Existing
 * trip advances still are not listed here because there is no trip-scoped
 * advance read; settlement happens from the driver's history, where the
 * composed read already exists.
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
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [postClosureChargeOpen, setPostClosureChargeOpen] = useState(false);

  const tripQuery = useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => api.get<TripResponse>(`/api/trip/${tripId}`),
  });
  const trip = tripQuery.data;

  // allow: a badge name plus a fail-closed gate on CollectPaymentSheet
  // (rendered only once customerQuery.data resolves) — a failure here
  // never offers a wrong customer, it just delays the action rendering.
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
  // allow: a name label only ("— · fee Rs X") — the fee figure itself
  // comes from `trip`, already loaded, never from this query.
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

  // ST-5/GAP-7: hold → booked → in_progress → closed, cancelled from any of
  // the first three. A hold can only be confirmed or cancelled — closing
  // and recording an advance both wait for it to become real.
  const canConfirm = trip?.status === "hold";
  const canClose = trip?.status === "booked" || trip?.status === "in_progress";
  const canCancel = canConfirm || canClose;
  const canRecordAdvance = canClose && trip?.driverId !== null && trip?.driverId !== undefined;
  const canRecordPostClosureCharge =
    trip?.status === "closed" && trip.customerId !== null && trip.customerId !== undefined;

  const confirmMutation = useMutation({
    mutationFn: () => api.post<TripResponse>(`/api/trip/${tripId}/confirm`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
    },
  });

  // GAP-45: the title used to show a full year on both halves of the date
  // range unconditionally, clipping mid-digit at 360px next to the cancel
  // icon. §8.3 asks for the year only where the date would otherwise be
  // ambiguous — a range crossing a year boundary, or one outside the
  // business's current year.
  const titleShowsYear =
    trip !== undefined &&
    (trip.startDate.slice(0, 4) !== trip.endDate.slice(0, 4) ||
      trip.startDate.slice(0, 4) !== today.slice(0, 4));

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
          ? `${formatShortDate(trip.startDate, { year: titleShowsYear })} – ${formatShortDate(trip.endDate, { year: titleShowsYear })}`
          : "Trip"
      }
      onBack={onBack}
      {...(canCancel
        ? { action: { label: "Cancel trip", icon: Ban, onClick: () => setCancelOpen(true) } }
        : {})}
      {...(canConfirm
        ? {
            primaryAction: {
              label: "Confirm",
              onClick: () => confirmMutation.mutate(),
              disabled: confirmMutation.isPending,
            },
          }
        : canClose
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
            <div className="flex flex-wrap gap-2">
              <Badge variant={tripStatusVariant(trip.status)}>
                {TRIP_STATUS_LABEL[trip.status] ?? trip.status}
              </Badge>
              <Badge variant="neutral">
                {formatShortDate(trip.startDate, { year: titleShowsYear })} –{" "}
                {formatShortDate(trip.endDate, { year: titleShowsYear })}
              </Badge>
              {trip.destination !== null ? (
                <Badge variant="neutral">{trip.destination}</Badge>
              ) : null}
              {customerQuery.data !== undefined ? (
                <Badge variant="neutral">{customerQuery.data.name}</Badge>
              ) : null}
            </div>
            {trip.destination === null ? (
              <p className="text-body-sm text-ink-muted">No destination recorded</p>
            ) : null}
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
                {canRecordAdvance ? (
                  <Button variant="outline" onClick={() => setAdvanceOpen(true)}>
                    Record advance
                  </Button>
                ) : (
                  <NotAvailable reason="shown on driver history" />
                )}
              </div>
            ) : null}
            {trip.status === "hold" ? (
              <p className="text-caption text-ink-muted">
                Hold — reserves the calendar, but nothing is owed and the daily lease keeps running
                until this is confirmed.
                {trip.holdExpiresOn !== null
                  ? ` Expires ${formatShortDate(trip.holdExpiresOn)} unless confirmed first.`
                  : ""}
              </p>
            ) : null}
            {confirmMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{confirmMutation.error.message}</p>
            ) : null}
            {trip.status === "closed" ? (
              <div className="flex flex-col gap-2">
                <p className="text-caption text-ink-muted">
                  Closed
                  {trip.closingDate !== null ? ` ${formatShortDate(trip.closingDate)}` : ""} — its
                  full profit/costs/distance breakdown was shown at the moment of closing and isn't
                  re-derived here yet.
                </p>
                {canRecordPostClosureCharge ? (
                  <Button variant="outline" onClick={() => setPostClosureChargeOpen(true)}>
                    Record late charge
                  </Button>
                ) : null}
              </div>
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
              onCollected={() => {
                void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
                // GAP-144 (19 Aug 2026 live QA pass, F-7): this was narrower
                // than the other two `CollectPaymentSheet` callers — missing
                // even `["payment"]`/`["home"]`, not just `["reports"]`, the
                // one every call site shares the same gap on. `["trip",
                // tripId]` above still needs its own explicit call: it isn't
                // a prefix of any of these three.
                void queryClient.invalidateQueries({ queryKey: ["payment"] });
                void queryClient.invalidateQueries({ queryKey: ["home"] });
                void queryClient.invalidateQueries({ queryKey: ["reports"] });
              }}
            />
          ) : null}
          {trip.driverId !== null ? (
            <AdvanceSheet
              open={advanceOpen}
              onOpenChange={setAdvanceOpen}
              driverId={trip.driverId}
              tripId={tripId}
              today={today}
              title="Record trip advance"
            />
          ) : null}
          {trip.customerId !== null ? (
            <PostClosureChargeSheet
              open={postClosureChargeOpen}
              onOpenChange={setPostClosureChargeOpen}
              source={{ type: "trip", id: tripId }}
              customerId={trip.customerId}
              vehicleId={trip.vehicleId}
              today={today}
            />
          ) : null}
        </div>
      )}
    </Screen>
  );
}
