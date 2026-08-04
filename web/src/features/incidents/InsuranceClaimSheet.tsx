import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { InsuranceClaimResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface InsuranceClaimSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  today: BusinessDate;
  onSubmitted: () => void;
}

/**
 * F-3.4 step 5/W-11: "hidden unless enabled — major damage only." No
 * business setting for that toggle exists anywhere in the schema yet (a
 * real gap, found while building this screen, not guessed at here) — this
 * action is always offered, the same way it always was before this pass,
 * rather than inventing a settings field this increment doesn't own.
 */
export function InsuranceClaimSheet({
  open,
  onOpenChange,
  incidentId,
  today,
  onSubmitted,
}: InsuranceClaimSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [claimedAmountMinor, setClaimedAmountMinor] = useState<Minor | null>(null);
  const [excessBorneMinor, setExcessBorneMinor] = useState<Minor | null>(null);
  const [claimedOn, setClaimedOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (open) {
      setClaimedAmountMinor(null);
      setExcessBorneMinor(null);
      setClaimedOn(today);
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<InsuranceClaimResponse>(`/api/incident/${incidentId}/insurance-claim`, {
        claimedAmountMinor: toWire(value),
        ...(excessBorneMinor !== null ? { excessBorneMinor: toWire(excessBorneMinor) } : {}),
        claimedOn,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      onSubmitted();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Submit insurance claim">
      <div className="flex flex-col gap-4">
        <MoneyField
          label="Amount claimed"
          valueMinor={claimedAmountMinor}
          onChange={setClaimedAmountMinor}
        />
        <MoneyField
          label="Excess you bear"
          valueMinor={excessBorneMinor}
          onChange={setExcessBorneMinor}
        />
        <DateField label="Claimed on" value={claimedOn} today={today} onChange={setClaimedOn} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={claimedAmountMinor === null || mutation.isPending}
          onClick={() => {
            if (claimedAmountMinor !== null) mutation.mutate(claimedAmountMinor);
          }}
        >
          Submit claim
        </Button>
      </div>
    </Sheet>
  );
}
