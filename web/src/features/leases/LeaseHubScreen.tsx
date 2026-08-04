import { businessToday, parse, type Minor } from "@fleetsettle/shared";
import type {
  BillingPeriodResponse,
  CustomerResponse,
  LeaseObligationRow,
  LeaseResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, SlidersHorizontal, Wallet } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { AdjustObligationSheet } from "./AdjustObligationSheet.js";
import { CollectPaymentSheet } from "./CollectPaymentSheet.js";
import { RenewLeaseSheet } from "./RenewLeaseSheet.js";

export interface LeaseHubScreenProps {
  leaseId: string;
  onBack: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  closing: "Closing",
  closed: "Closed",
};

const DUE_KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  mileage_excess: "Mileage excess",
  post_closure_charge: "Late charge",
};

const DUE_STATUS_LABEL: Record<string, string> = {
  pending: "Due",
  part_paid: "Part paid",
  paid: "Paid",
  waived: "Waived",
  written_off: "Written off",
};

const OPEN_STATUSES = new Set(["pending", "part_paid"]);

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function outstandingMinor(due: LeaseObligationRow): Minor {
  return (BigInt(due.amountMinor) - BigInt(due.settledMinor) - BigInt(due.waivedMinor)) as Minor;
}

/**
 * §3.3's `/leases/:id` — the hub F-2.2 (collect rent), F-2.4 (adjust or
 * waive) and F-2.5 (renew) all act from. F-2.1's start form and F-2.6's
 * closure wizard are their own routes/phases (Web-P6c/P6d) — this screen
 * only ever reads an existing lease, never creates or closes one.
 * `today` is `businessToday()` called here directly, matching
 * `DriverDetailScreen` (this feature's closest sibling in shape: a detail
 * hub plus a money-action sheet needing a date default) rather than
 * `VehicleCalendarScreen`'s prop-injection, which exists for a different
 * reason — testing a specific month grid, not a one-off date default.
 */
export function LeaseHubScreen({ leaseId, onBack }: LeaseHubScreenProps) {
  const api = useApi();
  const today = businessToday();
  const [renewOpen, setRenewOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [dueActionsOpen, setDueActionsOpen] = useState(false);
  const [selectedDue, setSelectedDue] = useState<LeaseObligationRow | null>(null);
  const [collectForDue, setCollectForDue] = useState<LeaseObligationRow | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const leaseQuery = useQuery({
    queryKey: ["lease", leaseId],
    queryFn: () => api.get<LeaseResponse>(`/api/lease/${leaseId}`),
  });
  const customerQuery = useQuery({
    queryKey: ["customer", leaseQuery.data?.customerId],
    queryFn: () => {
      const customerId = leaseQuery.data?.customerId;
      // `enabled` below keeps this from ever firing before `customerId` exists.
      if (customerId === undefined) throw new Error("lease not loaded yet");
      return api.get<CustomerResponse>(`/api/customer/${customerId}`);
    },
    enabled: leaseQuery.data !== undefined,
  });
  const billingPeriodsQuery = useQuery({
    queryKey: ["lease", leaseId, "billing-period"],
    queryFn: () => api.get<BillingPeriodResponse[]>(`/api/lease/${leaseId}/billing-period`),
  });
  const duesQuery = useQuery({
    queryKey: ["lease", leaseId, "obligation"],
    queryFn: () => api.get<LeaseObligationRow[]>(`/api/lease/${leaseId}/obligation`),
  });

  const lease = leaseQuery.data;
  const billingPeriods = billingPeriodsQuery.data ?? [];
  const dues = duesQuery.data ?? [];

  function openDueActions(due: LeaseObligationRow): void {
    setSelectedDue(due);
    setDueActionsOpen(true);
  }

  const dueActions: ActionSheetAction[] =
    selectedDue !== null
      ? [
          {
            key: "collect",
            label: "Collect payment",
            icon: Wallet,
            onSelect: () => {
              setCollectForDue(selectedDue);
              setCollectOpen(true);
            },
          },
          {
            key: "adjust",
            label: "Adjust or waive",
            icon: SlidersHorizontal,
            onSelect: () => setAdjustOpen(true),
          },
        ]
      : [];

  return (
    <Screen
      title={customerQuery.data?.name ?? "Lease"}
      onBack={onBack}
      {...(lease !== undefined
        ? {
            action: { label: "Renew", icon: RefreshCw, onClick: () => setRenewOpen(true) },
            primaryAction: {
              label: "Collect payment",
              onClick: () => {
                setCollectForDue(null);
                setCollectOpen(true);
              },
            },
          }
        : {})}
    >
      {lease === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div>
              <p className="text-label text-ink-secondary">Status</p>
              <p className="text-body text-ink-primary">
                {STATUS_LABEL[lease.status] ?? lease.status}
              </p>
            </div>
            <div>
              <p className="text-label text-ink-secondary">Monthly amount</p>
              <Money value={parse(lease.rentAmountMinor)} className="text-title" />
            </div>
            <div>
              <p className="text-label text-ink-secondary">Billing day</p>
              <p className="text-body text-ink-primary">{lease.billingDay}</p>
            </div>
            <div>
              <p className="text-label text-ink-secondary">Term</p>
              <p className="text-body text-ink-primary">
                {formatShortDate(lease.startDate)}
                {" – "}
                {lease.endDate !== null ? formatShortDate(lease.endDate) : "ongoing"}
              </p>
            </div>
            {lease.mileageDailyLimitKm !== null ? (
              <div>
                <p className="text-label text-ink-secondary">Mileage</p>
                <p className="text-body text-ink-primary">
                  {lease.mileageDailyLimitKm} km/day
                  {lease.mileageExcessRateMinor !== null ? (
                    <>
                      {" · "}
                      <Money value={parse(lease.mileageExcessRateMinor)} />
                      /km excess
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </Card>

          {billingPeriods.length > 0 ? (
            <Section
              title="Billing periods"
              count={billingPeriods.length}
              items={billingPeriods.map((period) => (
                <Card key={period.id} className="flex items-center justify-between gap-4">
                  <p className="text-body text-ink-primary">
                    {formatShortDate(period.periodStart)} – {formatShortDate(period.periodEnd)}
                  </p>
                  <Money value={parse(period.rentAmountMinor)} />
                </Card>
              ))}
            />
          ) : null}

          {dues.length > 0 ? (
            <Section
              title="Dues"
              count={dues.length}
              items={dues.map((due) => {
                const actionable = OPEN_STATUSES.has(due.status);
                const row = (
                  <Card className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">
                        {DUE_KIND_LABEL[due.kind] ?? due.kind}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(due.dueOn)} · {DUE_STATUS_LABEL[due.status] ?? due.status}
                      </p>
                    </div>
                    <Money value={parse(due.amountMinor)} />
                  </Card>
                );
                return actionable ? (
                  <button
                    key={due.id}
                    type="button"
                    onClick={() => openDueActions(due)}
                    className="w-full text-left"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={due.id}>{row}</div>
                );
              })}
            />
          ) : null}

          <RenewLeaseSheet
            open={renewOpen}
            onOpenChange={setRenewOpen}
            leaseId={leaseId}
            currentRentMinor={parse(lease.rentAmountMinor)}
          />
          {customerQuery.data !== undefined ? (
            <CollectPaymentSheet
              open={collectOpen}
              onOpenChange={setCollectOpen}
              leaseId={leaseId}
              customerId={lease.customerId}
              customerName={customerQuery.data.name}
              dues={dues}
              today={today}
              {...(collectForDue !== null
                ? { initialAmountMinor: outstandingMinor(collectForDue) }
                : {})}
            />
          ) : null}
          {selectedDue !== null ? (
            <AdjustObligationSheet
              open={adjustOpen}
              onOpenChange={setAdjustOpen}
              leaseId={leaseId}
              due={selectedDue}
            />
          ) : null}
          <ActionSheet
            open={dueActionsOpen}
            onOpenChange={setDueActionsOpen}
            title="This due"
            actions={dueActions}
          />
        </div>
      )}
    </Screen>
  );
}
