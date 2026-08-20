import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { LeaseObligationRow, WriteOffResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface WriteOffObligationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  customerId: string;
  vehicleId: string;
  due: LeaseObligationRow;
  outstandingMinor: Minor;
  today: BusinessDate;
}

/** F-8.3/UC-90: write off a concrete outstanding obligation as a loss, never as a waiver. */
export function WriteOffObligationSheet({
  open,
  onOpenChange,
  leaseId,
  customerId,
  vehicleId,
  due,
  outstandingMinor,
  today,
}: WriteOffObligationSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(outstandingMinor);
  const [reason, setReason] = useState("");
  const [writtenOffOn, setWrittenOffOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (!open) return;
    setAmountMinor(outstandingMinor);
    setReason("");
    setWrittenOffOn(today);
  }, [open, outstandingMinor, today]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<WriteOffResponse>("/api/write-off", {
        obligationId: due.id,
        partyType: "customer",
        partyCustomerId: customerId,
        vehicleId,
        amountMinor: toWire(value),
        reason: reason.trim(),
        writtenOffOn,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Write off">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (amountMinor !== null && reason.trim() !== "") mutation.mutate(amountMinor);
        }}
      >
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <Field label="Reason" htmlFor="writeOffReason">
          <Input
            id="writeOffReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <DateField
          label="Written off on"
          today={today}
          value={writtenOffOn}
          onChange={setWrittenOffOn}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={amountMinor === null || reason.trim() === "" || mutation.isPending}
        >
          Write off
        </Button>
      </form>
    </Sheet>
  );
}
