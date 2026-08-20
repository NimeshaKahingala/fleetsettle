import { parse } from "@fleetsettle/shared";
import type {
  AdvanceSettlementListRow,
  ListAdvanceSettlementsResponse,
  VoidedResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface AdvanceSettlementsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  advanceId: string;
}

const KIND_LABEL: Record<AdvanceSettlementListRow["kind"], string> = {
  spent: "Spent",
  returned: "Returned",
  kept_as_fee: "Kept as fee",
};

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * GAP-147: `settleAdvanceHandler` had always returned only the settlement
 * it just made — nothing listed past settlements against an advance, so
 * `voidAdvanceSettlementHandler` (live and tested since GAP-12) had no
 * client route to a settlement id. One sheet with two modes, toggled by
 * `voidTarget` — the same shape `WriteOffRecoveriesSheet` already
 * established for this — rather than a second `Sheet` stacked on top.
 */
export function AdvanceSettlementsSheet({
  open,
  onOpenChange,
  driverId,
  advanceId,
}: AdvanceSettlementsSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [voidTarget, setVoidTarget] = useState<AdvanceSettlementListRow | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setVoidTarget(null);
      setReason("");
    }
  }, [open]);

  const settlementsQuery = useQuery({
    queryKey: ["advance", advanceId, "settlement"],
    queryFn: () => api.get<ListAdvanceSettlementsResponse>(`/api/advance/${advanceId}/settlement`),
    enabled: open,
  });
  const settlementsState = useQueryState(settlementsQuery);
  const settlements = settlementsQuery.data ?? [];

  const voidMutation = useMutation({
    mutationFn: () => {
      if (voidTarget === null) throw new Error("Choose a settlement");
      return api.post<VoidedResponse>(
        `/api/advance/${advanceId}/settlement/${voidTarget.id}/void`,
        { reason: reason.trim() },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["advance", advanceId, "settlement"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setVoidTarget(null);
      setReason("");
    },
  });

  if (voidTarget !== null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Void settlement">
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-secondary">
            This corrects a settlement entered by mistake. The row stays visible with your reason,
            and the advance's status recomputes from what remains live.
          </p>
          <NoteField label="Reason" value={reason} onChange={setReason} />
          {voidMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{voidMutation.error.message}</p>
          ) : null}
          <Button
            size="cta"
            variant="destructive"
            disabled={reason.trim() === "" || voidMutation.isPending}
            onClick={() => voidMutation.mutate()}
          >
            Void settlement
          </Button>
          <Button variant="ghost" onClick={() => setVoidTarget(null)}>
            Back to settlements
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Settlements">
      {settlementsState.kind === "error" ? (
        <QueryStateFailure
          error={settlementsState.error}
          retry={settlementsState.retry}
          of="settlements against this advance"
        />
      ) : settlementsState.kind === "pending" || settlementsState.kind === "idle" ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : settlements.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No settlements recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {settlements.map((settlement) => (
            <Card
              key={settlement.id}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-body text-ink-primary">{KIND_LABEL[settlement.kind]}</p>
                <p className="text-caption text-ink-muted">
                  {formatShortDate(settlement.occurredOn)}
                  {settlement.voidedAt !== null ? " · voided" : ""}
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:items-end">
                <Money value={parse(settlement.amountMinor)} />
                {settlement.voidedAt === null ? (
                  <button
                    type="button"
                    onClick={() => setVoidTarget(settlement)}
                    className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                  >
                    Void settlement
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Sheet>
  );
}
