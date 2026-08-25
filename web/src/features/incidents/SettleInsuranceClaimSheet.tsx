import { subtract, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { SettledInsuranceClaimResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface SettleInsuranceClaimSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  claimId: string;
  claimedAmountMinor: Minor;
  excessBorneMinor: Minor;
  receivedAmountMinor: Minor | null;
  today: BusinessDate;
  onSettled: () => void;
}

const STATUS_OPTIONS: { value: "settled" | "rejected"; label: string }[] = [
  { value: "settled", label: "Settled" },
  { value: "rejected", label: "Rejected" },
];

/**
 * F-3.4 step 5, later — often after the claim's own posted period has
 * closed (§7.2's own July→September span), which is why the underlying
 * endpoint stays legal past that point (migration 0006). Recoverable
 * (claimed minus excess) is shown for reference only — it is not what gets
 * submitted; what actually arrived is its own figure, pending recovery
 * until it does (W-10/W-11).
 */
export function SettleInsuranceClaimSheet({
  open,
  onOpenChange,
  incidentId,
  claimId,
  claimedAmountMinor,
  excessBorneMinor,
  receivedAmountMinor,
  today,
  onSettled,
}: SettleInsuranceClaimSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const recoverableMinor = subtract(claimedAmountMinor, excessBorneMinor);
  const initialMinor = receivedAmountMinor ?? recoverableMinor;
  const [amountMinor, setAmountMinor] = useState<Minor>(initialMinor);
  const [receivedOn, setReceivedOn] = useState<BusinessDate>(today);
  const [status, setStatus] = useState<"settled" | "rejected">("settled");

  useEffect(() => {
    if (open) {
      setAmountMinor(initialMinor);
      setReceivedOn(today);
      setStatus("settled");
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<SettledInsuranceClaimResponse>(
        `/api/incident/${incidentId}/insurance-claim/${claimId}/settle`,
        { receivedAmountMinor: toWire(amountMinor), receivedOn, status },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      onSettled();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Settle insurance claim">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-muted">
          Recoverable <Money value={recoverableMinor} />
        </p>
        <div className="flex flex-col gap-2">
          <Label>Outcome</Label>
          <div className="flex gap-2">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setStatus(option.value)}
                className={cn(
                  "min-h-tap flex-1 rounded-sm border px-3 text-body",
                  status === option.value
                    ? "border-brand bg-brand-wash text-brand-ink"
                    : "border-transparent bg-surface-sunken text-ink-primary",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {/* GAP-180: "Received so far", matching `RecoveryReceivedSheet`'s
            identical field. `settleInsuranceClaim` **overwrites**
            `received_amount_minor` rather than adding to it, so "Amount
            received" invited a second part-settlement to be typed as the
            new instalment — which would replace the running total with it
            and under-report every earlier payment. */}
        <MoneyField label="Received so far" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField label="Received on" value={receivedOn} today={today} onChange={setReceivedOn} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button size="cta" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}
