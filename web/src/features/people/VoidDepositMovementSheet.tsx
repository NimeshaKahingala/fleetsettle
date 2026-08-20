import type {
  DriverViewDepositMovement,
  VoidedDepositMovementResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidDepositMovementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  depositId: string | null;
  movement: DriverViewDepositMovement | null;
}

/** GAP-146/W-61: void a specific deposit movement once the driver view exposes its movement id. */
export function VoidDepositMovementSheet({
  open,
  onOpenChange,
  driverId,
  depositId,
  movement,
}: VoidDepositMovementSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (depositId === null || movement === null) throw new Error("Choose a deposit movement");
      return api.post<VoidedDepositMovementResponse>(
        `/api/deposit/${depositId}/movement/${movement.id}/void`,
        { reason: reason.trim() },
      );
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Void deposit movement">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects one deposit movement while keeping the original row in the driver's history.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending || depositId === null}
          onClick={() => mutation.mutate()}
        >
          Void movement
        </Button>
      </div>
    </Sheet>
  );
}
