import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type Minor } from "@fleetsettle/shared";
import type { createDriverRequestSchema, DriverResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { MoneyField } from "../../components/MoneyField.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { blankToUndefined } from "../../lib/optionalTextField.js";

export interface CreateDriverFormProps {
  onCreated: (driver: DriverResponse) => void;
}

/**
 * `createDriverRequestSchema`'s `moneyWireSchema` transforms a wire string
 * into `Minor` — the right shape for validating a request the Worker
 * receives, the wrong one for a form whose `MoneyField` control already
 * produces `Minor` directly (never a `number`, CLAUDE.md → Money). This
 * schema mirrors the request shape but keeps money as `Minor` end to end
 * in the form's own state; `toWire()` converts it back to the wire string
 * only in `mutationFn`, at the actual API boundary.
 */
const driverFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  mobile: z.string().trim().min(1).max(30).optional(),
  driverDayFeeMinor: z.custom<Minor>((v) => typeof v === "bigint").optional(),
  driverTripFeeMinor: z.custom<Minor>((v) => typeof v === "bigint").optional(),
});
type DriverFormValues = z.infer<typeof driverFormSchema>;

/** The wire shape `createDriverRequestSchema` actually validates on arrival — money as strings, the schema's `z.input` side rather than its `z.output` (`Minor`). */
type CreateDriverWireRequest = z.input<typeof createDriverRequestSchema>;

/** F-1.6 / UC-04: only `name` is required (U-2/M-6) — the fee figures and mobile number are real fields on the same form, but level 2, behind `Disclosure`. */
export function CreateDriverForm({ onCreated }: CreateDriverFormProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: { name: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: DriverFormValues) =>
      api.post<DriverResponse>("/api/driver", {
        name: values.name,
        ...(values.mobile !== undefined ? { mobile: values.mobile } : {}),
        ...(values.driverDayFeeMinor !== undefined
          ? { driverDayFeeMinor: toWire(values.driverDayFeeMinor) }
          : {}),
        ...(values.driverTripFeeMinor !== undefined
          ? { driverTripFeeMinor: toWire(values.driverTripFeeMinor) }
          : {}),
      } satisfies CreateDriverWireRequest),
    onSuccess: (driver) => {
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
      onCreated(driver);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
    >
      <Field label="Name" htmlFor="name" error={errors.name?.message}>
        <Input
          id="name"
          aria-invalid={errors.name !== undefined}
          aria-describedby={fieldErrorId("name")}
          {...register("name")}
        />
      </Field>

      <Disclosure sectionName="Fees and mobile">
        <div className="flex flex-col gap-4">
          <Field label="Mobile" htmlFor="mobile" optional error={errors.mobile?.message}>
            <Input
              id="mobile"
              aria-invalid={errors.mobile !== undefined}
              aria-describedby={fieldErrorId("mobile")}
              {...register("mobile", blankToUndefined)}
            />
          </Field>
          <Controller
            control={control}
            name="driverDayFeeMinor"
            render={({ field }) => (
              <MoneyField
                label="Driver day fee"
                valueMinor={field.value ?? null}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </Disclosure>

      {mutation.isError ? (
        <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
      ) : null}
      <Button type="submit" size="cta" disabled={mutation.isPending}>
        Add driver
      </Button>
    </form>
  );
}
