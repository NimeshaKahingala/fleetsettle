import { parse, type Minor } from "@fleetsettle/shared";
import type {
  AccountingPeriodListRow,
  OverheadsResponse,
  PartnerSummaryResponse,
  PaperworkWarningRow,
  VehicleMonthResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { useApi } from "../../lib/ApiContext.js";
import { useMe } from "../../lib/useMe.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { VehiclePerformanceCard } from "./VehiclePerformanceCard.js";

export interface ReviewThisMonthScreenProps {
  onSelectVehicle: (vehicleId: string, periodId: string) => void;
  onSelectMyMoney: () => void;
}

/** This signed-in user's own share of one period's combined profit — the sum of every vehicle's own `ownerShares` row matching `userId`, zero if they hold no share anywhere this period. */
export function computeMyShare(vehicles: VehicleMonthResponse["vehicles"], userId: string): Minor {
  let total = 0n;
  for (const v of vehicles) {
    const mine = v.ownerShares.find((s) => s.userId === userId);
    if (mine !== undefined) total += parse(mine.profitShareMinor);
  }
  return total as Minor;
}

/**
 * §5.4, decided 7 Aug 2026: omitted entirely (not `0%`, not `NotAvailable`)
 * when there is no predecessor period, or when the predecessor's own share
 * was exactly zero — a percentage change against zero is not a number,
 * it's an undefined operation, the same "nothing to compare against" case
 * the spec already names for a first period.
 */
export function computeDeltaPercent(current: Minor, previous: Minor | undefined): number | null {
  if (previous === undefined || previous === 0n) return null;
  const currentRaw: bigint = current;
  const previousRaw: bigint = previous;
  const changeRaw = currentRaw - previousRaw;
  const magnitudeRaw = previousRaw < 0n ? -previousRaw : previousRaw;
  // eslint-disable-next-line no-restricted-syntax -- a percentage change between two bigints, not a money value itself
  const change = Number(changeRaw);
  // eslint-disable-next-line no-restricted-syntax -- a percentage change between two bigints, not a money value itself
  const magnitude = Number(magnitudeRaw);
  return (change / magnitude) * 100;
}

/**
 * UI §7.8, the passive owner's own 60 seconds (F-4.5) — and, per B0b's
 * shared-route design, `owner_manager`'s too, from `/more → My share`.
 * **Read-only by construction**: every card here navigates to a display,
 * never to a write flow (§7.8's own rule, "no entry affordance anywhere").
 *
 * The overheads block reads `GET /api/reports/overheads` directly — GAP-41
 * closed 8 Aug 2026, so the block this screen was originally scoped
 * without (B4-REPORTS-DESIGN.md §9.2's Wave 1/Wave 2 split, written before
 * that gap closed) has no live blocker left. Built here rather than
 * deferred to a Wave 2 that no longer has a reason to hold it — the same
 * "a gap's reason is a fact with a date on it" pattern this repository has
 * already named three times (TRACKER.md §6).
 */
export function ReviewThisMonthScreen({
  onSelectVehicle,
  onSelectMyMoney,
}: ReviewThisMonthScreenProps) {
  const api = useApi();
  const me = useMe();

  const periodsQuery = useQuery({
    queryKey: ["accounting-period"],
    queryFn: () => api.get<AccountingPeriodListRow[]>("/api/accounting-period"),
  });

  const current = periodsQuery.data?.find((p) => p.status === "open") ?? periodsQuery.data?.[0];
  const currentIndex =
    current !== undefined ? (periodsQuery.data?.findIndex((p) => p.id === current.id) ?? -1) : -1;
  const previous = currentIndex >= 0 ? periodsQuery.data?.[currentIndex + 1] : undefined;

  const currentReportQuery = useQuery({
    queryKey: ["reports", "vehicle-month", current?.id],
    queryFn: () => {
      if (current === undefined) throw new Error("no period resolved yet");
      return api.get<VehicleMonthResponse>(`/api/reports/vehicle-month?periodId=${current.id}`);
    },
    enabled: current !== undefined,
  });

  const previousReportQuery = useQuery({
    queryKey: ["reports", "vehicle-month", previous?.id],
    queryFn: () => {
      if (previous === undefined) throw new Error("no previous period");
      return api.get<VehicleMonthResponse>(`/api/reports/vehicle-month?periodId=${previous.id}`);
    },
    enabled: previous !== undefined,
  });

  const overheadsQuery = useQuery({
    queryKey: ["reports", "overheads", current?.id],
    queryFn: () => {
      if (current === undefined) throw new Error("no period resolved yet");
      return api.get<OverheadsResponse>(`/api/reports/overheads?periodId=${current.id}`);
    },
    enabled: current !== undefined,
  });

  const warningsQuery = useQuery({
    queryKey: ["home", "paperwork-warnings"],
    queryFn: () => api.get<PaperworkWarningRow[]>("/api/home/paperwork-warnings"),
  });

  const partnerQuery = useQuery({
    queryKey: ["partner", me.userId],
    queryFn: () => api.get<PartnerSummaryResponse>(`/api/partner/${me.userId}`),
  });

  const periodsState = useQueryState(periodsQuery);
  const currentReportState = useQueryState(currentReportQuery);
  const previousReportState = useQueryState(previousReportQuery);
  const overheadsState = useQueryState(overheadsQuery);
  const partnerState = useQueryState(partnerQuery);

  // GAP-101: `periodsQuery` failing is checked first — without it `current`
  // never resolves, so `currentReportQuery` stays `idle` forever, not
  // `pending`. `previousReportQuery` failing is not blocking here: a missing
  // delta already reads as "nothing to compare against" (§5.4's own rule),
  // the same honest omission a genuinely first period gets.
  if (periodsState.kind === "error") {
    return (
      <Screen title="This month">
        <QueryStateFailure
          error={periodsState.error}
          retry={periodsState.retry}
          of="the accounting periods"
        />
      </Screen>
    );
  }
  if (currentReportState.kind === "error") {
    return (
      <Screen title="This month">
        <QueryStateFailure
          error={currentReportState.error}
          retry={currentReportState.retry}
          of="this month"
        />
      </Screen>
    );
  }
  if (currentReportState.kind !== "ready") {
    return (
      <Screen title="This month">
        <p className="text-body text-ink-muted">Loading…</p>
      </Screen>
    );
  }

  const currentReport = currentReportState.data;
  const myShare = computeMyShare(currentReport.vehicles, me.userId);
  const previousShare =
    previousReportState.kind === "ready"
      ? computeMyShare(previousReportState.data.vehicles, me.userId)
      : undefined;
  const delta = computeDeltaPercent(myShare, previousShare);
  // eslint-disable-next-line no-restricted-syntax -- rounding a display percentage, not a money amount
  const deltaRounded = delta !== null ? Math.abs(Math.round(delta)) : null;

  const vehicleWarnings = new Map(
    (warningsQuery.data ?? [])
      .filter((w) => w.subjectType === "vehicle")
      .map((w) => [w.subjectId, `${w.docType} expires ${w.expiryDate}`]),
  );

  return (
    <Screen title="This month">
      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-1">
          <span className="text-caption text-ink-muted">My share this month</span>
          <Money value={myShare} className="text-title-lg font-medium" />
          {delta !== null ? (
            <span
              className={
                delta >= 0 ? "text-body-sm text-good-ink" : "text-body-sm text-critical-ink"
              }
            >
              {delta >= 0 ? "▲" : "▼"} {deltaRounded}% vs last month
            </span>
          ) : null}
        </Card>

        <div className="flex flex-col gap-2">
          {currentReport.vehicles.map((v) => {
            const mine = v.ownerShares.find((s) => s.userId === me.userId);
            const warning = vehicleWarnings.get(v.vehicleId);
            return (
              <VehiclePerformanceCard
                key={v.vehicleId}
                vehicle={v}
                myShareMinor={mine?.profitShareMinor}
                {...(warning !== undefined ? { warning } : {})}
                onClick={() => {
                  if (current !== undefined) onSelectVehicle(v.vehicleId, current.id);
                }}
              />
            );
          })}
        </div>

        {overheadsState.kind === "error" ? (
          <QueryStateFailure
            error={overheadsState.error}
            retry={overheadsState.retry}
            of="overheads"
          />
        ) : overheadsState.kind === "ready" ? (
          <Card className="flex justify-between">
            <span className="text-body-sm text-ink-secondary">Overheads (no vehicle)</span>
            <Money value={parse(overheadsState.data.totalMinor)} />
          </Card>
        ) : null}

        {partnerState.kind === "error" ? (
          <QueryStateFailure
            error={partnerState.error}
            retry={partnerState.retry}
            of="what you're owed"
          />
        ) : partnerState.kind === "ready" ? (
          <button type="button" onClick={onSelectMyMoney} className="w-full text-left">
            <Card className="flex items-center justify-between">
              <span className="text-body text-ink-primary">What I'm owed</span>
              <Money value={parse(partnerState.data.balanceMinor)} className="font-medium" />
            </Card>
          </button>
        ) : null}
      </div>
    </Screen>
  );
}
