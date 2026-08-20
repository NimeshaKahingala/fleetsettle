import type { VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidObligationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  obligationId: string | null;
}

/**
 * GAP-147/W-61/INV-36 §3.10: void a post-closure charge — the only
 * obligation kind a person raises directly with nothing else to correct
 * instead (a rent/lease due corrects at its own source: close the lease,
 * void the day, cancel the trip). The Worker's own `voidObligationHandler`
 * refuses any other kind with 400, so this is the client's one caller.
 */
export function VoidObligationSheet({
  open,
  onOpenChange,
  customerId,
  obligationId,
}: VoidObligationSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (obligationId === null) throw new Error("Choose a charge");
      return api.post<VoidedResponse>(`/api/obligation/${obligationId}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void charge">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a late charge entered by mistake. It is removed from outstanding dues.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Void charge
        </Button>
      </div>
    </Sheet>
  );
}
