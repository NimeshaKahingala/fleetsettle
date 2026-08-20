import type { VoidedResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface VoidWriteOffSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  writeOffId: string;
  party: { type: "customer" | "driver"; id: string };
}

/** GAP-12/W-61: void a write-off correction, restoring its linked obligation server-side. */
export function VoidWriteOffSheet({
  open,
  onOpenChange,
  writeOffId,
  party,
}: VoidWriteOffSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<VoidedResponse>(`/api/write-off/${writeOffId}/void`, {
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["write-off"] });
      if (party.type === "customer") {
        void queryClient.invalidateQueries({ queryKey: ["customer", party.id, "obligation"] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "balances"] });
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "view"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void write-off">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a mistake in the write-off. The row stays visible with your reason.
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
          Void write-off
        </Button>
      </div>
    </Sheet>
  );
}
