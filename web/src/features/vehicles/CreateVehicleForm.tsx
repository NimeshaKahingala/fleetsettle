import { zodResolver } from "@hookform/resolvers/zod";
import type { BusinessDate } from "@fleetsettle/shared";
import {
  vehicleArrangementCodeSchema,
  type CreateVehicleRequest,
  type VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { useApi } from "../../lib/ApiContext.js";
import { DateField } from "../../components/DateField.js";

export interface CreateVehicleFormProps {
  today: BusinessDate;
  onCreated: (vehicle: VehicleResponse) => void;
}

const ARRANGEMENTS = [
  { code: "A", label: "Lease out" },
  { code: "B", label: "Daily lease" },
  { code: "C", label: "Trips / charter" },
] as const;

/**
 * `createVehicleRequestSchema`'s `businessDateSchema` transforms a wire
 * string into `BusinessDate` — a branded string with no runtime
 * difference, but enough for zodResolver's TFieldValues inference to
 * disagree with `useForm<CreateVehicleRequest>`'s own field-value types
 * (the same class of mismatch `driverFormSchema` documents for `Minor`,
 * except here the wire and domain values are byte-identical, so no
 * conversion step is needed before posting — just a form-local schema
 * that doesn't transform).
 */
const vehicleFormSchema = z.object({
  registration: z.string().trim().min(1).max(50),
  vehicleType: z.string().trim().min(1).max(50),
  defaultArrangement: vehicleArrangementCodeSchema,
  insuranceExpiry: z.custom<BusinessDate>((v) => typeof v === "string").optional(),
  registrationExpiry: z.custom<BusinessDate>((v) => typeof v === "string").optional(),
});
type VehicleFormValues = z.infer<typeof vehicleFormSchema>;

/**
 * F-1.1 / UC-01: registration, type and a default arrangement are level 1;
 * insurance/registration expiry are the one thing worth asking on the same
 * form (UC-01) but stay level 2, behind `Disclosure` — U-2 forbids
 * requiring them, not offering them.
 */
export function CreateVehicleForm({ today, onCreated }: CreateVehicleFormProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: { registration: "", vehicleType: "", defaultArrangement: "B" },
  });

  const mutation = useMutation({
    mutationFn: (values: VehicleFormValues) =>
      api.post<VehicleResponse>("/api/vehicle", values satisfies CreateVehicleRequest),
    onSuccess: (vehicle) => {
      void queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      onCreated(vehicle);
    },
  });

  const arrangement = watch("defaultArrangement");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
    >
      <Field label="Registration" htmlFor="registration" error={errors.registration?.message}>
        <Input
          id="registration"
          aria-invalid={errors.registration !== undefined}
          aria-describedby={fieldErrorId("registration")}
          {...register("registration")}
        />
      </Field>
      <Field label="Vehicle type" htmlFor="vehicleType" error={errors.vehicleType?.message}>
        <Input
          id="vehicleType"
          placeholder="Bus, car, van…"
          aria-invalid={errors.vehicleType !== undefined}
          aria-describedby={fieldErrorId("vehicleType")}
          {...register("vehicleType")}
        />
      </Field>

      <div className="flex flex-col gap-1">
        <span className="text-label font-medium text-ink-secondary">Default arrangement</span>
        <div className="flex gap-2">
          {ARRANGEMENTS.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              aria-pressed={arrangement === code}
              onClick={() => setValue("defaultArrangement", code)}
              className={
                arrangement === code
                  ? "min-h-tap flex-1 rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                  : "min-h-tap flex-1 rounded-sm border border-line-strong px-2 text-body-sm text-ink-primary"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Disclosure sectionName="Paperwork">
        <div className="flex flex-col gap-4">
          <Controller
            control={control}
            name="insuranceExpiry"
            render={({ field }) => (
              <DateField
                label="Insurance expiry"
                today={today}
                value={field.value ?? today}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={control}
            name="registrationExpiry"
            render={({ field }) => (
              <DateField
                label="Registration expiry"
                today={today}
                value={field.value ?? today}
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
        Add vehicle
      </Button>
    </form>
  );
}
