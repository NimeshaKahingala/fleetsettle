import { parse, type BusinessDate } from "@fleetsettle/shared";
import type {
  MileageAssessmentResponse,
  OdometerSource,
  recordOdometerReadingRequestSchema,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface ReadOdometerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  today: BusinessDate;
}

type OdometerWireRequest = z.input<typeof recordOdometerReadingRequestSchema>;

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
 * F-2.3/UC-14: enter a reading + source; the system shows km used, the
 * combined allowance, and the excess this produced — charging it, waiving
 * it (F-2.4, from the lease hub's own Dues list once this closes) or
 * letting the auto-waive threshold absorb it are all the *same* fact
 * (`isEstimated`/`autoWaived` on the response), never three separate
 * screens. Which billing period(s) this closes out is derived server-side
 * (INV-26's combined-assessment case) — this sheet never picks one.
 */
export function ReadOdometerSheet({ open, onOpenChange, leaseId, today }: ReadOdometerSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [readingKm, setReadingKm] = useState("");
  const [readOn, setReadOn] = useState<BusinessDate>(today);
  const [source, setSource] = useState<OdometerSource | null>(null);
  const [result, setResult] = useState<MileageAssessmentResponse | null>(null);

  useEffect(() => {
    if (open) {
      setReadingKm("");
      setReadOn(today);
      setSource(null);
      setResult(null);
    }
    // Sync on open, not close — the same reason `CollectPaymentSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      const km = Number.parseInt(readingKm, 10);
      if (Number.isNaN(km) || source === null) {
        throw new Error("a reading and its source are required");
      }
      return api.post<MileageAssessmentResponse>("/api/mileage-assessment", {
        leaseId,
        readingKm: km,
        readOn,
        source,
      } satisfies OdometerWireRequest);
    },
    onSuccess: (assessment) => {
      setResult(assessment);
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "obligation"] });
    },
  });

  const canSave = readingKm.trim() !== "" && source !== null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Read the odometer">
      {result === null ? (
        <div className="flex flex-col gap-4">
          <DateField label="Date" value={readOn} onChange={setReadOn} today={today} />
          <Field label="Reading (km)" htmlFor="odometer-reading">
            <Input
              id="odometer-reading"
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
          {mutation.isError ? (
            <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
          ) : null}
          <Button
            size="cta"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save reading
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-body-sm text-ink-secondary">Driven</span>
            <span className="text-body text-ink-primary">{result.drivenKm} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body-sm text-ink-secondary">Allowance</span>
            <span className="text-body text-ink-primary">{result.combinedAllowanceKm} km</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body-sm text-ink-secondary">Excess</span>
            <span className="text-body text-ink-primary">
              {result.excessKm} km · <Money value={parse(result.excessAmountMinor)} />
            </span>
          </div>
          {result.isEstimated ? (
            <p className="text-caption text-ink-muted">
              Estimated — apportioned by days until the next boundary reading arrives (INV-26).
            </p>
          ) : null}
          {result.autoWaived ? (
            <p className="text-caption text-ink-muted">
              Below the auto-waive threshold — recorded as waived automatically.
            </p>
          ) : null}
          <Button size="cta" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      )}
    </Sheet>
  );
}
