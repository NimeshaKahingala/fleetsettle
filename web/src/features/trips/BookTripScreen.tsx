import {
  addDays,
  inclusiveDays,
  toWire,
  type BusinessDate,
  type Minor,
  type VehicleDoubleBookedDetails,
} from "@fleetsettle/shared";
import type {
  bookTripRequestSchema,
  CustomerResponse,
  DriverResponse,
  PaperworkWarningRow,
  TripResponse,
  VehicleCalendarDay,
  VehicleDailyLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";
import { AlertStrip } from "../../components/AlertStrip.js";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Dialog, DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { PAPERWORK_DOC_TYPE_LABEL } from "../../lib/paperworkDocTypeLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateCustomerForm } from "../people/CreateCustomerForm.js";
import { CreateDriverForm } from "../people/CreateDriverForm.js";

const SOURCE_TYPE_LABEL: Record<VehicleDoubleBookedDetails["conflict"]["sourceType"], string> = {
  lease: "a monthly lease",
  daily_lease: "a daily lease",
  trip: "a trip",
};

/** The 180-day lookahead genuinely crosses year boundaries, so unlike some short-date helpers elsewhere this one always includes the year — a bare "12 Feb" on a booking decision is the wrong kind of ambiguous. */
function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** GAP-44/INV-1: turns the enriched conflict into the one sentence the Dialog states — "CAB-1234 is on a trip from 12 Aug 2026 to 18 Aug 2026 — Kandy, for R. Perera." shaped, but built from whichever fields this conflict actually carries. */
function conflictSentence(
  vehicleLabel: string,
  conflict: VehicleDoubleBookedDetails["conflict"],
): string {
  const range =
    conflict.to !== null
      ? `${formatShortDate(conflict.from)} to ${formatShortDate(conflict.to)}`
      : `${formatShortDate(conflict.from)} onward`;
  const destination = conflict.destination !== null ? ` — ${conflict.destination}` : "";
  return `${vehicleLabel} is on ${SOURCE_TYPE_LABEL[conflict.sourceType]} from ${range}${destination}, for ${conflict.holderLabel}.`;
}

/** `BookTripRequest` (the schema's output type) is post-transform — `Minor`/`BusinessDate`. `z.input` is the wire shape this call actually sends, the same fix every domain-typed form in this codebase already applies. */
type BookTripWireRequest = z.input<typeof bookTripRequestSchema>;

export interface BookTripScreenProps {
  vehicleId: string;
  today: BusinessDate;
  /** F-1.5's own Accept, the F-5.1 half (Web-P7) — the calendar's tap-through for a B/C vehicle's free day, read from the route's own search param, the same pattern Web-P6c already established for F-2.1. */
  initialStartDate?: BusinessDate;
  onBack: () => void;
  onBooked: (tripId: string) => void;
}

const STEP_LABELS = ["Trip", "Driver", "Confirm"];

/**
 * F-5.1/UC-20, UI §7.5 — "a short car hire is a trip. One screen, one
 * mental model." Level 1 is just the vehicle (pre-filled by the route) and
 * dates (defaulted to a single day) — customer, destination, agreed
 * amount, driver and driver trip fee are all real fields on this form but
 * every one of them is skippable (U-2), mirroring `StartLeaseScreen`'s own
 * multi-step shape rather than inventing a second one.
 *
 * F-5.1 step 4/ST-5 (GAP-7): the confirm step's own sticky action is
 * "Book trip" — a real commitment, never the fallback — with "Hold instead"
 * as an ordinary in-content button beside it, the same one-sticky-CTA shape
 * `OpeningBalanceScreen` already uses for two real actions on one screen
 * (F5/GAP-110). A hold reserves the calendar's `T?` cell without pausing the
 * daily lease or raising a receivable — nothing here computes that; the
 * server decides what a hold does and does not do.
 */
export function BookTripScreen({
  vehicleId,
  today,
  initialStartDate,
  onBack,
  onBooked,
}: BookTripScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const customersQuery = useQuery({
    queryKey: ["customer"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
  });
  const driversQuery = useQuery({
    queryKey: ["driver"],
    queryFn: () => api.get<DriverResponse[]>("/api/driver"),
  });
  const paperworkWarningsQuery = useQuery({
    queryKey: ["home", "paperwork-warnings"],
    queryFn: () => api.get<PaperworkWarningRow[]>("/api/home/paperwork-warnings"),
  });

  // Step 0 — trip.
  const startDateInit = initialStartDate ?? today;
  const [startDate, setStartDate] = useState<BusinessDate>(startDateInit);
  const [endDate, setEndDate] = useState<BusinessDate>(startDateInit);
  const [endDateTouched, setEndDateTouched] = useState(false);
  const [customer, setCustomer] = useState<EntityOption | null>(null);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [agreedAmountMinor, setAgreedAmountMinor] = useState<Minor | null>(null);

  // Step 1 — driver.
  const [driver, setDriver] = useState<EntityOption | null>(null);
  const [addDriverOpen, setAddDriverOpen] = useState(false);
  const [driverFeeMinor, setDriverFeeMinor] = useState<Minor | null>(null);
  const [driverFeeTouched, setDriverFeeTouched] = useState(false);

  // Step 2 — confirm: what these dates cost (F-5.1 step 3), read from the
  // vehicle's own calendar rather than guessed — an arrangement-B day in
  // range is a daily-lease day this booking pauses (§7.5).
  const calendarQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "calendar", startDate, endDate],
    queryFn: () =>
      api.get<VehicleCalendarDay[]>(
        `/api/vehicle/${vehicleId}/calendar?from=${startDate}&to=${endDate}`,
      ),
    enabled: step === 2,
  });
  const dailyLeaseHistoryQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "daily-lease"],
    queryFn: () => api.get<VehicleDailyLeaseHistoryRow[]>(`/api/vehicle/${vehicleId}/daily-lease`),
    enabled: step === 2,
  });

  // GAP-101 (Mode 3): a failed read must not be indistinguishable from
  // "nothing to warn about" — `?? []` alone can't tell them apart, and this
  // screen has two such warnings: the paperwork strip and the paused-lease-
  // days strip, both specified above the primary action (UI §7.4/§7.5).
  const vehicleState = useQueryState(vehicleQuery);
  const customersState = useQueryState(customersQuery);
  const driversState = useQueryState(driversQuery);
  const paperworkState = useQueryState(paperworkWarningsQuery);
  const calendarState = useQueryState(calendarQuery);
  const dailyLeaseHistoryState = useQueryState(dailyLeaseHistoryQuery);

  const customerOptions: EntityOption[] = (customersQuery.data ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    ...(c.mobile !== null ? { sublabel: c.mobile } : {}),
  }));
  const driverOptions: EntityOption[] = (driversQuery.data ?? []).map((d) => ({
    id: d.id,
    label: d.name,
    ...(d.mobile !== null ? { sublabel: d.mobile } : {}),
  }));
  const vehicleWarning = (paperworkWarningsQuery.data ?? []).find(
    (row) => row.subjectType === "vehicle" && row.subjectId === vehicleId,
  );

  const pausedDaysCount = (calendarQuery.data ?? []).filter(
    (day) => day.arrangement === "B",
  ).length;
  const currentDailyLease = (dailyLeaseHistoryQuery.data ?? []).find(
    (row) => row.effectiveTo === null,
  );

  const mutation = useMutation({
    mutationFn: (asHold: boolean) =>
      api.post<TripResponse>("/api/trip", {
        vehicleId,
        startDate,
        endDate,
        ...(customer !== null ? { customerId: customer.id } : {}),
        ...(driver !== null ? { driverId: driver.id } : {}),
        ...(destination.trim() !== "" ? { destination: destination.trim() } : {}),
        ...(agreedAmountMinor !== null ? { agreedAmountMinor: toWire(agreedAmountMinor) } : {}),
        ...(driverFeeMinor !== null ? { driverFeeMinor: toWire(driverFeeMinor) } : {}),
        asHold,
      } satisfies BookTripWireRequest),
    onSuccess: (trip) => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ["trip"] });
      onBooked(trip.id);
    },
  });

  // GAP-44/INV-1: `VEHICLE_DOUBLE_BOOKED` gets the Dialog its own doc
  // comment reserves it for, instead of the bare `mutation.error.message`
  // line every other 409 still falls through to below. `details` is only
  // ever absent on the best-effort enrichment's own failure path
  // (domain/trip.ts's `buildDoubleBookedError`) — falls through to the
  // plain message rather than a dialog with nothing to say.
  const doubleBooked =
    mutation.error instanceof ApiError &&
    mutation.error.code === "VEHICLE_DOUBLE_BOOKED" &&
    mutation.error.details !== undefined
      ? (mutation.error.details as VehicleDoubleBookedDetails)
      : null;

  /** Shifts both dates by the same span so the trip keeps its own requested length, landing its new start on the date the server already confirmed is free. */
  function applySuggestedDate(nextFreeFrom: BusinessDate): void {
    const tripLengthDays = inclusiveDays(startDate, endDate);
    setStartDate(nextFreeFrom);
    setEndDate(addDays(nextFreeFrom, tripLengthDays - 1));
    mutation.reset();
  }

  function goBack(): void {
    if (step === 0) onBack();
    else setStep((s) => s - 1);
  }
  function goNext(): void {
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  // GAP-101: a failed vehicle read degrades to a retry surface rather than
  // silently falling back to the "Book a trip" title placeholder.
  if (vehicleState.kind === "error") {
    return (
      <Screen title="Book a trip" onBack={onBack}>
        <QueryStateFailure
          error={vehicleState.error}
          retry={vehicleState.retry}
          of="this vehicle"
        />
      </Screen>
    );
  }

  const primaryAction =
    step === STEP_LABELS.length - 1
      ? {
          label: "Book trip",
          onClick: () => mutation.mutate(false),
          disabled: mutation.isPending,
        }
      : { label: "Next", onClick: goNext };

  return (
    <Screen
      title={vehicleQuery.data?.registration ?? "Book a trip"}
      onBack={goBack}
      primaryAction={primaryAction}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-caption text-ink-muted">
            Step {step + 1} of {STEP_LABELS.length} · {STEP_LABELS[step]}
          </p>
          <div className="h-1 w-full rounded-full bg-line-hairline">
            <div
              className="h-1 rounded-full bg-brand"
              style={{ width: `${(((step + 1) / STEP_LABELS.length) * 100).toString()}%` }}
            />
          </div>
        </div>

        {step === 0 ? (
          <div className="flex flex-col gap-4">
            <DateField
              label="Start date"
              value={startDate}
              today={today}
              onChange={(value) => {
                setStartDate(value);
                if (!endDateTouched) setEndDate(value);
              }}
            />
            <DateField
              label="End date"
              value={endDate}
              today={today}
              onChange={(value) => {
                setEndDateTouched(true);
                setEndDate(value);
              }}
            />
            {customersState.kind === "error" ? (
              <QueryStateFailure
                error={customersState.error}
                retry={customersState.retry}
                of="the customer list"
              />
            ) : null}
            <EntityPicker
              label="Customer (optional)"
              options={customerOptions}
              value={customer}
              onChange={setCustomer}
              onAddNew={() => setAddCustomerOpen(true)}
              addNewLabel="Add a new customer"
            />
            <Field label="Destination" htmlFor="destination" optional>
              <Input
                id="destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
            </Field>
            <MoneyField
              label="Agreed amount"
              valueMinor={agreedAmountMinor}
              onChange={setAgreedAmountMinor}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            {driversState.kind === "error" ? (
              <QueryStateFailure
                error={driversState.error}
                retry={driversState.retry}
                of="the driver list"
              />
            ) : null}
            <EntityPicker
              label="Driver (optional)"
              options={driverOptions}
              value={driver}
              onChange={(option) => {
                setDriver(option);
                if (!driverFeeTouched) {
                  const row = (driversQuery.data ?? []).find((d) => d.id === option.id);
                  setDriverFeeMinor(
                    row?.driverTripFeeMinor !== null && row?.driverTripFeeMinor !== undefined
                      ? (BigInt(row.driverTripFeeMinor) as Minor)
                      : null,
                  );
                }
              }}
              onAddNew={() => setAddDriverOpen(true)}
              addNewLabel="Add a new driver"
            />
            <MoneyField
              label="Driver trip fee"
              valueMinor={driverFeeMinor}
              onChange={(value) => {
                setDriverFeeTouched(true);
                setDriverFeeMinor(value);
              }}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            {calendarState.kind === "error" || dailyLeaseHistoryState.kind === "error" ? (
              // GAP-101 (Mode 3): whether this trip pauses a daily lease is
              // exactly the kind of fact `?? []` used to erase on a failed
              // read — silently rendering as "nothing paused" instead of
              // "couldn't check".
              <AlertStrip severity="warning" icon={TriangleAlert}>
                Couldn't check whether this pauses a daily lease.
              </AlertStrip>
            ) : pausedDaysCount > 0 ? (
              <AlertStrip severity="warning" icon={TriangleAlert}>
                This pauses {pausedDaysCount} day{pausedDaysCount === 1 ? "" : "s"} of the daily
                lease
                {currentDailyLease !== undefined ? (
                  <>
                    {" "}
                    — its expected income (
                    <Money
                      value={
                        (BigInt(currentDailyLease.dailyLeaseAmountMinor) *
                          BigInt(pausedDaysCount)) as Minor
                      }
                    />
                    ) disappears
                  </>
                ) : null}
                .
              </AlertStrip>
            ) : null}
            {paperworkState.kind === "error" ? (
              <AlertStrip severity="warning" icon={TriangleAlert}>
                Couldn't check this vehicle's paperwork.
              </AlertStrip>
            ) : vehicleWarning !== undefined ? (
              <AlertStrip
                severity={vehicleWarning.isExpired ? "critical" : "warning"}
                icon={TriangleAlert}
              >
                {PAPERWORK_DOC_TYPE_LABEL[vehicleWarning.docType]}{" "}
                {vehicleWarning.isExpired ? "expired" : "expires"} {vehicleWarning.expiryDate}
              </AlertStrip>
            ) : null}
            <p className="text-body text-ink-secondary">
              {startDate === endDate ? startDate : `${startDate} – ${endDate}`}
              {customer !== null ? ` · ${customer.label}` : ""}
              {destination.trim() !== "" ? ` · ${destination.trim()}` : ""}
            </p>
            {mutation.isError && doubleBooked === null ? (
              <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => mutation.mutate(true)}
              disabled={mutation.isPending}
            >
              Hold instead
            </Button>
          </div>
        ) : null}

        <Sheet open={addCustomerOpen} onOpenChange={setAddCustomerOpen} title="Add a new customer">
          <CreateCustomerForm
            onCreated={(created) => {
              setCustomer({ id: created.id, label: created.name });
              setAddCustomerOpen(false);
            }}
          />
        </Sheet>
        <Sheet open={addDriverOpen} onOpenChange={setAddDriverOpen} title="Add a new driver">
          <CreateDriverForm
            onCreated={(created) => {
              setDriver({ id: created.id, label: created.name });
              if (!driverFeeTouched) {
                setDriverFeeMinor(
                  created.driverTripFeeMinor !== null
                    ? (BigInt(created.driverTripFeeMinor) as Minor)
                    : null,
                );
              }
              setAddDriverOpen(false);
            }}
          />
        </Sheet>

        <Dialog
          open={doubleBooked !== null}
          onOpenChange={() => mutation.reset()}
          title="Vehicle is already booked"
          {...(doubleBooked !== null
            ? {
                description: conflictSentence(
                  vehicleQuery.data?.registration ?? "This vehicle",
                  doubleBooked.conflict,
                ),
              }
            : {})}
          footer={
            doubleBooked?.nextFreeFrom !== null && doubleBooked?.nextFreeFrom !== undefined ? (
              <DialogConfirmFooter
                confirmLabel={`Use ${formatShortDate(doubleBooked.nextFreeFrom)}`}
                onConfirm={() => applySuggestedDate(doubleBooked.nextFreeFrom as BusinessDate)}
                onCancel={() => mutation.reset()}
              />
            ) : (
              <Button size="cta" onClick={() => mutation.reset()}>
                OK
              </Button>
            )
          }
        />
      </div>
    </Screen>
  );
}
