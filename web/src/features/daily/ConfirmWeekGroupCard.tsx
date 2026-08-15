import { add, parse, ZERO } from "@fleetsettle/shared";
import type { ConfirmDaysBulkResponse, UnconfirmedDayRecordRow } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Money } from "../../components/Money.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { useApi } from "../../lib/ApiContext.js";

export interface ConfirmWeekGroupCardProps {
  dailyLeaseId: string;
  vehicleLabel: string;
  driverLabel: string;
  /** Oldest first — the same order `listUnconfirmedDayRecordsForBusiness` already returns. */
  days: UnconfirmedDayRecordRow[];
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(
    new Date(`${date}T00:00:00`),
  );
}

/**
 * F-4.6/UC-38/GAP-2: "the stack shows every open day, oldest first …
 * Confirm all — one action." Offered instead of `ConfirmDayCard` whenever
 * one lease has two or more days waiting — a single day is already a
 * one-tap `paid_in_full` away via its own card, so a bulk action would only
 * duplicate it. The list of cards a single day would have shown *is* the
 * preview §6.5's discipline asks for (the same days are visible above/below
 * this card in "Earlier days"), so this card only adds the total and the
 * one action, not a second list.
 */
export function ConfirmWeekGroupCard({
  dailyLeaseId,
  vehicleLabel,
  driverLabel,
  days,
}: ConfirmWeekGroupCardProps) {
  const api = useApi();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      api.post<ConfirmDaysBulkResponse>(`/api/day-record/${dailyLeaseId}/confirm-week`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["day-record", "unconfirmed"] });
    },
  });

  const totalExpected = days.reduce((sum, d) => add(sum, parse(d.expectedMinor)), ZERO);
  const oldest = days[0];

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-body text-ink-primary">
            {vehicleLabel} · {driverLabel}
          </p>
          {oldest !== undefined ? (
            <p className="text-body-sm text-ink-muted">
              {days.length} days waiting, oldest {formatShortDate(oldest.businessDate)}
            </p>
          ) : null}
        </div>
        <Money value={totalExpected} className="text-title" />
      </div>
      {mutation.isError ? (
        <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
      ) : null}
      <Button size="default" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        Confirm all {days.length} at expected amount
      </Button>
    </Card>
  );
}
