import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { DepositResponse, takeDriverDepositRequestSchema } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface DepositSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  today: BusinessDate;
}

const depositFormSchema = z.object({
  amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
  occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
});
type DepositFormValues = z.infer<typeof depositFormSchema>;

/** `z.input`, not the inferred output type — see `PayDriverSheet`'s own comment for why. */
type TakeDriverDepositWireRequest = z.input<typeof takeDriverDepositRequestSchema>;

/**
 * F-6.7/UC-58/W-8 (GAP-66) — "Record it." `POST /api/deposit` exists;
 * nothing has ever called it. **INV-4: never income, in any month** —
 * this write only ever records money held, and `movement` (refund /
 * apply against arrears / top up) is a separate, deliberate action this
 * screen does not offer, matching F-6.7's own "never automatic" rule.
 */
export function DepositSheet({ open, onOpenChange, driverId, today }: DepositSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset } = useForm<DepositFormValues>({
    resolver: zodResolver(depositFormSchema),
    defaultValues: { occurredOn: today },
  });

  const mutation = useMutation({
    mutationFn: (values: DepositFormValues) =>
      api.post<DepositResponse>("/api/deposit", {
        driverId,
        amountMinor: toWire(values.amountMinor),
        occurredOn: values.occurredOn,
      } satisfies TakeDriverDepositWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      reset({ occurredOn: today });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record a deposit">
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
          Record deposit
        </Button>
      </form>
    </Sheet>
  );
}
