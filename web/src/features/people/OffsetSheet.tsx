import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type { createOffsetRequestSchema, OffsetResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../design/primitives/Button.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { useApi } from "../../lib/ApiContext.js";

export interface OffsetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  today: BusinessDate;
}

/** Mirrors `createOffsetRequestSchema`'s shape but keeps money/date in domain types end to end (the same fix `CreateDriverForm`'s own doc comment records) — `toWire()` converts only in `mutationFn`, at the API boundary. */
const offsetFormSchema = z.object({
  amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
  occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
  note: z.string().trim().max(500).optional(),
});
type OffsetFormValues = z.infer<typeof offsetFormSchema>;

type CreateOffsetWireRequest = z.input<typeof createOffsetRequestSchema>;

/**
 * F-6.4/UC-56/W-2: the *only* action that moves both of a driver's
 * balances — one recorded amount, a date, and an optional note, never an
 * implicit netting. INV-3's "cannot exceed what is outstanding on one side
 * or the other" is enforced server-side (400) and surfaced here, not
 * pre-validated against the two balances client-side, since a stale client
 * read of either balance would make a client-side check just as capable of
 * being wrong as no check at all.
 */
export function OffsetSheet({ open, onOpenChange, driverId, today }: OffsetSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { control, handleSubmit, reset } = useForm<OffsetFormValues>({
    resolver: zodResolver(offsetFormSchema),
    defaultValues: { occurredOn: today, note: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: OffsetFormValues) =>
      api.post<OffsetResponse>("/api/offset", {
        driverId,
        amountMinor: toWire(values.amountMinor),
        occurredOn: values.occurredOn,
        ...(values.note !== undefined && values.note !== "" ? { note: values.note } : {}),
      } satisfies CreateOffsetWireRequest),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      reset({ occurredOn: today });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Offset">
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
        <Controller
          control={control}
          name="note"
          render={({ field }) => (
            <NoteField label="Note" value={field.value ?? ""} onChange={field.onChange} />
          )}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          Record offset
        </Button>
      </form>
    </Sheet>
  );
}
