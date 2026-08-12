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

export interface QuickPaymentParty {
  partyType: "customer" | "driver";
  partyId: string;
  label: string;
}

export interface QuickPaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  direction: "received" | "paid";
  party: QuickPaymentParty | null;
  today: BusinessDate;
  onRecorded: () => void;
}

const quickPaymentFormSchema = z.object({
  amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
  occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
});
type QuickPaymentFormValues = z.infer<typeof quickPaymentFormSchema>;
type QuickPaymentWireRequest = z.input<typeof recordPaymentRequestSchema>;

function titleFor(direction: "received" | "paid"): string {
  return direction === "received" ? "Record payment received" : "Record payment made";
}

function submitLabelFor(direction: "received" | "paid"): string {
  return direction === "received" ? "Record payment" : "Record payment made";
}

/**
 * B15/GAP-82: Quick Add's payment form once a party has been picked.
 * Partner payouts intentionally stay with the partner/cash screens (F-7.2);
 * the quick form handles the two phase-1 daily cases M-4 names directly:
 * money received from a customer/driver, and money paid to a driver.
 */
export function QuickPaymentSheet({
  open,
  onOpenChange,
  direction,
  party,
  today,
  onRecorded,
}: QuickPaymentSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset } = useForm<QuickPaymentFormValues>({
    resolver: zodResolver(quickPaymentFormSchema),
    defaultValues: { occurredOn: today },
  });

  const mutation = useMutation({
    mutationFn: (values: QuickPaymentFormValues) => {
      if (party === null) throw new Error("Choose who this payment is for");
      return api.post<PaymentResponse>("/api/payment", {
        direction,
        partyType: party.partyType,
        partyId: party.partyId,
        amountMinor: toWire(values.amountMinor),
        occurredOn: values.occurredOn,
      } satisfies QuickPaymentWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payment"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      if (party?.partyType === "customer") {
        void queryClient.invalidateQueries({ queryKey: ["customer", party.partyId] });
      }
      if (party?.partyType === "driver") {
        void queryClient.invalidateQueries({ queryKey: ["driver", party.partyId] });
        void queryClient.invalidateQueries({ queryKey: ["driver", party.partyId, "balances"] });
        void queryClient.invalidateQueries({ queryKey: ["driver", party.partyId, "view"] });
        void queryClient.invalidateQueries({ queryKey: ["driver-view"] });
      }
      reset({ occurredOn: today });
      onRecorded();
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={titleFor(direction)}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        {party !== null ? (
          <p className="text-body-sm text-ink-secondary">{party.label}</p>
        ) : (
          <p className="text-body-sm text-critical-ink">Choose who this payment is for.</p>
        )}
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
        <Button type="submit" size="cta" disabled={mutation.isPending || party === null}>
          {submitLabelFor(direction)}
        </Button>
      </form>
    </Sheet>
  );
}
