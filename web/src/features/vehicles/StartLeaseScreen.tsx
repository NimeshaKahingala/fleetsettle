import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  startLeaseRequestSchema,
  CustomerResponse,
  MileagePackageResponse,
  OdometerSource,
  PaperworkWarningRow,
  StartLeaseResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { EntityPicker, type EntityOption } from "../../components/EntityPicker.js";
import { MoneyField } from "../../components/MoneyField.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { AlertStrip } from "../../components/AlertStrip.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { CreateCustomerForm } from "../people/CreateCustomerForm.js";
import { TriangleAlert } from "lucide-react";

/** `StartLeaseRequest` (the schema's output type) is post-transform — `Minor`/`BusinessDate`. `z.input` is the wire shape this call actually sends, the same fix `OffsetSheet`'s own doc comment records. */
type StartLeaseWireRequest = z.input<typeof startLeaseRequestSchema>;

export interface StartLeaseScreenProps {
  vehicleId: string;
  today: BusinessDate;
  /** F-1.5's own Accept: "tapping a free day opens F-2.1 with that date filled in" — the calendar's own tap-through (Web-P6c), read from the route's own search param. */
  initialStartDate?: BusinessDate;
  onBack: () => void;
  onCreated: (leaseId: string) => void;
}

const STEP_LABELS = ["Customer", "Money", "Term", "Mileage", "Reminders", "Condition", "Confirm"];

const ODOMETER_SOURCE_LABEL: Record<OdometerSource, string> = {
  photo: "Photo",
  in_person: "In person",
  reported: "Reported",
  at_return: "At return",
};

function dayOfMonth(date: BusinessDate): number {
  // eslint-disable-next-line no-restricted-syntax -- a day-of-month, not money
  return Number(date.slice(8, 10));
}

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected ? "border-brand bg-brand-wash text-brand-ink" : "border-line-strong text-ink-primary",
  );
}

/**
 * F-2.1/UC-10, UI §7.4 — "the longest form in the product." Six level-1
 * fields (customer · start date · monthly amount · due day · deposit ·
 * vehicle, pre-filled by the route) spread across the first three of
 * seven steps that otherwise mirror F-2.1's own step numbering exactly;
 * every step past level 1 is skippable — Next is never blocked by an
 * empty level-2 field (U-2's own automated-test rule). No shared
 * `Stepper` component exists yet and none is added here: this is the one
 * flow UI §7.4 itself singles out as needing more than the phase-1
 * inventory, not a second flow that would justify a reusable one.
 */
export function StartLeaseScreen({
  vehicleId,
  today,
  initialStartDate,
  onBack,
  onCreated,
}: StartLeaseScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const mileagePackagesQuery = useQuery({
    queryKey: ["mileage-package"],
    queryFn: () => api.get<MileagePackageResponse[]>("/api/mileage-package"),
  });
  const paperworkWarningsQuery = useQuery({
    queryKey: ["home", "paperwork-warnings"],
    queryFn: () => api.get<PaperworkWarningRow[]>("/api/home/paperwork-warnings"),
  });
  const customersQuery = useQuery({
    queryKey: ["customer"],
    queryFn: () => api.get<CustomerResponse[]>("/api/customer"),
  });
  // GAP-101: `vehicleQuery`'s state gates the arrangement check just below
  // — a failed read must not silently let that check pass by never
  // running. `paperworkWarningsQuery`'s state guards the same warning UI
  // §7.4 puts above the primary action at step 6 — `?? []` used to make a
  // failed paperwork read indistinguishable from "nothing to warn about".
  const vehicleState = useQueryState(vehicleQuery);
  const paperworkState = useQueryState(paperworkWarningsQuery);
  const customersState = useQueryState(customersQuery);
  const mileagePackagesState = useQueryState(mileagePackagesQuery);

  // Step 0 — customer
  const [customer, setCustomer] = useState<EntityOption | null>(null);
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);

  // Step 1 — money
  const [rentAmountMinor, setRentAmountMinor] = useState<Minor | null>(null);
  const startDateInit = initialStartDate ?? today;
  const [billingDay, setBillingDay] = useState(dayOfMonth(startDateInit));
  const [billingDayTouched, setBillingDayTouched] = useState(false);
  const [depositAmountMinor, setDepositAmountMinor] = useState<Minor | null>(null);

  // Step 2 — term
  const [startDate, setStartDate] = useState<BusinessDate>(startDateInit);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState<BusinessDate>(today);

  // Step 3 — mileage
  const [mileageChoice, setMileageChoice] = useState<string>("none");
  const [customLimitKm, setCustomLimitKm] = useState("");
  const [customRateMinor, setCustomRateMinor] = useState<Minor | null>(null);
  const [odometerReadingKm, setOdometerReadingKm] = useState("");
  const [odometerSource, setOdometerSource] = useState<OdometerSource | null>(null);

  // Step 4 — reminders
  const [reminderDaysBefore, setReminderDaysBefore] = useState("3");

  const activePackages = (mileagePackagesQuery.data ?? []).filter((p) => p.archivedAt === null);
  const selectedPackage = activePackages.find((p) => p.id === mileageChoice) ?? null;
  const hasMileageLimit = mileageChoice !== "none";
  const effectiveLimitKm =
    mileageChoice === "custom"
      ? Number.parseInt(customLimitKm, 10)
      : (selectedPackage?.dailyLimitKm ?? null);
  const effectiveRateMinor: Minor | null =
    mileageChoice === "custom"
      ? customRateMinor
      : selectedPackage !== null
        ? (BigInt(selectedPackage.excessRateMinorPerKm) as Minor)
        : null;
  const customerOptions: EntityOption[] = (customersQuery.data ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    ...(c.mobile !== null ? { sublabel: c.mobile } : {}),
  }));
  const vehicleWarning = (paperworkWarningsQuery.data ?? []).find(
    (row) => row.subjectType === "vehicle" && row.subjectId === vehicleId,
  );

  const canConfirm = customer !== null && rentAmountMinor !== null;

  const mutation = useMutation({
    mutationFn: () => {
      if (customer === null || rentAmountMinor === null) {
        throw new Error("customer and monthly amount are required");
      }
      const reminderDays = Number.parseInt(reminderDaysBefore, 10);
      const odometerKm = Number.parseInt(odometerReadingKm, 10);
      return api.post<StartLeaseResponse>("/api/lease", {
        vehicleId,
        customerId: customer.id,
        startDate,
        ...(hasEndDate ? { endDate } : {}),
        billingDay,
        rentAmountMinor: toWire(rentAmountMinor),
        ...(hasMileageLimit && effectiveLimitKm !== null && !Number.isNaN(effectiveLimitKm)
          ? { mileageDailyLimitKm: effectiveLimitKm }
          : {}),
        ...(hasMileageLimit && effectiveRateMinor !== null
          ? { mileageExcessRateMinor: toWire(effectiveRateMinor) }
          : {}),
        ...(hasMileageLimit && !Number.isNaN(odometerKm) ? { odometerReadingKm: odometerKm } : {}),
        ...(hasMileageLimit && odometerSource !== null ? { odometerSource } : {}),
        ...(!Number.isNaN(reminderDays) ? { reminderDaysBefore: reminderDays } : {}),
        ...(depositAmountMinor !== null ? { depositAmountMinor: toWire(depositAmountMinor) } : {}),
      } satisfies StartLeaseWireRequest);
    },
    onSuccess: (lease) => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      onCreated(lease.id);
    },
  });

  function goBack(): void {
    if (step === 0) onBack();
    else setStep((s) => s - 1);
  }
  function goNext(): void {
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  // GAP-101: a failed vehicle read must not silently skip the arrangement
  // check just below — that check is GAP-84/F1's whole "never the form"
  // fix, and a form that appears to have passed it because the read never
  // came back is worse than one that never checked at all.
  if (vehicleState.kind === "error") {
    return (
      <Screen title="Start a rental" onBack={onBack}>
        <QueryStateFailure
          error={vehicleState.error}
          retry={vehicleState.retry}
          of="this vehicle"
        />
      </Screen>
    );
  }

  // GAP-84/F1: a rental is arrangement A. The Worker refuses this on submit
  // regardless (a deep link bypasses this component entirely), but showing
  // the seven-step form for a vehicle that can never legally start one is
  // its own defect — this is the "never the form" half of the fix. Waits
  // for `vehicleQuery.data` rather than firing on the loading placeholder,
  // the same tolerance every other field below already has for it.
  if (vehicleQuery.data !== undefined && vehicleQuery.data.arrangement !== "A") {
    return (
      <Screen title={vehicleQuery.data.registration} onBack={onBack}>
        <p className="text-body text-ink-secondary">
          {vehicleQuery.data.arrangement === undefined
            ? "This vehicle has no current arrangement, so a rental can't be started on it yet."
            : `This vehicle is set up for arrangement ${vehicleQuery.data.arrangement}, not a monthly rental.`}
        </p>
      </Screen>
    );
  }

  // One action per step, in `Screen`'s own sticky slot (M-24) — there is no
  // separate "Back" button anywhere in this screen's own content; the
  // app-bar chevron (wired to `goBack` below, not the raw `onBack` prop) is
  // the only way back, consistent with every other screen in the app.
  // Splitting this into a two-button row per step was tried and reverted:
  // `Screen`'s own chevron already carries the accessible name "Back",
  // and a second, differently-behaved control with the same name is a
  // real confusion, not just a testing inconvenience.
  const primaryAction =
    step === 3
      ? {
          label: "Next",
          onClick: goNext,
          disabled: hasMileageLimit && (odometerReadingKm.trim() === "" || odometerSource === null),
        }
      : step === 6
        ? {
            label: "Start rental",
            onClick: () => mutation.mutate(),
            disabled: !canConfirm || mutation.isPending,
          }
        : {
            label: "Next",
            onClick: goNext,
            disabled:
              step === 0 ? customer === null : step === 1 ? rentAmountMinor === null : false,
          };

  return (
    <Screen
      title={vehicleQuery.data?.registration ?? "Start a rental"}
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
            {customersState.kind === "error" ? (
              <QueryStateFailure
                error={customersState.error}
                retry={customersState.retry}
                of="the customer list"
              />
            ) : null}
            <EntityPicker
              label="Customer"
              options={customerOptions}
              value={customer}
              onChange={setCustomer}
              onAddNew={() => setAddCustomerOpen(true)}
              addNewLabel="Add a new customer"
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            <MoneyField
              label="Monthly amount"
              valueMinor={rentAmountMinor}
              onChange={setRentAmountMinor}
            />
            <Field label="Due day of month" htmlFor="billing-day">
              <Input
                id="billing-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                value={billingDay}
                onChange={(e) => {
                  setBillingDayTouched(true);
                  const parsed = Number.parseInt(e.target.value, 10);
                  if (!Number.isNaN(parsed)) setBillingDay(parsed);
                }}
              />
            </Field>
            <MoneyField
              label="Deposit (optional)"
              valueMinor={depositAmountMinor}
              onChange={setDepositAmountMinor}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <DateField
              label="Start date"
              value={startDate}
              today={today}
              onChange={(value) => {
                setStartDate(value);
                if (!billingDayTouched) setBillingDay(dayOfMonth(value));
              }}
            />
            <div className="flex flex-col gap-2">
              <Label>Term</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={!hasEndDate}
                  onClick={() => setHasEndDate(false)}
                  className={cn(chipClass(!hasEndDate), "flex-1")}
                >
                  Open-ended
                </button>
                <button
                  type="button"
                  aria-pressed={hasEndDate}
                  onClick={() => setHasEndDate(true)}
                  className={cn(chipClass(hasEndDate), "flex-1")}
                >
                  Fixed term
                </button>
              </div>
            </div>
            {hasEndDate ? (
              <DateField label="End date" value={endDate} today={today} onChange={setEndDate} />
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            {mileagePackagesState.kind === "error" ? (
              <QueryStateFailure
                error={mileagePackagesState.error}
                retry={mileagePackagesState.retry}
                of="mileage packages"
              />
            ) : null}
            <div className="flex flex-col gap-2">
              <Label>Mileage package</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={mileageChoice === "none"}
                  onClick={() => setMileageChoice("none")}
                  className={chipClass(mileageChoice === "none")}
                >
                  Unlimited
                </button>
                {activePackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    type="button"
                    aria-pressed={mileageChoice === pkg.id}
                    onClick={() => setMileageChoice(pkg.id)}
                    className={chipClass(mileageChoice === pkg.id)}
                  >
                    {pkg.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={mileageChoice === "custom"}
                  onClick={() => setMileageChoice("custom")}
                  className={chipClass(mileageChoice === "custom")}
                >
                  Custom
                </button>
              </div>
              <p className="text-caption text-ink-muted">
                Leaving this as Unlimited means no odometer prompt anywhere in this rental.
              </p>
            </div>

            {mileageChoice === "custom" ? (
              <>
                <Field label="Daily km limit" htmlFor="custom-limit-km">
                  <Input
                    id="custom-limit-km"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={customLimitKm}
                    onChange={(e) => setCustomLimitKm(e.target.value)}
                  />
                </Field>
                <MoneyField
                  label="Excess fee per km"
                  valueMinor={customRateMinor}
                  onChange={setCustomRateMinor}
                />
              </>
            ) : null}

            {hasMileageLimit ? (
              <>
                <Field label="Odometer at handover (km)" htmlFor="odometer-km">
                  <Input
                    id="odometer-km"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={odometerReadingKm}
                    onChange={(e) => setOdometerReadingKm(e.target.value)}
                  />
                </Field>
                <div className="flex flex-col gap-2">
                  <Label>Reading source</Label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(ODOMETER_SOURCE_LABEL) as OdometerSource[]).map((source) => (
                      <button
                        key={source}
                        type="button"
                        aria-pressed={odometerSource === source}
                        onClick={() => setOdometerSource(source)}
                        className={chipClass(odometerSource === source)}
                      >
                        {ODOMETER_SOURCE_LABEL[source]}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <Field label="Reminder — days before due" htmlFor="reminder-days">
              <Input
                id="reminder-days"
                type="number"
                inputMode="numeric"
                min={0}
                value={reminderDaysBefore}
                onChange={(e) => setReminderDaysBefore(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="flex flex-col gap-4">
            <NotAvailable reason="condition photos aren't supported yet" />
          </div>
        ) : null}

        {step === 6 ? (
          <div className="flex flex-col gap-4">
            {paperworkState.kind === "error" ? (
              // GAP-101 (Mode 3): a failed paperwork read is not the same
              // fact as "nothing to warn about" — UI §7.4 puts this strip
              // above the primary action specifically so it can't be
              // missed, and letting the read fail silently would remove it
              // instead of warning about it.
              <AlertStrip severity="warning" icon={TriangleAlert}>
                Couldn't check this vehicle's paperwork.
              </AlertStrip>
            ) : vehicleWarning !== undefined ? (
              <AlertStrip
                severity={vehicleWarning.isExpired ? "critical" : "warning"}
                icon={TriangleAlert}
              >
                {vehicleWarning.docType === "revenue_licence"
                  ? "Revenue licence"
                  : vehicleWarning.docType}{" "}
                {vehicleWarning.isExpired ? "expired" : "expires"} {vehicleWarning.expiryDate}
              </AlertStrip>
            ) : null}
            <p className="text-body text-ink-secondary">
              Ready to start this rental for {customer?.label ?? "—"} from {startDate}.
            </p>
            {mutation.isError ? (
              <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
            ) : null}
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
      </div>
    </Screen>
  );
}
