import { businessToday, parse, type Minor } from "@fleetsettle/shared";
import type {
  BillingPeriodResponse,
  CustomerResponse,
  LeaseObligationRow,
} from "@fleetsettle/shared/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, MoreVertical, RefreshCw, SlidersHorizontal, SquareX, Wallet } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge, type BadgeProps } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import {
  OBLIGATION_KIND_LABEL,
  OBLIGATION_STATUS_LABEL,
  OPEN_OBLIGATION_STATUSES,
} from "../../lib/obligationStatusLabel.js";
import { AdjustObligationSheet } from "./AdjustObligationSheet.js";
import { CollectPaymentSheet } from "./CollectPaymentSheet.js";
import { ReadOdometerSheet } from "./ReadOdometerSheet.js";
import { RenewLeaseSheet } from "./RenewLeaseSheet.js";
import { useLeaseQuery } from "./useLeaseQuery.js";

export interface LeaseHubScreenProps {
  leaseId: string;
  onBack: () => void;
  /** F-2.6 — its own route (`/leases/:id/close`), reached from this screen's own app-bar action list, never a sheet (the wizard is genuinely multi-step, M-5). */
  onCloseLease: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  closing: "Closing",
  closed: "Closed",
};

/** M-31/§7.11: status gets the same Badge treatment INCIDENT_STATUS_BADGE_VARIANT already established, not a plain text line. */
const STATUS_BADGE_VARIANT: Record<string, NonNullable<BadgeProps["variant"]>> = {
  draft: "neutral",
  active: "good",
  closing: "warning",
  closed: "neutral",
};

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
export function LeaseHubScreen({ leaseId, onBack, onCloseLease }: LeaseHubScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const today = businessToday();
  const [renewOpen, setRenewOpen] = useState(false);
  const [readOdometerOpen, setReadOdometerOpen] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [collectOpen, setCollectOpen] = useState(false);
  const [dueActionsOpen, setDueActionsOpen] = useState(false);
  const [selectedDue, setSelectedDue] = useState<LeaseObligationRow | null>(null);
  const [collectForDue, setCollectForDue] = useState<LeaseObligationRow | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const leaseQuery = useLeaseQuery(leaseId);
  // allow: title fallback plus a fail-closed gate on CollectPaymentSheet
  // (rendered only once customerQuery.data resolves) — a failure here
  // never offers a wrong customer, it just delays the action rendering.
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
  const leaseState = useQueryState(leaseQuery);
  const billingPeriodsState = useQueryState(billingPeriodsQuery);
  const duesState = useQueryState(duesQuery);

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

  // Renew (F-2.5), read odometer (F-2.3) and close the lease (F-2.6) all
  // live at lease level, not per-due — one app-bar action listing all
  // three (§6.1's own `ActionSheet`) rather than three competing app-bar
  // slots (§4.2 allows exactly one).
  const moreActions: ActionSheetAction[] = [
    { key: "renew", label: "Renew", icon: RefreshCw, onSelect: () => setRenewOpen(true) },
    {
      key: "odometer",
      label: "Read odometer",
      icon: Gauge,
      onSelect: () => setReadOdometerOpen(true),
    },
    { key: "close", label: "Close the lease", icon: SquareX, onSelect: onCloseLease },
  ];

  return (
    <Screen
      title={customerQuery.data?.name ?? "Lease"}
      onBack={onBack}
      {...(lease !== undefined
        ? {
            action: {
              label: "Lease actions",
              icon: MoreVertical,
              onClick: () => setMoreActionsOpen(true),
            },
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
      {leaseState.kind === "error" ? (
        <QueryStateFailure error={leaseState.error} retry={leaseState.retry} of="this lease" />
      ) : lease === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div>
              <p className="text-label text-ink-secondary">Status</p>
              <Badge variant={STATUS_BADGE_VARIANT[lease.status] ?? "neutral"}>
                {STATUS_LABEL[lease.status] ?? lease.status}
              </Badge>
            </div>
            <StatTile
              label="Monthly amount"
              value={<Money value={parse(lease.rentAmountMinor)} />}
            />
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

          {/* §7.11: "leads with the financial summary and unresolved
              blockers, then actions, then history" — dues (money still
              owed) come before billing periods (the schedule that produced
              them), the same ordering rule TripDetailScreen/IncidentScreen
              already apply. */}
          {duesState.kind === "error" ? (
            <QueryStateFailure error={duesState.error} retry={duesState.retry} of="dues" />
          ) : null}
          {dues.length > 0 ? (
            <Section
              title="Dues"
              count={dues.length}
              items={dues.map((due) => {
                const actionable = OPEN_OBLIGATION_STATUSES.has(due.status);
                const row = (
                  <Card className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">
                        {OBLIGATION_KIND_LABEL[due.kind] ?? due.kind}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(due.dueOn)} ·{" "}
                        {OBLIGATION_STATUS_LABEL[due.status] ?? due.status}
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

          {billingPeriodsState.kind === "error" ? (
            <QueryStateFailure
              error={billingPeriodsState.error}
              retry={billingPeriodsState.retry}
              of="billing periods"
            />
          ) : null}
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

          <RenewLeaseSheet
            open={renewOpen}
            onOpenChange={setRenewOpen}
            leaseId={leaseId}
            currentRentMinor={parse(lease.rentAmountMinor)}
          />
          <ReadOdometerSheet
            open={readOdometerOpen}
            onOpenChange={setReadOdometerOpen}
            leaseId={leaseId}
            today={today}
          />
          {customerQuery.data !== undefined ? (
            <CollectPaymentSheet
              open={collectOpen}
              onOpenChange={setCollectOpen}
              customerId={lease.customerId}
              customerName={customerQuery.data.name}
              dues={dues}
              today={today}
              {...(collectForDue !== null
                ? { initialAmountMinor: outstandingMinor(collectForDue) }
                : {})}
              onCollected={() =>
                void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "obligation"] })
              }
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
          <ActionSheet
            open={moreActionsOpen}
            onOpenChange={setMoreActionsOpen}
            title="Lease actions"
            actions={moreActions}
          />
        </div>
      )}
    </Screen>
  );
}
