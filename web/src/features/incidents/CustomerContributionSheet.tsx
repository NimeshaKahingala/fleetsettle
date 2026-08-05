import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { IncidentRecoveryResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface CustomerContributionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: string;
  today: BusinessDate;
  onRecorded: () => void;
}

/**
 * F-3.4 step 4/W-10: negotiated *after* the repair cost is known — agreed
 * amount plus a note, entered whenever that agreement happens, days or
 * weeks after the incident opened (§6.6). *How* it gets paid — one go,
 * instalments, or from the deposit — is not a distinct field: the money
 * arriving is `RecoveryReceivedSheet`'s own, separate step (4/5), matching
 * `agreedAmountMinor`/`receivedAmountMinor` staying two separate facts on
 * the wire, never collapsed.
 */
export function CustomerContributionSheet({
  open,
  onOpenChange,
  incidentId,
  today,
  onRecorded,
}: CustomerContributionSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [agreedAmountMinor, setAgreedAmountMinor] = useState<Minor | null>(null);
  const [agreedOn, setAgreedOn] = useState<BusinessDate>(today);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setAgreedAmountMinor(null);
      setAgreedOn(today);
      setNote("");
    }
    // Sync on open, not close — the same reason `CloseTripSheet` does.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync-on-open only
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<IncidentRecoveryResponse>(`/api/incident/${incidentId}/customer-contribution`, {
        agreedAmountMinor: toWire(value),
        agreedOn,
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      onRecorded();
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Customer contribution">
      <div className="flex flex-col gap-4">
        <MoneyField
          label="Agreed amount"
          valueMinor={agreedAmountMinor}
          onChange={setAgreedAmountMinor}
        />
        <DateField label="Agreed on" value={agreedOn} today={today} onChange={setAgreedOn} />
        <NoteField label="Note" value={note} onChange={setNote} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={agreedAmountMinor === null || mutation.isPending}
          onClick={() => {
            if (agreedAmountMinor !== null) mutation.mutate(agreedAmountMinor);
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
  );
}
