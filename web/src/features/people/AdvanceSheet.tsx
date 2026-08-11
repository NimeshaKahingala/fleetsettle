import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { AdvanceResponse, issueAdvanceRequestSchema } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";

export interface AdvanceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  tripId?: string;
  today: BusinessDate;
  title?: string;
}

const advanceFormSchema = z.object({
  amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
  issuedOn: z.custom<BusinessDate>((v) => typeof v === "string"),
});
type AdvanceFormValues = z.infer<typeof advanceFormSchema>;

/** `z.input`, not the inferred output type — see `PayDriverSheet`'s own comment for why. */
type IssueAdvanceWireRequest = z.input<typeof issueAdvanceRequestSchema>;

/**
 * F-6.3/UC-53 (GAP-64) — "Record the advance → afterwards: what he spent,
 * what he returned, anything agreed to keep as fee. The advance closes at
 * zero." `POST /api/advance` exists and can optionally carry a trip id. The
 * staff driver screen records a driver-level advance; Trip detail passes its
 * own id so INV-17's trip-scoped close block can become reachable in the
 * product instead of only in integration tests.
 */
export function AdvanceSheet({
  open,
  onOpenChange,
  driverId,
  tripId,
  today,
  title = "Record an advance",
}: AdvanceSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset } = useForm<AdvanceFormValues>({
    resolver: zodResolver(advanceFormSchema),
    defaultValues: { issuedOn: today },
  });

  const mutation = useMutation({
    mutationFn: (values: AdvanceFormValues) =>
      api.post<AdvanceResponse>("/api/advance", {
        driverId,
        ...(tripId !== undefined ? { tripId } : {}),
        amountMinor: toWire(values.amountMinor),
        issuedOn: values.issuedOn,
      } satisfies IssueAdvanceWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      if (tripId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ["trip", tripId] });
      }
      reset({ issuedOn: today });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}>
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
          name="issuedOn"
          render={({ field }) => (
            <DateField label="Date" value={field.value} onChange={field.onChange} today={today} />
          )}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Record advance
        </Button>
      </form>
    </Sheet>
  );
}
