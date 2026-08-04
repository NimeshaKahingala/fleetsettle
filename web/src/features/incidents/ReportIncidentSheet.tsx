import { type BusinessDate } from "@fleetsettle/shared";
import type { IncidentDetailResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface ReportIncidentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  today: BusinessDate;
  onCreated: (incidentId: string) => void;
}

/**
 * F-3.4 step 1/UC-12: "Open it — date, description, photos." Level 1 is
 * just the date, defaulted to today (U-2) — the container exists to be
 * revisited over weeks (§6.6), so nothing else here needs to be known yet.
 * Photos are not built (no R2 presigned upload — the same gap
 * `CloseLeaseScreen`'s condition step already carries, per the plan's own
 * decision to skip that work this pass).
 */
export function ReportIncidentSheet({
  open,
  onOpenChange,
  vehicleId,
  today,
  onCreated,
}: ReportIncidentSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [occurredOn, setOccurredOn] = useState<BusinessDate>(today);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setOccurredOn(today);
      setDescription("");
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<IncidentDetailResponse>("/api/incident", {
        vehicleId,
        occurredOn,
        ...(description.trim() !== "" ? { description: description.trim() } : {}),
      }),
    onSuccess: (incident) => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "incident"] });
      onCreated(incident.id);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Report incident">
      <div className="flex flex-col gap-4">
        <DateField label="Date" value={occurredOn} today={today} onChange={setOccurredOn} />
        <NoteField label="Description" value={description} onChange={setDescription} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button size="cta" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Report incident
        </Button>
      </div>
    </Sheet>
  );
}
