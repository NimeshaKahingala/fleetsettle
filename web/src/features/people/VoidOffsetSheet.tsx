import type { DriverViewOffset, VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidOffsetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  offset: DriverViewOffset | null;
}

/** GAP-147/W-61: void one driver offset, letting the API unwind both allocation sides. */
export function VoidOffsetSheet({ open, onOpenChange, driverId, offset }: VoidOffsetSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (offset === null) throw new Error("Choose an offset");
      return api.post<VoidedResponse>(`/api/offset/${offset.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void offset">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects an offset entered by mistake and lets the system unwind both sides.
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
          Void offset
        </Button>
      </div>
    </Sheet>
  );
}
