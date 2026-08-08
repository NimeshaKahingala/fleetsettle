import type { VoidedExpenseResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidExpenseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseId: string;
  /** Every query key whose list includes this expense — vehicle/trip/incident costs can each render the same row. */
  invalidateKeys: readonly unknown[][];
}

/**
 * F-8.5/UC-96/GAP-81: void-and-replace, never delete — `voidExpenseRequestSchema`
 * requires a reason (money correction, never optional per F-8.5's own accept
 * clause). The backend has taken this write since A9a; this is its first
 * client caller. A voided row is never removed from any list — every screen
 * that renders one keeps it, struck through, per INV-21.
 */
export function VoidExpenseSheet({
  open,
  onOpenChange,
  expenseId,
  invalidateKeys,
}: VoidExpenseSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<VoidedExpenseResponse>(`/api/expense/${expenseId}/void`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      for (const key of invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      onOpenChange(false);
    },
  });

  const canSave = reason.trim().length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void expense">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a mistake, not a decision the business made. The record stays visible,
          struck through, with your reason attached.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Void expense
        </Button>
      </div>
    </Sheet>
  );
}
