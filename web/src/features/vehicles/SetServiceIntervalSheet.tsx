import type { VehicleResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface SetServiceIntervalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  currentServiceIntervalKm: number | null;
}

/**
 * F-3.5/UC-13/GAP-68: "editable on the vehicle's own page, never required
 * to save the vehicle" (U-2) — this sheet is reached from the vehicle's own
 * actions menu, entirely separate from `CreateVehicleForm`. Blank clears
 * the interval, which is exactly how the prompt turns back off.
 */
export function SetServiceIntervalSheet({
  open,
  onOpenChange,
  vehicleId,
  currentServiceIntervalKm,
}: SetServiceIntervalSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState(currentServiceIntervalKm?.toString() ?? "");

  useEffect(() => {
    if (!open) return;
    setText(currentServiceIntervalKm?.toString() ?? "");
    // Sync when the sheet opens; while open, user edits should stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-time reset only
  }, [open]);

  const mutation = useMutation({
    mutationFn: (serviceIntervalKm: number | null) =>
      api.post<VehicleResponse>(`/api/vehicle/${vehicleId}/service-interval`, {
        serviceIntervalKm,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Service interval">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          // eslint-disable-next-line no-restricted-syntax -- kilometres, not money
          mutation.mutate(trimmed === "" ? null : Number(trimmed));
        }}
      >
        <p className="text-body-sm text-ink-secondary">
          Once set, this vehicle's own page prompts when it has gone this far since its last
          service. Leave blank to turn the prompt off.
        </p>

        <Field label="Kilometres between services" htmlFor="serviceIntervalKm" optional>
          <Input
            id="serviceIntervalKm"
            type="number"
            inputMode="numeric"
            min={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Save service interval
        </Button>
      </form>
    </Sheet>
  );
}
