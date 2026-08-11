import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { PaymentResponse, recordPaymentRequestSchema } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface PayDriverSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  today: BusinessDate;
}

const payDriverFormSchema = z.object({
  amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
  occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
});
type PayDriverFormValues = z.infer<typeof payDriverFormSchema>;

/** `z.input`, not the inferred output type — `recordPaymentRequestSchema`'s `amountMinor`/`occurredOn` transform on parse, and the wire request is the pre-transform shape (the same fix `StartDailyLeaseScreen`/`OffsetSheet` both carry in their own comments). */
type PayDriverWireRequest = z.input<typeof recordPaymentRequestSchema>;

/**
 * F-6.1/UC-50/W-34 (GAP-63) — "One tap on the trip's driver fee → paid.
 * Not everything is a trip: a retainer during a long repair, a bonus, or
 * goodwill is entered the same way with no trip attached." `POST
 * /api/payment` with `direction: "paid"` settles the driver's own
 * `owed_by_us` obligations oldest-first, exactly the way `direction:
 * "received"` already settles a customer's `owed_to_us` ones — the
 * allocation itself was already built (F-2.2); only the direction that
 * paying a driver needs was never wired to a request field. **No
 * allocation preview** — F-6.2's multi-trip breakdown-and-choose flow is a
 * distinct, larger item; this is F-6.1's own single-tap shape, and the
 * server performs the real allocation regardless of what any preview here
 * would have shown.
 */
export function PayDriverSheet({ open, onOpenChange, driverId, today }: PayDriverSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset } = useForm<PayDriverFormValues>({
    resolver: zodResolver(payDriverFormSchema),
    defaultValues: { occurredOn: today },
  });

  const mutation = useMutation({
    mutationFn: (values: PayDriverFormValues) =>
      api.post<PaymentResponse>("/api/payment", {
        direction: "paid",
        partyType: "driver",
        partyId: driverId,
        amountMinor: toWire(values.amountMinor),
        occurredOn: values.occurredOn,
      } satisfies PayDriverWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      reset({ occurredOn: today });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Pay the driver">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <Controller
          control={control}
          name="amountMinor"
          render={({ field }) => (
            <MoneyField label="Amount" valueMinor={field.value ?? null} onChange={field.onChange} />
          )}
        />
        <Controller
          control={control}
          name="occurredOn"
          render={({ field }) => (
            <DateField label="Date" value={field.value} onChange={field.onChange} today={today} />
          )}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Pay driver
        </Button>
      </form>
    </Sheet>
  );
}
