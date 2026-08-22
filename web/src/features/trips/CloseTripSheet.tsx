import { type BusinessDate } from "@fleetsettle/shared";
import type {
  closeTripRequestSchema,
  ClosedTripResponse,
  OdometerSource,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Button } from "../../design/primitives/Button.js";
import { Dialog } from "../../design/primitives/Dialog.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface CloseTripSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  today: BusinessDate;
  onClosed: () => void;
}

type CloseTripWireRequest = z.input<typeof closeTripRequestSchema>;

const ODOMETER_SOURCE_LABEL: Record<OdometerSource, string> = {
  photo: "Photo",
  in_person: "In person",
  reported: "Reported",
  at_return: "At return",
};

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected ? "border-brand bg-brand-wash text-brand-ink" : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * F-5.4/UC-44: "closing odometer → remaining costs → close." Remaining
 * costs are logged through the ordinary expense form (Web-P8b's own
 * territory, not duplicated here) — this sheet is the closing step alone.
 *
 * **INV-17 is the one place friction is correct** (UI §7.5): a driver
 * advance still open against this trip blocks close outright, surfaced
 * through `Dialog` — the component's own doc comment reserves it for
 * exactly this case, INV-1 and M-10, nothing else. The wireframe's own
 * "offers the reconciliation inline" is **not built**: there is no
 * advance-settle screen yet (Web-P8b/driver-money territory), so the
 * dialog names the block and dismisses, it does not yet offer the fix.
 */
export function CloseTripSheet({
  open,
  onOpenChange,
  tripId,
  today,
  onClosed,
}: CloseTripSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [closingDate, setClosingDate] = useState<BusinessDate>(today);
  const [hasReading, setHasReading] = useState(false);
  const [readingKm, setReadingKm] = useState("");
  const [source, setSource] = useState<OdometerSource | null>(null);

  useEffect(() => {
    if (open) {
      setClosingDate(today);
      setHasReading(false);
      setReadingKm("");
      setSource(null);
    }
    // Sync on open, not close — the same reason `ReadOdometerSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const km = Number.parseInt(readingKm, 10);
      return api.post<ClosedTripResponse>(`/api/trip/${tripId}/close`, {
        closingDate,
        ...(hasReading && !Number.isNaN(km) && source !== null
          ? { closingOdometerKm: km, closingOdometerSource: source }
          : {}),
      } satisfies CloseTripWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      void queryClient.invalidateQueries({ queryKey: ["trip", "in-progress"] });
      onClosed();
    },
  });

  const isAdvanceBlock =
    mutation.isError &&
    mutation.error instanceof ApiError &&
    mutation.error.code === "TRIP_ADVANCE_UNSETTLED";
  const canSave = !hasReading || (readingKm.trim() !== "" && source !== null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Close trip">
      <div className="flex flex-col gap-4">
        <DateField
          label="Closing date"
          value={closingDate}
          today={today}
          onChange={setClosingDate}
        />
        <label className="flex min-h-tap items-center gap-2">
          <input
            type="checkbox"
            checked={hasReading}
            onChange={(e) => setHasReading(e.target.checked)}
          />
          <span className="text-body text-ink-primary">Read the closing odometer now</span>
        </label>
        {hasReading ? (
          <>
            <Field label="Closing odometer (km)" htmlFor="trip-closing-odometer">
              <Input
                id="trip-closing-odometer"
                type="number"
                inputMode="numeric"
                min={0}
                value={readingKm}
                onChange={(e) => setReadingKm(e.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <Label>Source</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ODOMETER_SOURCE_LABEL) as OdometerSource[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={source === option}
                    onClick={() => setSource(option)}
                    className={chipClass(source === option)}
                  >
                    {ODOMETER_SOURCE_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
        {mutation.isError && !isAdvanceBlock ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={!canSave || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Close trip
        </Button>
      </div>

      <Dialog
        open={isAdvanceBlock}
        onOpenChange={() => mutation.reset()}
        title="An advance is still open"
        {...(mutation.error?.message !== undefined ? { description: mutation.error.message } : {})}
        footer={
          <Button size="cta" onClick={() => mutation.reset()}>
            OK
          </Button>
        }
      />
    </Sheet>
  );
}
