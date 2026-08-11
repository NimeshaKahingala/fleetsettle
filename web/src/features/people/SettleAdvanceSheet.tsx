import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  AdvanceResponse,
  DriverViewAdvance,
  settleAdvanceRequestSchema,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface SettleAdvanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  advance: DriverViewAdvance | null;
  today: BusinessDate;
}

type SettlementKind = "spent" | "returned" | "kept_as_fee";
type SettleAdvanceWireRequest = z.input<typeof settleAdvanceRequestSchema>;

const SETTLEMENT_KIND_LABEL: Record<SettlementKind, string> = {
  spent: "Spent",
  returned: "Returned",
  kept_as_fee: "Kept as fee",
};

/**
 * GAP-100/B13 remainder: the API can settle an advance, and `CloseTripSheet`
 * blocks on unsettled trip advances, but the client had no caller. The staff
 * screen can reconcile open/part-settled advances; Mine stays read-only.
 */
export function SettleAdvanceSheet({
  open,
  onOpenChange,
  driverId,
  advance,
  today,
}: SettleAdvanceSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SettlementKind>("spent");
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [occurredOn, setOccurredOn] = useState<BusinessDate>(today);

  const mutation = useMutation({
    mutationFn: () => {
      if (advance === null) throw new Error("Choose an advance");
      if (amountMinor === null) throw new Error("Enter an amount");
      return api.post<AdvanceResponse>(`/api/advance/${advance.id}/settle`, {
        kind,
        amountMinor: toWire(amountMinor),
        occurredOn,
      } satisfies SettleAdvanceWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      setKind("spent");
      setAmountMinor(null);
      setOccurredOn(today);
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (!open) return;
    mutation.reset();
    setKind("spent");
    setAmountMinor(null);
    setOccurredOn(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation.reset is stable enough for this open-reset effect; including the mutation object resets on each render.
  }, [open, today]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Settle advance">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          {(["spent", "returned", "kept_as_fee"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={
                kind === value
                  ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                  : "min-h-tap rounded-sm border border-line-strong px-2 text-body-sm text-ink-primary"
              }
            >
              {SETTLEMENT_KIND_LABEL[value]}
            </button>
          ))}
        </div>
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField label="Date" value={occurredOn} today={today} onChange={setOccurredOn} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={amountMinor === null || mutation.isPending}>
          Save settlement
        </Button>
      </form>
    </Sheet>
  );
}
