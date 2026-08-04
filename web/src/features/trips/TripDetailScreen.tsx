import { add, parse, ZERO, type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  ExpenseListRow,
  TripResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { CancelTripSheet } from "./CancelTripSheet.js";
import { CloseTripSheet } from "./CloseTripSheet.js";

export interface TripDetailScreenProps {
  tripId: string;
  today: BusinessDate;
  onBack: () => void;
}

const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  fuel: "Fuel",
  tolls: "Tolls",
  fines: "Fines",
  cleaning: "Cleaning",
  tyres: "Tyres",
  servicing: "Servicing",
  repairs: "Repairs",
  insurance: "Insurance",
  licence: "Licence",
  crew_food: "Crew food",
  permits: "Permits",
  office: "Office",
  legal: "Legal",
  messaging: "Messaging",
  other: "Other",
};

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
 * **Two rows are `NotAvailable`, deliberately, not zero:**
 * - **Received** — F-5.3 describes collecting customer money against a
 *   trip, but no domain code anywhere raises a receivable `obligation` for
 *   a trip's own `agreedAmountMinor` the way a lease's billing period does
 *   for rent. Found while building this screen, not by P6's own tests
 *   (none of them exercise F-5.2/F-5.3 at all) — real, separate backend
 *   design work (deciding *when* it posts, matching W-41's own closing-
 *   date recognition), not guessed at here.
 * - **Advance to him** — `GET /api/advance` doesn't exist yet (Web-P8b's
 *   own gap, the plan already named it before this screen needed it).
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
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

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

  const expenses = expensesQuery.data ?? [];
  const costsSoFar = expenses
    .filter((row) => row.voidedAt === null)
    .reduce((sum, row) => add(sum, parse(row.amountMinor)), ZERO);

  const canAct = trip?.status === "booked";

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
      {trip === undefined ? (
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
            <div className="flex flex-col gap-1">
              <p className="text-body text-ink-primary">Received</p>
              <NotAvailable reason="no receivable is raised yet for a trip's agreed amount (F-5.3)" />
            </div>
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
                <NotAvailable reason="no advance list read exists yet (Web-P8b)" />
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

          {expenses.length > 0 ? (
            <Section
              title="Costs"
              count={expenses.length}
              items={expenses.map((expense) => (
                <Card key={expense.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-4">
                    <p
                      className={cn(
                        "text-body",
                        expense.voidedAt !== null
                          ? "text-ink-muted line-through"
                          : "text-ink-primary",
                      )}
                    >
                      {EXPENSE_CATEGORY_LABEL[expense.category] ?? expense.category}
                    </p>
                    <Money
                      value={parse(expense.amountMinor)}
                      className={expense.voidedAt !== null ? "line-through text-ink-muted" : ""}
                    />
                  </div>
                  <p className="text-caption text-ink-muted">
                    {formatShortDate(expense.spentOn)}
                    {expense.litres !== null ? ` · ${expense.litres.toString()}ℓ` : ""}
                    {expense.voidedReason !== null ? ` · Voided: ${expense.voidedReason}` : ""}
                  </p>
                </Card>
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
        </div>
      )}
    </Screen>
  );
}
