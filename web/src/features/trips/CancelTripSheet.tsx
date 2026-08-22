import type { cancelTripRequestSchema, CancelledTripResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface CancelTripSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  onCancelled: () => void;
}

type CancelTripWireRequest = z.input<typeof cancelTripRequestSchema>;

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap flex-1 rounded-sm border px-3 text-body",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * F-5.5/UC-45: cancellation itself never blocks — an unsettled advance
 * needs a disposition, not a fix, so the first submit's 409 reveals the
 * chooser inline rather than a `Dialog` (unlike `CloseTripSheet`'s own
 * INV-17 block, this one always has its resolution one more tap away, so
 * a modal interruption isn't earning its place the way `Dialog`'s own doc
 * comment reserves it for).
 */
export function CancelTripSheet({ open, onOpenChange, tripId, onCancelled }: CancelTripSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [disposition, setDisposition] = useState<"refunded" | "retained" | null>(null);
  const [needsDisposition, setNeedsDisposition] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setDisposition(null);
      setNeedsDisposition(false);
    }
    // Sync on open, not close — the same reason `ReadOdometerSheet` does.
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<CancelledTripResponse>(`/api/trip/${tripId}/cancel`, {
        ...(reason.trim() !== "" ? { cancelReason: reason.trim() } : {}),
        ...(disposition !== null ? { advanceDisposition: disposition } : {}),
      } satisfies CancelTripWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      void queryClient.invalidateQueries({ queryKey: ["trip", "in-progress"] });
      onCancelled();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "TRIP_ADVANCE_UNSETTLED") {
        setNeedsDisposition(true);
      }
    },
  });

  const canSave = !needsDisposition || disposition !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Cancel trip">
      <div className="flex flex-col gap-4">
        <NoteField label="Reason (optional)" value={reason} onChange={setReason} />
        {needsDisposition ? (
          <div className="flex flex-col gap-2">
            <p className="text-body-sm text-ink-secondary">
              An advance against this trip needs a disposition before it can cancel.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={disposition === "refunded"}
                onClick={() => setDisposition("refunded")}
                className={chipClass(disposition === "refunded")}
              >
                Refund it
              </button>
              <button
                type="button"
                aria-pressed={disposition === "retained"}
                onClick={() => setDisposition("retained")}
                className={chipClass(disposition === "retained")}
              >
                Keep as fee
              </button>
            </div>
          </div>
        ) : null}
        {mutation.isError && !needsDisposition ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Cancel trip
        </Button>
      </div>
    </Sheet>
  );
}
