import { zodResolver } from "@hookform/resolvers/zod";
import { parse, toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  depositMovementRequestSchema,
  DepositResponse,
  LeaseObligationRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateField } from "../../components/DateField.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { NativeSelect } from "../../design/primitives/NativeSelect.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";

export interface DepositMovementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driverId: string;
  depositId: string | null;
  obligations: LeaseObligationRow[];
  today: BusinessDate;
}

const depositMovementFormSchema = z
  .object({
    movementType: z.enum(["topped_up", "reduced", "applied", "refunded", "retained"]),
    amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n),
    occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
    obligationId: z.string().uuid().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.movementType !== "applied" || v.obligationId !== undefined, {
    path: ["obligationId"],
    message: "Choose the arrears this deposit is being applied to",
  });
type DepositMovementFormValues = z.infer<typeof depositMovementFormSchema>;

type DepositMovementWireRequest = z.input<typeof depositMovementRequestSchema>;

const MOVEMENT_LABEL: Record<DepositMovementFormValues["movementType"], string> = {
  topped_up: "Top up",
  reduced: "Reduce",
  applied: "Apply to arrears",
  refunded: "Refund",
  retained: "Retain",
};

export function DepositMovementSheet({
  open,
  onOpenChange,
  driverId,
  depositId,
  obligations,
  today,
}: DepositMovementSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<DepositMovementFormValues>({
    resolver: zodResolver(depositMovementFormSchema),
    defaultValues: { movementType: "topped_up", occurredOn: today, reason: "" },
  });
  const movementType = watch("movementType");

  const mutation = useMutation({
    mutationFn: (values: DepositMovementFormValues) => {
      if (depositId === null) throw new Error("No held deposit is available");
      const reason = values.reason?.trim();
      return api.post<DepositResponse>(`/api/deposit/${depositId}/movement`, {
        movementType: values.movementType,
        amountMinor: toWire(values.amountMinor),
        occurredOn: values.occurredOn,
        ...(values.movementType === "applied" && values.obligationId !== undefined
          ? { obligationId: values.obligationId }
          : {}),
        ...(reason !== undefined && reason !== "" ? { reason } : {}),
      } satisfies DepositMovementWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "balances"] });
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId, "view"] });
      reset({ movementType: "topped_up", occurredOn: today, reason: "" });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Record deposit movement">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <Field
          label="Movement"
          htmlFor="deposit-movement-type"
          error={errors.movementType?.message}
        >
          <NativeSelect
            id="deposit-movement-type"
            aria-invalid={errors.movementType !== undefined}
            aria-describedby={fieldErrorId("deposit-movement-type")}
            {...register("movementType")}
          >
            {Object.entries(MOVEMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {movementType === "applied" ? (
          <Field
            label="Arrears"
            htmlFor="deposit-movement-obligation"
            error={errors.obligationId?.message}
          >
            <NativeSelect
              id="deposit-movement-obligation"
              aria-invalid={errors.obligationId !== undefined}
              aria-describedby={fieldErrorId("deposit-movement-obligation")}
              {...register("obligationId")}
            >
              <option value="">Choose arrears</option>
              {obligations.map((obligation) => {
                const outstanding = (parse(obligation.amountMinor) -
                  parse(obligation.settledMinor) -
                  parse(obligation.waivedMinor)) as Minor;
                return (
                  <option key={obligation.id} value={obligation.id}>
                    {obligation.kind} due {obligation.dueOn} - {toWire(outstanding)}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
        ) : null}
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
          name="reason"
          render={({ field }) => (
            <NoteField
              label="Reason (optional)"
              value={field.value ?? ""}
              onChange={field.onChange}
            />
          )}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending || depositId === null}>
          Record movement
        </Button>
      </form>
    </Sheet>
  );
}
