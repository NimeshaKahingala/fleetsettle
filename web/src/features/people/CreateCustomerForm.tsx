import { zodResolver } from "@hookform/resolvers/zod";
import {
  createCustomerRequestSchema,
  type CreateCustomerRequest,
  type CustomerResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "../../design/primitives/Button.js";
import { Disclosure } from "../../design/primitives/Disclosure.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";
import { blankToUndefined } from "../../lib/optionalTextField.js";

export interface CreateCustomerFormProps {
  onCreated: (customer: CustomerResponse) => void;
}

/**
 * F-2.1 / UC-10, W-55: a person needs an NIC or a mobile; an organisation
 * needs a registration number. `customerType` decides which fields the
 * schema requires, so it has to be picked before the rest of the form
 * makes sense — level 1 either way, since the discriminant itself isn't
 * optional.
 */
export function CreateCustomerForm({ onCreated }: CreateCustomerFormProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateCustomerRequest>({
    resolver: zodResolver(createCustomerRequestSchema),
    defaultValues: { customerType: "person", name: "" },
  });

  const customerType = watch("customerType");

  const mutation = useMutation({
    mutationFn: (input: CreateCustomerRequest) =>
      api.post<CustomerResponse>("/api/customer", input),
    onSuccess: (customer) => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onCreated(customer);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
    >
      <div className="flex flex-col gap-1">
        <span className="text-label font-medium text-ink-secondary">Type</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={customerType === "person"}
            onClick={() => setValue("customerType", "person")}
            className={
              customerType === "person"
                ? "min-h-tap flex-1 rounded-sm border border-brand bg-brand-wash text-body-sm text-brand-ink"
                : "min-h-tap flex-1 rounded-sm border border-transparent bg-surface-sunken text-body-sm text-ink-primary"
            }
          >
            Person
          </button>
          <button
            type="button"
            aria-pressed={customerType === "organisation"}
            onClick={() => setValue("customerType", "organisation")}
            className={
              customerType === "organisation"
                ? "min-h-tap flex-1 rounded-sm border border-brand bg-brand-wash text-body-sm text-brand-ink"
                : "min-h-tap flex-1 rounded-sm border border-transparent bg-surface-sunken text-body-sm text-ink-primary"
            }
          >
            Organisation
          </button>
        </div>
      </div>

      <Field label="Name" htmlFor="name" error={errors.name?.message}>
        <Input
          id="name"
          autoComplete="name"
          aria-invalid={errors.name !== undefined}
          aria-describedby={fieldErrorId("name")}
          {...register("name")}
        />
      </Field>

      {customerType === "organisation" ? (
        <Field
          label="Registration number"
          htmlFor="registrationNo"
          error={"registrationNo" in errors ? errors.registrationNo?.message : undefined}
        >
          <Input id="registrationNo" {...register("registrationNo")} />
        </Field>
      ) : null}

      <Disclosure
        sectionName="Contact details"
        forceOpen={"nic" in errors && errors.nic !== undefined}
      >
        <div className="flex flex-col gap-4">
          <Field label="Mobile" htmlFor="mobile" optional error={errors.mobile?.message}>
            <Input id="mobile" autoComplete="tel" {...register("mobile", blankToUndefined)} />
          </Field>
          <Field label="Address" htmlFor="address" optional>
            <Input
              id="address"
              autoComplete="street-address"
              {...register("address", blankToUndefined)}
            />
          </Field>
          {customerType === "person" ? (
            <Field
              label="NIC"
              htmlFor="nic"
              optional
              error={"nic" in errors ? errors.nic?.message : undefined}
            >
              <Input id="nic" {...register("nic", blankToUndefined)} />
            </Field>
          ) : (
            <Field label="Contact person" htmlFor="contactPerson" optional>
              <Input
                id="contactPerson"
                autoComplete="name"
                {...register("contactPerson", blankToUndefined)}
              />
            </Field>
          )}
        </div>
      </Disclosure>

      {mutation.isError ? (
        <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
      ) : null}
      <Button type="submit" size="cta" disabled={mutation.isPending}>
        Add customer
      </Button>
    </form>
  );
}
