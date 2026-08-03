import type {
  confirmDayRequestSchema,
  DailyLeaseResponse,
  DayRecordResponse,
  LostReason,
} from "@fleetsettle/shared/schemas";
import type { BusinessDate, Minor } from "@fleetsettle/shared";
import { parse, toWire } from "@fleetsettle/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { DayCard } from "../../components/DayCard.js";
import { Money } from "../../components/Money.js";
import { SyncChip } from "../../components/SyncChip.js";
import { Card } from "../../design/primitives/Card.js";
import { ReasonPicker, type ReasonOption } from "../../components/ReasonPicker.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { SomethingElseSheet } from "./SomethingElseSheet.js";

export interface ConfirmDayCardProps {
  dailyLeaseId: string;
  /** e.g. "Bus" — resolved by the caller, the same way `DayCard` itself takes it (§6.2). */
  vehicleLabel: string;
  driverLabel: string;
  dateLabel: string;
  today: BusinessDate;
  /** Threaded straight to `DayCard`/the settled summary's own `Card` — see `DayCard`'s doc comment (§3.2's 2–3-vehicle case). */
  elevated?: boolean;
}

/** F-4.4's reason list — `on_charter` is deliberately absent (FL §4.1). */
const LOST_REASONS: { key: LostReason; label: string }[] = [
  { key: "breakdown", label: "Breakdown" },
  { key: "driver_day_off", label: "Driver's day off" },
  { key: "driver_ill", label: "Driver ill" },
  { key: "public_holiday", label: "Public holiday" },
  { key: "no_passengers", label: "No passengers" },
  { key: "other", label: "Other" },
];

/** The wire shape `confirmDayRequestSchema` actually validates on arrival — money and dates as strings, the schema's `z.input` side rather than its `z.output` (domain types) side. */
type ConfirmDayWireRequest = z.input<typeof confirmDayRequestSchema>;

function stateLabel(state: DayRecordResponse["state"]): string {
  switch (state) {
    case "did_not_run":
      return "Didn't run";
    case "ran_unpaid":
      return "Confirmed — unpaid";
    case "ran_paid_short":
      return "Confirmed — paid short";
    case "ran_paid_full":
      return "Confirmed";
    case "open":
    case "paused_for_trip":
      return "Confirmed";
  }
}

/**
 * F-4.2/F-4.4, assembled: `DayCard` wired to `POST /api/day-record/confirm`,
 * `SomethingElseSheet` for the earned/received split, `ReasonPicker` for
 * "Didn't run". Every action already carries the values the backend would
 * derive the same state from, so the settled summary renders immediately on
 * tap — optimistic — with `SyncChip` covering the gap until the response
 * actually lands and replaces it (CLAUDE.md → Writes: one tap, one
 * transaction; a second tap has nothing left to do).
 */
export function ConfirmDayCard({
  dailyLeaseId,
  vehicleLabel,
  driverLabel,
  dateLabel,
  today,
  elevated = true,
}: ConfirmDayCardProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [somethingElseOpen, setSomethingElseOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);

  const dayQueryKey = ["day-record", dailyLeaseId, today];

  const dayQuery = useQuery({
    queryKey: dayQueryKey,
    queryFn: async () => {
      try {
        return await api.get<DayRecordResponse>(`/api/day-record/${dailyLeaseId}/${today}`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });

  const leaseQuery = useQuery({
    queryKey: ["daily-lease", dailyLeaseId],
    queryFn: () => api.get<DailyLeaseResponse>(`/api/daily-lease/${dailyLeaseId}`),
  });

  const confirmMutation = useMutation({
    mutationFn: (body: ConfirmDayWireRequest) =>
      api.post<DayRecordResponse>("/api/day-record/confirm", body),
    onSuccess: (data) => {
      queryClient.setQueryData(dayQueryKey, data);
    },
  });

  if (dayQuery.data === undefined || leaseQuery.data === undefined) return null;

  const expectedMinor = parse(leaseQuery.data.dailyLeaseAmountMinor);

  // Optimistic: while the mutation is in flight, the values it was called
  // with already determine the outcome (the same derivation domain/confirmDay.ts
  // makes server-side) — shown immediately rather than waiting on the round trip.
  const optimistic: DayRecordResponse | null =
    confirmMutation.isPending && confirmMutation.variables
      ? toOptimisticRecord(confirmMutation.variables, expectedMinor)
      : null;

  const settled = dayQuery.data ?? optimistic;

  if (settled) {
    return (
      <Card elevated={elevated} className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-body-sm text-ink-muted">
            {vehicleLabel} · {dateLabel}
          </p>
          <SyncChip synced={!confirmMutation.isPending} />
        </div>
        <p className="text-body text-ink-secondary">{stateLabel(settled.state)}</p>
        <Money value={parse(settled.earnedMinor)} className="text-hero" />
        {confirmMutation.isError ? (
          <p className="text-body-sm text-critical-ink">{confirmMutation.error.message}</p>
        ) : null}
      </Card>
    );
  }

  return (
    <>
      <DayCard
        vehicleLabel={vehicleLabel}
        dateLabel={dateLabel}
        expectedFromLabel={`Expected from ${driverLabel}`}
        amountMinor={expectedMinor}
        elevated={elevated}
        onPaidInFull={() => {
          confirmMutation.mutate({ dailyLeaseId, businessDate: today, action: "paid_in_full" });
        }}
        onSomethingElse={() => setSomethingElseOpen(true)}
        onDidntRun={() => setReasonOpen(true)}
      />
      <SomethingElseSheet
        open={somethingElseOpen}
        onOpenChange={setSomethingElseOpen}
        expectedMinor={expectedMinor}
        onSave={(earnedMinor, receivedMinor) => {
          setSomethingElseOpen(false);
          confirmMutation.mutate({
            dailyLeaseId,
            businessDate: today,
            action: "something_else",
            earnedMinor: toWire(earnedMinor),
            receivedMinor: toWire(receivedMinor),
          });
        }}
      />
      <ReasonPicker
        open={reasonOpen}
        onOpenChange={setReasonOpen}
        title="Didn't run"
        reasons={LOST_REASONS}
        onSelect={(reason: ReasonOption) => {
          confirmMutation.mutate({
            dailyLeaseId,
            businessDate: today,
            action: "did_not_run",
            lostReason: reason.key as LostReason,
          });
        }}
      />
    </>
  );
}

/** Mirrors domain/confirmDay.ts's state derivation for the optimistic render only — overwritten by the real response the moment it lands. */
function toOptimisticRecord(
  variables: ConfirmDayWireRequest,
  expectedMinor: Minor,
): DayRecordResponse {
  const expected = toWire(expectedMinor);
  if (variables.action === "did_not_run") {
    return {
      id: "",
      dailyLeaseId: variables.dailyLeaseId,
      vehicleId: "",
      driverId: "",
      businessDate: variables.businessDate,
      state: "did_not_run",
      earnedMinor: "0",
      expectedMinor: expected,
      receivedMinor: "0",
      lostReason: variables.lostReason,
      note: null,
    };
  }

  const earnedMinor = variables.action === "paid_in_full" ? expected : variables.earnedMinor;
  const receivedMinor = variables.action === "paid_in_full" ? expected : variables.receivedMinor;
  const state =
    receivedMinor === "0"
      ? "ran_unpaid"
      : BigInt(receivedMinor) < BigInt(earnedMinor)
        ? "ran_paid_short"
        : "ran_paid_full";

  return {
    id: "",
    dailyLeaseId: variables.dailyLeaseId,
    vehicleId: "",
    driverId: "",
    businessDate: variables.businessDate,
    state,
    earnedMinor,
    expectedMinor: expected,
    receivedMinor,
    lostReason: null,
    note: null,
  };
}
