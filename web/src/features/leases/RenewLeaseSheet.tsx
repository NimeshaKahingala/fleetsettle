import { toWire, type Minor } from "@fleetsettle/shared";
import type { renewLeaseRequestSchema, LeaseResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

/** `RenewLeaseRequest` (the schema's `z.infer`/output type) is post-transform — `Minor`, not the wire string this call actually sends. `z.input` is the pre-transform shape, the same fix `OffsetSheet`'s own doc comment already records for the identical mismatch. */
type RenewLeaseWireRequest = z.input<typeof renewLeaseRequestSchema>;

export interface RenewLeaseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leaseId: string;
  currentRentMinor: Minor;
}

/**
 * F-2.5/UC-17: same customer, new agreed amount from a date — no date
 * field on this form at all, because `renewLease` has none to take:
 * already-generated billing periods are frozen at their own figure, and
 * this only changes what the *next* one picks up. Mileage terms are level
 * 2, same as F-2.1's own form — leaving them blank keeps the lease's
 * existing terms untouched (`renewLeaseRequestSchema`'s fields are all
 * optional past rent).
 */
export function RenewLeaseSheet({
  open,
  onOpenChange,
  leaseId,
  currentRentMinor,
}: RenewLeaseSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [rentAmountMinor, setRentAmountMinor] = useState<Minor | null>(currentRentMinor);
  const [mileageDailyLimitKm, setMileageDailyLimitKm] = useState("");
  const [mileageExcessRateMinor, setMileageExcessRateMinor] = useState<Minor | null>(null);

  useEffect(() => {
    if (!open) {
      setRentAmountMinor(currentRentMinor);
      setMileageDailyLimitKm("");
      setMileageExcessRateMinor(null);
    }
    // Reset only on close — `currentRentMinor` is read once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset-on-close only, see above
  }, [open]);

  const mutation = useMutation({
    mutationFn: (value: Minor) => {
      const limitKm = Number.parseInt(mileageDailyLimitKm, 10);
      return api.patch<LeaseResponse>(`/api/lease/${leaseId}/renew`, {
        rentAmountMinor: toWire(value),
        ...(mileageDailyLimitKm.trim() !== "" && !Number.isNaN(limitKm)
          ? { mileageDailyLimitKm: limitKm }
          : {}),
        ...(mileageExcessRateMinor !== null
          ? { mileageExcessRateMinor: toWire(mileageExcessRateMinor) }
          : {}),
      } satisfies RenewLeaseWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["lease", leaseId] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Renew">
      <div className="flex flex-col gap-4">
        <MoneyField
          label="New monthly amount"
          valueMinor={rentAmountMinor}
          onChange={setRentAmountMinor}
        />

        <Disclosure sectionName="Mileage terms">
          <div className="flex flex-col gap-4">
            <Field label="Daily km limit" htmlFor="renew-mileage-limit">
              <Input
                id="renew-mileage-limit"
                type="number"
                inputMode="numeric"
                min={1}
                value={mileageDailyLimitKm}
                onChange={(e) => setMileageDailyLimitKm(e.target.value)}
              />
            </Field>
            <MoneyField
              label="Excess fee per km"
              valueMinor={mileageExcessRateMinor}
              onChange={setMileageExcessRateMinor}
            />
          </div>
        </Disclosure>

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          disabled={rentAmountMinor === null || mutation.isPending}
          onClick={() => {
            if (rentAmountMinor !== null) mutation.mutate(rentAmountMinor);
          }}
        >
          Save new terms
        </Button>
      </div>
    </Sheet>
  );
}
