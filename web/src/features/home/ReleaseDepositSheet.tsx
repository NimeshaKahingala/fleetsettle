import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  releaseDepositRequestSchema,
  ReleaseDepositResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { DateAndReasonFields } from "../../components/DateAndReasonFields.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Label } from "../../design/primitives/Label.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";

export interface ReleaseDepositSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  depositId: string;
  heldMinor: Minor;
  today: BusinessDate;
}

/**
 * GAP-230/F-2.7: only "refund" and "retain" are offered here — the same
 * subset `CloseLeaseScreen`'s own step 3 exposes (its own `depositAction`
 * never includes "apply" either). "apply" stays a backend-only capability
 * on this endpoint too, consistent with that precedent rather than a new
 * one; nothing has asked for an obligation picker on this screen.
 */
const releaseDepositFormSchema = z
  .object({
    action: z.enum(["refund", "retain"]),
    amountMinor: z.custom<Minor>((v) => typeof v === "bigint" && v > 0n).optional(),
    occurredOn: z.custom<BusinessDate>((v) => typeof v === "string"),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== "retain" || v.amountMinor !== undefined, {
    path: ["amountMinor"],
    message: "Amount to retain is required",
  });
type ReleaseDepositFormValues = z.infer<typeof releaseDepositFormSchema>;

type ReleaseDepositWireRequest = z.input<typeof releaseDepositRequestSchema>;

/** The same two-state toggle chip `CloseLeaseScreen`'s own deposit step already draws — kept local rather than shared, matching that precedent. */
function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * GAP-230/F-2.7: the one operation that can move money out of a `hold_window`
 * deposit — the owner's own answer, 13 Sept 2026, on where it lives:
 * `DepositReleasesScreen`, not the party's own detail screen. "Retain" needs
 * only a reason, never a linked charge (the owner's second answer) — this
 * form never asks for one. Early release is allowed (the third answer):
 * nothing here checks the deposit's own release date.
 */
export function ReleaseDepositSheet({
  open,
  onOpenChange,
  depositId,
  heldMinor,
  today,
}: Readonly<ReleaseDepositSheetProps>) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    control,
    formState: { errors },
    handleSubmit,
    reset,
    setValue,
    watch,
  } = useForm<ReleaseDepositFormValues>({
    resolver: zodResolver(releaseDepositFormSchema),
    defaultValues: { action: "refund", occurredOn: today, reason: "" },
  });
  const action = watch("action");
  const occurredOn = watch("occurredOn");
  const reason = watch("reason") ?? "";

  useEffect(() => {
    if (open) reset({ action: "refund", occurredOn: today, reason: "" });
  }, [open, reset, today]);

  const mutation = useMutation({
    mutationFn: (values: ReleaseDepositFormValues) => {
      const reason = values.reason?.trim();
      return api.post<ReleaseDepositResponse>(`/api/deposit/${depositId}/release`, {
        action: values.action,
        ...(values.action === "retain" && values.amountMinor !== undefined
          ? { amountMinor: toWire(values.amountMinor) }
          : {}),
        occurredOn: values.occurredOn,
        ...(reason !== undefined && reason !== "" ? { reason } : {}),
      } satisfies ReleaseDepositWireRequest);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home", "deposit-releases"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Release this deposit">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
      >
        <Card className="flex items-center justify-between gap-4">
          <p className="text-body text-ink-primary">Currently held</p>
          <Money value={heldMinor} />
        </Card>

        <div className="flex flex-col gap-2">
          <Label>Action</Label>
          <Controller
            control={control}
            name="action"
            render={({ field }) => (
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={field.value === "refund"}
                  onClick={() => {
                    field.onChange("refund");
                  }}
                  className={cn(chipClass(field.value === "refund"), "flex-1")}
                >
                  Refund
                </button>
                <button
                  type="button"
                  aria-pressed={field.value === "retain"}
                  onClick={() => {
                    field.onChange("retain");
                  }}
                  className={cn(chipClass(field.value === "retain"), "flex-1")}
                >
                  Retain
                </button>
              </div>
            )}
          />
        </div>

        {action === "retain" ? (
          <div className="flex flex-col gap-1">
            <Controller
              control={control}
              name="amountMinor"
              render={({ field }) => (
                <MoneyField
                  label="Amount to retain"
                  valueMinor={field.value ?? null}
                  onChange={field.onChange}
                />
              )}
            />
            {errors.amountMinor ? (
              <p className="text-body-sm text-critical-ink">{errors.amountMinor.message}</p>
            ) : null}
          </div>
        ) : null}

        <DateAndReasonFields
          occurredOn={occurredOn}
          onOccurredOnChange={(value) => {
            setValue("occurredOn", value);
          }}
          reason={reason}
          onReasonChange={(value) => {
            setValue("reason", value);
          }}
          today={today}
        />

        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          {action === "refund" ? "Refund the deposit" : "Retain and release the rest"}
        </Button>
      </form>
    </Sheet>
  );
}
