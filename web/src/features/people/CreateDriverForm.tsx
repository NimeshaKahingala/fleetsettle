import { zodResolver } from "@hookform/resolvers/zod";
import { toWire, type Minor } from "@fleetsettle/shared";
import type { createDriverRequestSchema, DriverResponse } from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { NativeSelect } from "../../design/primitives/NativeSelect.js";
import { MoneyField } from "../../components/MoneyField.js";
import { useApi } from "../../lib/ApiContext.js";
import { cn } from "../../lib/cn.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { blankToUndefined } from "../../lib/optionalTextField.js";

export interface CreateDriverFormProps {
  onCreated: (driver: DriverResponse) => void;
}

/** 0=Sunday..6=Saturday, `weekdayOf`'s own convention (GAP-135). */
const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function chipClass(selected: boolean): string {
  return cn(
    "min-h-tap rounded-sm border px-3 text-body text-center",
    selected
      ? "border-brand bg-brand-wash text-brand-ink"
      : "border-transparent bg-surface-sunken text-ink-primary",
  );
}

/**
 * `createDriverRequestSchema`'s `moneyWireSchema` transforms a wire string
 * into `Minor` — the right shape for validating a request the Worker
 * receives, the wrong one for a form whose `MoneyField` control already
 * produces `Minor` directly (never a `number`, CLAUDE.md → Money). This
 * schema mirrors the request shape but keeps money as `Minor` end to end
 * in the form's own state; `toWire()` converts it back to the wire string
 * only in `mutationFn`, at the actual API boundary.
 *
 * `settlementRhythm`/`settlementWeekday` mirror `createDriverRequestSchema`'s
 * own pairing refine (GAP-135) — kept here rather than shared, the same
 * split every other field on this form already has between wire schema and
 * form schema.
 */
const driverFormSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    mobile: z.string().trim().min(1).max(30).optional(),
    driverDayFeeMinor: z.custom<Minor>((v) => typeof v === "bigint").optional(),
    driverTripFeeMinor: z.custom<Minor>((v) => typeof v === "bigint").optional(),
    // No `.default()` — RHF's own `defaultValues` already seeds "daily",
    // and a default here makes the resolver's input/output types disagree
    // under `exactOptionalPropertyTypes` (input optional, output required).
    settlementRhythm: z.enum(["daily", "weekly"]),
    settlementWeekday: z.number().int().min(0).max(6).optional(),
  })
  .refine((v) => v.settlementRhythm !== "weekly" || v.settlementWeekday !== undefined, {
    message: "Choose which day he settles",
    path: ["settlementWeekday"],
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
    defaultValues: { name: "", settlementRhythm: "daily" },
  });
  const settlementRhythm = useWatch({ control, name: "settlementRhythm" });

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
        // U-2: daily is the column's own DEFAULT — omitted rather than sent,
        // so a level-1-only save looks identical on the wire to today's form.
        ...(values.settlementRhythm === "weekly"
          ? { settlementRhythm: "weekly", settlementWeekday: values.settlementWeekday }
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
          autoComplete="name"
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
              autoComplete="tel"
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
          <Controller
            control={control}
            name="driverTripFeeMinor"
            render={({ field }) => (
              <MoneyField
                label="Driver trip fee"
                valueMinor={field.value ?? null}
                onChange={field.onChange}
              />
            )}
          />

          <div className="flex flex-col gap-1">
            <span className="text-body font-medium text-ink-primary">Settles</span>
            <Controller
              control={control}
              name="settlementRhythm"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2" role="group" aria-label="Settlement rhythm">
                  <button
                    type="button"
                    aria-pressed={field.value === "daily"}
                    className={chipClass(field.value === "daily")}
                    onClick={() => {
                      field.onChange("daily");
                    }}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    aria-pressed={field.value === "weekly"}
                    className={chipClass(field.value === "weekly")}
                    onClick={() => {
                      field.onChange("weekly");
                    }}
                  >
                    Weekly
                  </button>
                </div>
              )}
            />
          </div>

          {settlementRhythm === "weekly" ? (
            <Field
              label="Settlement day"
              htmlFor="settlementWeekday"
              error={errors.settlementWeekday?.message}
            >
              <Controller
                control={control}
                name="settlementWeekday"
                render={({ field }) => (
                  <NativeSelect
                    id="settlementWeekday"
                    aria-invalid={errors.settlementWeekday !== undefined}
                    aria-describedby={fieldErrorId("settlementWeekday")}
                    value={field.value ?? ""}
                    onChange={(e) => {
                      field.onChange(
                        e.target.value === ""
                          ? undefined
                          : // eslint-disable-next-line no-restricted-syntax -- a weekday index (0..6), not money
                            Number(e.target.value),
                      );
                    }}
                  >
                    <option value="" disabled>
                      Choose a day
                    </option>
                    {WEEKDAY_LABELS.map((label, weekday) => (
                      <option key={weekday} value={weekday}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              />
            </Field>
          ) : null}
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
