import { type BusinessDate } from "@fleetsettle/shared";
import type { RecordOffRoadResponse, RentTreatment } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface OffRoadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  today: BusinessDate;
  onRecorded: () => void;
}

const TREATMENT_OPTIONS: { value: RentTreatment; label: string }[] = [
  { value: "continue", label: "Rent continues" },
  { value: "credit_days", label: "Credit the days" },
  { value: "extend", label: "Extend the rental" },
];

/**
 * F-3.4 step 2/W-9: the off-road window and the rent treatment, entered
 * together, "for this incident only." `continue` is the default, safe,
 * do-nothing choice — the other two only apply against a lease, and the
 * incident may not have one (a validation error surfaces plainly if so,
 * rather than being pre-guessed at here). Not one of `Dialog`'s three
 * reserved confirms (INV-1/INV-17/M-10), so a validation error (400) shows
 * inline like any other — no Dialog.
 */
export function OffRoadSheet({
  open,
  onOpenChange,
  incidentId,
  today,
  onRecorded,
}: OffRoadSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [offRoadFrom, setOffRoadFrom] = useState<BusinessDate>(today);
  const [offRoadTo, setOffRoadTo] = useState<BusinessDate>(today);
  const [rentTreatment, setRentTreatment] = useState<RentTreatment>("continue");

  useEffect(() => {
    if (open) {
      setOffRoadFrom(today);
      setOffRoadTo(today);
      setRentTreatment("continue");
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<RecordOffRoadResponse>(`/api/incident/${incidentId}/off-road`, {
        offRoadFrom,
        offRoadTo,
        rentTreatment,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      onRecorded();
    },
  });

  const canSave = offRoadTo >= offRoadFrom;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Off-road days">
      <div className="flex flex-col gap-4">
        <DateField label="From" value={offRoadFrom} today={today} onChange={setOffRoadFrom} />
        <DateField label="To" value={offRoadTo} today={today} onChange={setOffRoadTo} />
        <div className="flex flex-col gap-2">
          <Label>Rent, for this incident only</Label>
          <div className="flex flex-col gap-2">
            {TREATMENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={rentTreatment === option.value}
                onClick={() => setRentTreatment(option.value)}
                className={cn(
                  "min-h-tap rounded-sm border px-3 text-left text-body",
                  rentTreatment === option.value
                    ? "border-brand bg-brand-wash text-brand-ink"
                    : "border-transparent bg-surface-sunken text-ink-primary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}
