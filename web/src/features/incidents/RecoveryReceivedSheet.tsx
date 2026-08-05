import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { IncidentRecoveryResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface RecoveryReceivedSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  recoveryId: string;
  agreedAmountMinor: Minor;
  receivedAmountMinor: Minor;
  today: BusinessDate;
  onRecorded: () => void;
}

/**
 * F-3.4 steps 4/5: the customer's money actually arriving, against the
 * recovery row `CustomerContributionSheet` already agreed. `receivedAmountMinor`
 * is a total-so-far, not an increment (the endpoint overwrites, it does not
 * add) — pre-filled at the current figure (or the agreed amount, if nothing
 * has arrived yet) so a single, full payment needs no arithmetic and a
 * partial one is edited in place.
 */
export function RecoveryReceivedSheet({
  open,
  onOpenChange,
  incidentId,
  recoveryId,
  agreedAmountMinor,
  receivedAmountMinor,
  today,
  onRecorded,
}: RecoveryReceivedSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const initialMinor = receivedAmountMinor > 0n ? receivedAmountMinor : agreedAmountMinor;
  const [amountMinor, setAmountMinor] = useState<Minor>(initialMinor);
  const [receivedOn, setReceivedOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (open) {
      setAmountMinor(initialMinor);
      setReceivedOn(today);
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<IncidentRecoveryResponse>(
        `/api/incident/${incidentId}/recovery/${recoveryId}/receive`,
        { receivedAmountMinor: toWire(amountMinor), receivedOn },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      onRecorded();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Mark received">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-muted">
          Agreed <Money value={agreedAmountMinor} />
        </p>
        <MoneyField
          label="Received so far"
          valueMinor={amountMinor}
          onChange={setAmountMinor}
          expectedMinor={agreedAmountMinor}
        />
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
