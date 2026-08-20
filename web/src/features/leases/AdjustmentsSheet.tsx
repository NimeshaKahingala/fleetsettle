import { parse } from "@fleetsettle/shared";
import type {
  AdjustmentListRow,
  ListAdjustmentsResponse,
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

export interface AdjustmentsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  obligationId: string;
}

const TYPE_LABEL: Record<AdjustmentListRow["adjustmentType"], string> = {
  goodwill: "Goodwill",
  rounding: "Rounding",
  agreed_discount: "Agreed discount",
  late_fee: "Late fee",
  extra_charge: "Extra charge",
  waiver: "Waiver",
  auto_waiver: "Auto waiver",
};

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * GAP-147: `createAdjustmentHandler` had always returned only the
 * obligation as it stood after the write, plus the new adjustment's own id
 * — nothing listed past adjustments against an obligation, so
 * `voidAdjustmentHandler` (live and tested since GAP-12) had no client
 * route to an adjustment id. One sheet with two modes, toggled by
 * `voidTarget` — the same shape `WriteOffRecoveriesSheet`/
 * `AdvanceSettlementsSheet` already established.
 */
export function AdjustmentsSheet({
  open,
  onOpenChange,
  leaseId,
  obligationId,
}: AdjustmentsSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [voidTarget, setVoidTarget] = useState<AdjustmentListRow | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setVoidTarget(null);
      setReason("");
    }
  }, [open]);

  const adjustmentsQuery = useQuery({
    queryKey: ["adjustment", obligationId],
    queryFn: () =>
      api.get<ListAdjustmentsResponse>(
        `/api/adjustment?obligationId=${encodeURIComponent(obligationId)}`,
      ),
    enabled: open,
  });
  const adjustmentsState = useQueryState(adjustmentsQuery);
  const adjustments = adjustmentsQuery.data ?? [];

  const voidMutation = useMutation({
    mutationFn: () => {
      if (voidTarget === null) throw new Error("Choose an adjustment");
      return api.post<VoidedResponse>(`/api/adjustment/${voidTarget.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["adjustment", obligationId] });
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      setVoidTarget(null);
      setReason("");
    },
  });

  if (voidTarget !== null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Void adjustment">
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-secondary">
            This reverses exactly what the adjustment did. The row stays visible with your reason.
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
            Void adjustment
          </Button>
          <Button variant="ghost" onClick={() => setVoidTarget(null)}>
            Back to adjustments
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Adjustments">
      {adjustmentsState.kind === "error" ? (
        <QueryStateFailure
          error={adjustmentsState.error}
          retry={adjustmentsState.retry}
          of="adjustments against this due"
        />
      ) : adjustmentsState.kind === "pending" || adjustmentsState.kind === "idle" ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : adjustments.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No adjustments recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {adjustments.map((adjustment) => (
            <Card
              key={adjustment.id}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-body text-ink-primary">
                  {TYPE_LABEL[adjustment.adjustmentType]}
                </p>
                <p className="text-caption text-ink-muted">
                  {formatShortDate(adjustment.occurredOn)}
                  {adjustment.reason !== null ? ` · ${adjustment.reason}` : ""}
                  {adjustment.voidedAt !== null ? " · voided" : ""}
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:items-end">
                <Money value={parse(adjustment.amountMinor)} />
                {adjustment.voidedAt === null ? (
                  <button
                    type="button"
                    onClick={() => setVoidTarget(adjustment)}
                    className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                  >
                    Void adjustment
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
