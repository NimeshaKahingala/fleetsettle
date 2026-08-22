import { toWire, type Minor } from "@fleetsettle/shared";
import type {
  AdjustmentResponse,
  AdjustmentType,
  LeaseObligationRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Label } from "../../design/primitives/Label.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface AdjustObligationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  due: LeaseObligationRow;
}

/** F-2.4's own named reasons, plus "Waive" — never `auto_waiver`, which only the auto-waive-threshold cron writes (domain/mileage.ts). */
const TYPE_OPTIONS: { value: AdjustmentType; label: string; sign: 1 | -1 }[] = [
  { value: "waiver", label: "Waive", sign: -1 },
  { value: "goodwill", label: "Goodwill", sign: -1 },
  { value: "rounding", label: "Rounding", sign: -1 },
  { value: "agreed_discount", label: "Agreed discount", sign: -1 },
  { value: "late_fee", label: "Late fee", sign: 1 },
  { value: "extra_charge", label: "Extra charge", sign: 1 },
];

/**
 * F-2.4/UC-15/W-17: "adjustment ± with a reason... or waive in full or
 * part." One form for both — the type chip carries a default direction
 * (waivers and discounts reduce, fees and charges increase), still
 * overridable except for a waiver, which the schema itself pins to -1
 * (DM §10.3). A waiver is never a deletion: the due keeps its original
 * `amountMinor` and gains a `waivedMinor` instead (INV-14 — never shares a
 * bucket with a write-off).
 */
export function AdjustObligationSheet({
  open,
  onOpenChange,
  leaseId,
  due,
}: AdjustObligationSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("waiver");
  const [sign, setSign] = useState<1 | -1>(-1);
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) {
      setAdjustmentType("waiver");
      setSign(-1);
      setAmountMinor(null);
      setReason("");
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<AdjustmentResponse>("/api/adjustment", {
        obligationId: due.id,
        adjustmentType,
        amountMinor: toWire(value),
        sign,
        ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "obligation"] });
      onOpenChange(false);
    },
  });

  const isWaiver = adjustmentType === "waiver";

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Adjust or waive">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Type</Label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={adjustmentType === option.value}
                onClick={() => {
                  setAdjustmentType(option.value);
                  setSign(option.sign);
                }}
                className={cn(
                  "min-h-tap rounded-sm border px-3 text-body",
                  adjustmentType === option.value
                    ? "border-brand bg-brand-wash text-brand-ink"
                    : "border-transparent bg-surface-sunken text-ink-primary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {!isWaiver ? (
          <div className="flex flex-col gap-2">
            <Label>Direction</Label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={sign === -1}
                onClick={() => setSign(-1)}
                className={cn(
                  "min-h-tap flex-1 rounded-sm border px-3 text-body",
                  sign === -1
                    ? "border-brand bg-brand-wash text-brand-ink"
                    : "border-transparent bg-surface-sunken text-ink-primary",
                )}
              >
                Reduces what's owed
              </button>
              <button
                type="button"
                aria-pressed={sign === 1}
                onClick={() => setSign(1)}
                className={cn(
                  "min-h-tap flex-1 rounded-sm border px-3 text-body",
                  sign === 1
                    ? "border-brand bg-brand-wash text-brand-ink"
                    : "border-transparent bg-surface-sunken text-ink-primary",
                )}
              >
                Adds to what's owed
              </button>
            </div>
          </div>
        ) : null}

        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <NoteField label="Reason" value={reason} onChange={setReason} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={amountMinor === null || mutation.isPending}
          onClick={() => {
            if (amountMinor !== null) mutation.mutate(amountMinor);
          }}
        >
          Save adjustment
        </Button>
      </div>
    </Sheet>
  );
}
