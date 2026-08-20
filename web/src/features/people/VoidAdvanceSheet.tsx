import type { DriverViewAdvance, VoidedAdvanceResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidAdvanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  advance: DriverViewAdvance | null;
}

/** GAP-147/W-61: void an advance entered by mistake; backend refuses while live settlements sit below it. */
export function VoidAdvanceSheet({ open, onOpenChange, driverId, advance }: VoidAdvanceSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (advance === null) throw new Error("Choose an advance");
      return api.post<VoidedAdvanceResponse>(`/api/advance/${advance.id}/void`, {
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Void advance">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects an advance entered by mistake. If a settlement has already been recorded,
          undo that settlement first.
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
          Void advance
        </Button>
      </div>
    </Sheet>
  );
}
