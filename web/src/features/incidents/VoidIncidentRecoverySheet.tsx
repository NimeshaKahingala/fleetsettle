import type { IncidentRecoveryResponse, VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidIncidentRecoverySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  vehicleId: string;
  recovery: IncidentRecoveryResponse | null;
}

/** GAP-147/W-50: void an unreceived customer contribution while keeping the row visible in incident history. */
export function VoidIncidentRecoverySheet({
  open,
  onOpenChange,
  incidentId,
  vehicleId,
  recovery,
}: VoidIncidentRecoverySheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (recovery === null) throw new Error("Choose a contribution");
      return api.post<VoidedResponse>(`/api/incident/${incidentId}/recovery/${recovery.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "incident"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void contribution">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This removes an unreceived contribution from the incident bottom line and keeps the
          correction visible in history.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending || recovery === null}
          onClick={() => mutation.mutate()}
        >
          Void contribution
        </Button>
      </div>
    </Sheet>
  );
}
