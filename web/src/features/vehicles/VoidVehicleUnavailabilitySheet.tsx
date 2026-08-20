import type { VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidVehicleUnavailabilitySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  unavailabilityId: string | null;
}

/** GAP-147/GAP-26: void an unavailability period through the existing void endpoint — the calendar's own read already excludes voided rows, so this simply reopens the range. */
export function VoidVehicleUnavailabilitySheet({
  open,
  onOpenChange,
  vehicleId,
  unavailabilityId,
}: VoidVehicleUnavailabilitySheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (unavailabilityId === null) throw new Error("Choose an unavailable period");
      return api.post<VoidedResponse>(
        `/api/vehicle/${vehicleId}/unavailability/${unavailabilityId}/void`,
        { reason: reason.trim() },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "unavailability"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "calendar"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void unavailable period">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This reopens the vehicle for these dates. The original period stays in history.
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
          Void period
        </Button>
      </div>
    </Sheet>
  );
}
