import { zodResolver } from "@hookform/resolvers/zod";
import { BUSINESS_TIMEZONE } from "@fleetsettle/shared";
import {
  createBusinessRequestSchema,
  type BusinessCreationResponse,
  type BusinessResponse,
  type CreateBusinessRequest,
} from "@fleetsettle/shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";

export interface CreateBusinessFormProps {
  onCreated: (business: BusinessResponse) => void;
}

/**
 * F-0.1 / UC-08: name, currency and timezone — fixed here and never asked
 * again (W-54, so currency/timezone default to the one real market this
 * product serves and stay editable only because a fresh business could
 * genuinely be elsewhere). All three fields are level 1; there is no
 * level 2/3 on this form to make optional.
 */
export function CreateBusinessForm({ onCreated }: CreateBusinessFormProps) {
  const api = useApi();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateBusinessRequest>({
    resolver: zodResolver(createBusinessRequestSchema),
    defaultValues: { name: "", currencyCode: "LKR", timezone: BUSINESS_TIMEZONE },
  });

  // Phase 2 (18 Aug 2026, decisions 4/22): the server now returns a
  // discriminated union — "created" below the requester's allowance,
  // "pending" at or above it. `onCreated` keeps its existing contract
  // (a real business, for whatever this form's caller already does with
  // one) and only fires for that branch. The "pending"/"rejected" states
  // decision 16 specifies — reading /api/session's own pendingRequest field
  // on mount, rendering "being reviewed" or "declined: <reason>" instead of
  // this form at all — are deferred: this pass is the backend threshold
  // logic, not the client's three-branch UI. What ships here is honest
  // about the shape rather than silently assuming "created" always.
  const mutation = useMutation({
    mutationFn: (input: CreateBusinessRequest) =>
      api.post<BusinessCreationResponse>("/api/business", input),
    onSuccess: (result) => {
      if (result.kind === "created") onCreated(result);
    },
  });

  const pendingResult = mutation.data?.kind === "pending" ? mutation.data : undefined;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
    >
      <Field label="Business name" htmlFor="name" error={errors.name?.message}>
        <Input
          id="name"
          autoComplete="organization"
          aria-invalid={errors.name !== undefined}
          aria-describedby={fieldErrorId("name")}
          {...register("name")}
        />
      </Field>
      <Field label="Currency" htmlFor="currencyCode" error={errors.currencyCode?.message}>
        <Input
          id="currencyCode"
          aria-invalid={errors.currencyCode !== undefined}
          aria-describedby={fieldErrorId("currencyCode")}
          {...register("currencyCode")}
        />
      </Field>
      <Field label="Timezone" htmlFor="timezone" error={errors.timezone?.message}>
        <Input
          id="timezone"
          aria-invalid={errors.timezone !== undefined}
          aria-describedby={fieldErrorId("timezone")}
          {...register("timezone")}
        />
      </Field>
      {mutation.isError ? (
        <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
      ) : null}
      {pendingResult ? (
        <p className="text-body-sm text-ink-secondary">Your request is being reviewed.</p>
      ) : null}
      <Button type="submit" size="cta" disabled={mutation.isPending}>
        Create business
      </Button>
    </form>
  );
}
