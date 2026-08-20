import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { WriteOffRecoveryResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface WriteOffRecoverySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  writeOffId: string;
  party: { type: "customer" | "driver"; id: string };
  today: BusinessDate;
}

/** UC-90/INV-15: later money against a written-off loss is recovery, not fresh income. */
export function WriteOffRecoverySheet({
  open,
  onOpenChange,
  writeOffId,
  party,
  today,
}: WriteOffRecoverySheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [occurredOn, setOccurredOn] = useState<BusinessDate>(today);

  useEffect(() => {
    if (!open) return;
    setAmountMinor(null);
    setOccurredOn(today);
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<WriteOffRecoveryResponse>(`/api/write-off/${writeOffId}/recovery`, {
        amountMinor: toWire(value),
        occurredOn,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["write-off"] });
      if (party.type === "customer") {
        void queryClient.invalidateQueries({ queryKey: ["customer", party.id, "payment"] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "balances"] });
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "view"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["payment"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record recovery">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (amountMinor !== null) mutation.mutate(amountMinor);
        }}
      >
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField label="Received on" today={today} value={occurredOn} onChange={setOccurredOn} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={amountMinor === null || mutation.isPending}>
          Record recovery
        </Button>
      </form>
    </Sheet>
  );
}
