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
  today: BusinessDate;
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
 * zero." `POST /api/advance` exists and settlement already works
 * (`CloseTripSheet` enforces INV-17 against an open one); recording was
 * the missing half. **No trip picker** — `tripId` is optional on the
 * request schema and F-6.3's own text doesn't require one ("advance before
 * a trip, settle after" is the common case, but W-34/UC-50 already
 * establishes a driver-money action need not name a trip); wiring a trip
 * link here without a trip in context on this screen would be a picker
 * with nothing to constrain its choices to relevance.
 */
export function AdvanceSheet({ open, onOpenChange, driverId, today }: AdvanceSheetProps) {
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
        amountMinor: toWire(values.amountMinor),
        issuedOn: values.issuedOn,
      } satisfies IssueAdvanceWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      reset({ issuedOn: today });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record an advance">
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
