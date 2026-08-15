import type { BusinessDate, Minor } from "@fleetsettle/shared";
import { toWire } from "@fleetsettle/shared";
import type { DailyLeaseRateResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface ChangeDailyLeaseRateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
  dailyLeaseId: string;
  today: BusinessDate;
}

/**
 * F-4.3/UC-32/GAP-2: "adjust the amount, and change it going forward" —
 * `effectiveFrom` defaults to today but is editable, not hard-coded, since a
 * catch-up week's own rate change usually took effect days ago. Past days
 * keep their own figure server-side; this form has no separate control for
 * that, it is simply what the write does.
 */
export function ChangeDailyLeaseRateSheet({
  open,
  onOpenChange,
  vehicleId,
  dailyLeaseId,
  today,
}: ChangeDailyLeaseRateSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [dailyLeaseAmountMinor, setDailyLeaseAmountMinor] = useState<Minor | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState<BusinessDate>(today);

  useEffect(() => {
    if (!open) return;
    setDailyLeaseAmountMinor(null);
    setEffectiveFrom(today);
    // Sync when the sheet opens; while open, user edits should stay local.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-time reset only
  }, [open]);

  const mutation = useMutation({
    mutationFn: (amountMinor: Minor) =>
      api.post<DailyLeaseRateResponse>(`/api/daily-lease/${dailyLeaseId}/rate`, {
        dailyLeaseAmountMinor: toWire(amountMinor),
        effectiveFrom,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["vehicle", vehicleId, "daily-lease"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-lease"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Change the daily lease amount">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (dailyLeaseAmountMinor !== null) mutation.mutate(dailyLeaseAmountMinor);
        }}
      >
        <MoneyField
          label="New daily lease amount"
          valueMinor={dailyLeaseAmountMinor}
          onChange={setDailyLeaseAmountMinor}
        />
        <DateField
          label="Effective from"
          today={today}
          value={effectiveFrom}
          onChange={setEffectiveFrom}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          type="submit"
          size="cta"
          disabled={dailyLeaseAmountMinor === null || mutation.isPending}
        >
          Change the daily lease amount
        </Button>
      </form>
    </Sheet>
  );
}
