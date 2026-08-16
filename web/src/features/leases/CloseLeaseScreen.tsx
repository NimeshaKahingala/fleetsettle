import { parse, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  ClosedLeaseFinalPeriodResponse,
  closeLeaseRequestSchema,
  CustomerResponse,
  LeaseClosureSummaryResponse,
  LeaseDepositResponse,
  LeaseResponse,
  OdometerSource,
  settleLeaseDepositRequestSchema,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { useLeaseQuery } from "./useLeaseQuery.js";

export interface CloseLeaseScreenProps {
  leaseId: string;
  today: BusinessDate;
  onBack: () => void;
  onClosed: (vehicleId: string) => void;
}

type CloseLeaseWireRequest = z.input<typeof closeLeaseRequestSchema>;
type SettleDepositWireRequest = z.input<typeof settleLeaseDepositRequestSchema>;

const STEP_LABELS = ["Stop & final period", "Closure summary", "Condition", "Deposit", "Close out"];

const ODOMETER_SOURCE_LABEL: Record<OdometerSource, string> = {
  photo: "Photo",
  in_person: "In person",
  reported: "Reported",
  at_return: "At return",
};

const DUE_KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  mileage_excess: "Mileage excess",
  post_closure_charge: "Late charge",
};

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected ? "border-brand bg-brand-wash text-brand-ink" : "border-line-strong text-ink-primary",
  );
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * F-2.6/UC-16, W-26/W-29/W-30 — "the order is the feature." One route
 * (`/leases/:id/close`), an in-screen stepper rather than seven routes
 * (§3.3 gives the lease exactly one route for all of F-2.1→F-2.8, and this
 * mirrors the calendar's own single-named-sub-route precedent). Steps 1–3
 * of UC-16's own numbering are ONE API call (`closeLeaseRequestSchema`
 * bundles "stop the clock," the final period's treatment and the closing
 * odometer together) — so this wizard's own step 0 is that one form.
 *
 * **Back stops working after step 0 succeeds.** Once the close call lands,
 * the lease is really `closing` — a fact posted to the ledger, not a
 * screen the manager is still drafting. A "step back" from step 2 to step
 * 0 would either resubmit a close that already happened or silently do
 * nothing, both worse than removing the affordance. Recorded here rather
 * than guessed at silently.
 */
export function CloseLeaseScreen({ leaseId, today, onBack, onClosed }: CloseLeaseScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [finalPeriod, setFinalPeriod] = useState<ClosedLeaseFinalPeriodResponse | null>(null);

  // allow: leaseQuery.data is never rendered, only feeds customerQuery's
  // queryKey/enabled below — a failure here just leaves customerQuery
  // disabled, which already degrades safely to the title fallback.
  const leaseQuery = useLeaseQuery(leaseId);
  // allow: title fallback only ("Close the lease"); the flow's real content
  // (unpaid dues, deposit) is summaryQuery/depositQuery, both wrapped below.
  const customerQuery = useQuery({
    queryKey: ["customer", leaseQuery.data?.customerId],
    queryFn: () => {
      const customerId = leaseQuery.data?.customerId;
      if (customerId === undefined) throw new Error("lease not loaded yet");
      return api.get<CustomerResponse>(`/api/customer/${customerId}`);
    },
    enabled: leaseQuery.data !== undefined,
  });
  const summaryQuery = useQuery({
    queryKey: ["lease", leaseId, "closure-summary"],
    queryFn: () => api.get<LeaseClosureSummaryResponse>(`/api/lease/${leaseId}/closure-summary`),
    enabled: step >= 1,
  });
  const depositQuery = useQuery({
    queryKey: ["lease", leaseId, "deposit"],
    queryFn: () => api.get<LeaseDepositResponse | null>(`/api/lease/${leaseId}/deposit`),
    enabled: step >= 1,
  });

  // Step 0 — stop the clock / final period / mileage.
  const [closingDate, setClosingDate] = useState<BusinessDate>(today);
  const [finalPeriodMode, setFinalPeriodMode] = useState<"full" | "days_used" | "agreed">(
    "days_used",
  );
  const [agreedAmountMinor, setAgreedAmountMinor] = useState<Minor | null>(null);
  const [note, setNote] = useState("");
  const [hasClosingReading, setHasClosingReading] = useState(false);
  const [closingOdometerKm, setClosingOdometerKm] = useState("");
  const [odometerSource, setOdometerSource] = useState<OdometerSource | null>(null);

  // Step 3 — settle the deposit.
  const [depositAction, setDepositAction] = useState<"refund" | "retain" | "hold">("refund");
  const [retainAmountMinor, setRetainAmountMinor] = useState<Minor | null>(null);
  const [depositReason, setDepositReason] = useState("");
  const [depositOccurredOn, setDepositOccurredOn] = useState<BusinessDate>(today);

  const closeMutation = useMutation({
    mutationFn: () => {
      const km = Number.parseInt(closingOdometerKm, 10);
      return api.post<{ finalPeriod: ClosedLeaseFinalPeriodResponse }>(
        `/api/lease/${leaseId}/close`,
        {
          closingDate,
          finalPeriodMode,
          ...(finalPeriodMode === "agreed" && agreedAmountMinor !== null
            ? { agreedAmountMinor: toWire(agreedAmountMinor) }
            : {}),
          ...(note.trim() !== "" ? { note: note.trim() } : {}),
          ...(hasClosingReading && !Number.isNaN(km) && odometerSource !== null
            ? { closingOdometerKm: km, odometerSource }
            : {}),
        } satisfies CloseLeaseWireRequest,
      );
    },
    onSuccess: (result) => {
      setFinalPeriod(result.finalPeriod);
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId] });
      setStep(1);
    },
  });

  const settleDepositMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/lease/${leaseId}/settle-deposit`, {
        action: depositAction,
        ...(depositAction === "retain" && retainAmountMinor !== null
          ? { amountMinor: toWire(retainAmountMinor) }
          : {}),
        ...(depositReason.trim() !== "" ? { reason: depositReason.trim() } : {}),
        occurredOn: depositOccurredOn,
      } satisfies SettleDepositWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "deposit"] });
      setStep(4);
    },
  });

  const closeOutMutation = useMutation({
    mutationFn: () => api.post<LeaseResponse>(`/api/lease/${leaseId}/close-out`, {}),
    onSuccess: (lease) => onClosed(lease.vehicleId),
  });

  const summaryState = useQueryState(summaryQuery);
  const depositState = useQueryState(depositQuery);

  const deposit = depositQuery.data ?? null;
  const hasDeposit = deposit !== null;

  const primaryAction =
    step === 0
      ? {
          label: "Stop the clock",
          onClick: () => closeMutation.mutate(),
          disabled:
            closeMutation.isPending ||
            (finalPeriodMode === "agreed" && agreedAmountMinor === null) ||
            (hasClosingReading && (closingOdometerKm.trim() === "" || odometerSource === null)),
        }
      : step === 1
        ? { label: "Next", onClick: () => setStep(2) }
        : step === 2
          ? { label: "Next", onClick: () => setStep(3) }
          : step === 3
            ? // GAP-101: a failed deposit read must not silently fall through
              // to "no deposit, Next" — that would skip settling a real
              // deposit this screen simply couldn't confirm.
              depositState.kind === "error"
              ? { label: "Try again", onClick: depositState.retry }
              : hasDeposit
                ? {
                    label: "Settle deposit",
                    onClick: () => settleDepositMutation.mutate(),
                    disabled:
                      settleDepositMutation.isPending ||
                      (depositAction === "retain" && retainAmountMinor === null),
                  }
                : { label: "Next", onClick: () => setStep(4) }
            : {
                label: "Close out",
                onClick: () => closeOutMutation.mutate(),
                disabled: closeOutMutation.isPending,
              };

  return (
    <Screen
      title={customerQuery.data?.name ?? "Close the lease"}
      {...(step === 0 ? { onBack } : {})}
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
              label="Closing date"
              value={closingDate}
              today={today}
              onChange={setClosingDate}
            />
            <div className="flex flex-col gap-2">
              <Label>This final period</Label>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-pressed={finalPeriodMode === "full"}
                  onClick={() => setFinalPeriodMode("full")}
                  className={chipClass(finalPeriodMode === "full")}
                >
                  Charge the full period
                </button>
                <button
                  type="button"
                  aria-pressed={finalPeriodMode === "days_used"}
                  onClick={() => setFinalPeriodMode("days_used")}
                  className={chipClass(finalPeriodMode === "days_used")}
                >
                  Charge the days used
                </button>
                <button
                  type="button"
                  aria-pressed={finalPeriodMode === "agreed"}
                  onClick={() => setFinalPeriodMode("agreed")}
                  className={chipClass(finalPeriodMode === "agreed")}
                >
                  An agreed figure
                </button>
              </div>
            </div>
            {finalPeriodMode === "agreed" ? (
              <MoneyField
                label="Agreed amount"
                valueMinor={agreedAmountMinor}
                onChange={setAgreedAmountMinor}
              />
            ) : null}
            <NoteField label="Note (optional)" value={note} onChange={setNote} />

            <div className="flex flex-col gap-2">
              <label className="flex min-h-tap items-center gap-2">
                <input
                  type="checkbox"
                  checked={hasClosingReading}
                  onChange={(e) => setHasClosingReading(e.target.checked)}
                />
                <span className="text-body text-ink-primary">Read the closing odometer now</span>
              </label>
              {hasClosingReading ? (
                <>
                  <Field label="Closing odometer (km)" htmlFor="closing-odometer">
                    <Input
                      id="closing-odometer"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={closingOdometerKm}
                      onChange={(e) => setClosingOdometerKm(e.target.value)}
                    />
                  </Field>
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
                </>
              ) : null}
            </div>
            {closeMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{closeMutation.error.message}</p>
            ) : null}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="flex flex-col gap-4">
            {finalPeriod !== null ? (
              <Card className="flex items-center justify-between gap-4">
                <p className="text-body text-ink-primary">This final period</p>
                <Money value={parse(finalPeriod.amountMinor)} />
              </Card>
            ) : null}
            {summaryQuery.data !== undefined ? (
              <>
                <Card className="flex items-center justify-between gap-4">
                  <p className="text-body text-ink-primary">Total unpaid</p>
                  <Money value={parse(summaryQuery.data.totalUnpaidMinor)} />
                </Card>
                {summaryQuery.data.unpaidObligations.length > 0 ? (
                  <Section
                    title="Unpaid dues"
                    count={summaryQuery.data.unpaidObligations.length}
                    items={summaryQuery.data.unpaidObligations.map((row) => (
                      <Card key={row.id} className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-body text-ink-primary">
                            {DUE_KIND_LABEL[row.kind] ?? row.kind}
                          </p>
                          <p className="text-caption text-ink-muted">
                            {formatShortDate(row.dueOn)}
                          </p>
                        </div>
                        <Money value={parse(row.amountMinor)} />
                      </Card>
                    ))}
                  />
                ) : null}
                {summaryQuery.data.openIncidents.length > 0 ? (
                  <Section
                    title="Open incidents"
                    count={summaryQuery.data.openIncidents.length}
                    items={summaryQuery.data.openIncidents.map((incident) => (
                      <Card key={incident.id} className="flex items-center justify-between gap-4">
                        <p className="text-body text-ink-primary">
                          {formatShortDate(incident.occurredOn)}
                        </p>
                        <p className="text-caption text-ink-muted">{incident.status}</p>
                      </Card>
                    ))}
                  />
                ) : null}
              </>
            ) : summaryState.kind === "error" ? (
              <QueryStateFailure
                error={summaryState.error}
                retry={summaryState.retry}
                of="the closure summary"
              />
            ) : (
              <p className="text-body-sm text-ink-muted">Loading…</p>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="flex flex-col gap-4">
            <NotAvailable reason="return condition photos aren't supported yet" />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="flex flex-col gap-4">
            {depositState.kind === "error" ? (
              <QueryStateFailure
                error={depositState.error}
                retry={depositState.retry}
                of="this lease's deposit"
              />
            ) : depositQuery.data === undefined ? (
              <p className="text-body-sm text-ink-muted">Loading…</p>
            ) : !hasDeposit ? (
              <p className="text-body text-ink-secondary">No deposit was taken on this lease.</p>
            ) : (
              <>
                <Card className="flex items-center justify-between gap-4">
                  <p className="text-body text-ink-primary">Currently held</p>
                  <Money value={parse(deposit.heldMinor)} />
                </Card>
                <div className="flex flex-col gap-2">
                  <Label>Action</Label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-pressed={depositAction === "refund"}
                      onClick={() => setDepositAction("refund")}
                      className={cn(chipClass(depositAction === "refund"), "flex-1")}
                    >
                      Refund
                    </button>
                    <button
                      type="button"
                      aria-pressed={depositAction === "retain"}
                      onClick={() => setDepositAction("retain")}
                      className={cn(chipClass(depositAction === "retain"), "flex-1")}
                    >
                      Retain
                    </button>
                    <button
                      type="button"
                      aria-pressed={depositAction === "hold"}
                      onClick={() => setDepositAction("hold")}
                      className={cn(chipClass(depositAction === "hold"), "flex-1")}
                    >
                      Hold
                    </button>
                  </div>
                </div>
                {depositAction === "retain" ? (
                  <MoneyField
                    label="Amount to retain"
                    valueMinor={retainAmountMinor}
                    onChange={setRetainAmountMinor}
                  />
                ) : null}
                <DateField
                  label="Date"
                  value={depositOccurredOn}
                  today={today}
                  onChange={setDepositOccurredOn}
                />
                <NoteField
                  label="Reason (optional)"
                  value={depositReason}
                  onChange={setDepositReason}
                />
                {settleDepositMutation.isError ? (
                  <p className="text-body-sm text-critical-ink">
                    {settleDepositMutation.error.message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {step === 4 ? (
          <div className="flex flex-col gap-4">
            <p className="text-body text-ink-secondary">
              This marks the vehicle available again and closes the lease for good.
            </p>
            {closeOutMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{closeOutMutation.error.message}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Screen>
  );
}
