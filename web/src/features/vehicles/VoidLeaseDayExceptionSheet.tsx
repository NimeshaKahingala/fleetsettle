import type { LeaseDayExceptionResponse, VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidLeaseDayExceptionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  dailyLeaseId: string | null;
  exception: LeaseDayExceptionResponse | null;
}

/** GAP-147/GAP-20: un-skip one daily-lease exception through the existing void endpoint. */
export function VoidLeaseDayExceptionSheet({
  open,
  onOpenChange,
  vehicleId,
  dailyLeaseId,
  exception,
}: VoidLeaseDayExceptionSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (dailyLeaseId === null || exception === null) throw new Error("Choose a skipped day");
      return api.post<VoidedResponse>(
        `/api/daily-lease/${dailyLeaseId}/exception/${exception.id}/void`,
        { reason: reason.trim() },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "daily-lease"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease", dailyLeaseId, "exception"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Undo skipped day">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This reopens the date for the daily lease while keeping the original skip in history.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending || dailyLeaseId === null}
          onClick={() => mutation.mutate()}
        >
          Undo skip
        </Button>
      </div>
    </Sheet>
  );
}
