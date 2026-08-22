import type { BusinessDate } from "@fleetsettle/shared";
import type { VehicleUnavailabilityResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Checkbox } from "../../design/primitives/Checkbox.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import {
  VEHICLE_UNAVAILABILITY_REASON_LABEL,
  type VehicleUnavailabilityReason,
} from "../../lib/vehicleUnavailabilityReasonLabel.js";

export interface MarkVehicleUnavailableSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  today: BusinessDate;
}

/** GAP-26/GAP-147/F-1.10: mark a vehicle off the road — vehicle-level, arrangement-agnostic, layered on top of whatever occupancy a date already has. */
export function MarkVehicleUnavailableSheet({
  open,
  onOpenChange,
  vehicleId,
  today,
}: MarkVehicleUnavailableSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<VehicleUnavailabilityReason>("service");
  const [unavailableFrom, setUnavailableFrom] = useState<BusinessDate>(today);
  const [ongoing, setOngoing] = useState(true);
  const [unavailableTo, setUnavailableTo] = useState<BusinessDate>(today);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("service");
    setUnavailableFrom(today);
    setOngoing(true);
    setUnavailableTo(today);
    setNote("");
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<VehicleUnavailabilityResponse>(`/api/vehicle/${vehicleId}/unavailability`, {
        reason,
        unavailableFrom,
        ...(ongoing ? {} : { unavailableTo }),
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "unavailability"] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "calendar"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Mark unavailable">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          {(
            Object.entries(VEHICLE_UNAVAILABILITY_REASON_LABEL) as [
              VehicleUnavailabilityReason,
              string,
            ][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={reason === value}
              onClick={() => setReason(value)}
              className={
                reason === value
                  ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                  : "min-h-tap rounded-sm border border-transparent bg-surface-sunken px-2 text-body-sm text-ink-primary"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <DateField
          label="From"
          today={today}
          value={unavailableFrom}
          onChange={setUnavailableFrom}
        />
        <label className="flex min-h-tap items-center gap-3">
          <Checkbox checked={ongoing} onCheckedChange={(checked) => setOngoing(checked === true)} />
          <span className="text-body text-ink-primary">No end date yet</span>
        </label>
        {!ongoing ? (
          <DateField label="To" today={today} value={unavailableTo} onChange={setUnavailableTo} />
        ) : null}
        <NoteField label="Note (optional)" value={note} onChange={setNote} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Mark unavailable
        </Button>
      </form>
    </Sheet>
  );
}
