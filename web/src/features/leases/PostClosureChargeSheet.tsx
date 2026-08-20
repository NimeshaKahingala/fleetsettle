import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { PostClosureChargeResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface PostClosureChargeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { type: "lease" | "trip"; id: string };
  customerId: string;
  vehicleId: string;
  today: BusinessDate;
}

/** F-8.4/UC-91: a fine, toll or ticket that arrives after the lease is already closed. */
export function PostClosureChargeSheet({
  open,
  onOpenChange,
  source,
  customerId,
  vehicleId,
  today,
}: PostClosureChargeSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [dueOn, setDueOn] = useState<BusinessDate>(today);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmountMinor(null);
    setDueOn(today);
    setNote("");
  }, [open, today]);

  const mutation = useMutation({
    mutationFn: (value: Minor) =>
      api.post<PostClosureChargeResponse>("/api/post-closure-charge", {
        partyType: "customer",
        partyCustomerId: customerId,
        vehicleId,
        sourceType: source.type,
        sourceId: source.id,
        amountMinor: toWire(value),
        dueOn,
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      if (source.type === "lease") {
        void queryClient.invalidateQueries({ queryKey: ["lease", source.id, "obligation"] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["trip", source.id] });
      }
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId, "obligation"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record late charge">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (amountMinor !== null) mutation.mutate(amountMinor);
        }}
      >
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField label="Due on" today={today} value={dueOn} onChange={setDueOn} />
        <NoteField label="Note" value={note} onChange={setNote} />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={amountMinor === null || mutation.isPending}>
          Record charge
        </Button>
      </form>
    </Sheet>
  );
}
