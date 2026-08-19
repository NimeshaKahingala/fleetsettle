import { zodResolver } from "@hookform/resolvers/zod";
import { BUSINESS_TIMEZONE } from "@fleetsettle/shared";
import {
  createBusinessRequestSchema,
  type BusinessCreationResponse,
  type BusinessResponse,
  type CreateBusinessRequest,
  type SessionPendingRequest,
} from "@fleetsettle/shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";

export interface CreateBusinessFormProps {
  /**
   * Decision 17: `/api/session`'s own field for this caller's outstanding
   * `business_creation_request` — the mechanism decision 13's "refresh to
   * see the outcome" actually needs. `FirstRunGate` owns the read (it
   * already fetches `/api/session` for its own branching) and passes the
   * result down here rather than this form re-querying it, so there is one
   * read, not two.
   */
  pendingRequest: SessionPendingRequest | null;
  onCreated: (business: BusinessResponse) => void;
}

/**
 * F-0.1 / UC-08: name, currency and timezone — fixed here and never asked
 * again (W-54, so currency/timezone default to the one real market this
 * product serves and stay editable only because a fresh business could
 * genuinely be elsewhere). All three fields are level 1; there is no
 * level 2/3 on this form to make optional.
 *
 * Phase 2 (18 Aug 2026, decisions 4/12/17/22): three render branches, not
 * one. `pendingRequest` (from `/api/session`, a page-load fact) and
 * `mutation.data` (from this form's own most recent submit, a same-session
 * fact) are two different sources for the same question — "is there an
 * outstanding request right now" — and a fresh "pending" from submitting
 * just now takes precedence over a possibly-stale prop from whenever the
 * page loaded. A rejected request can never arise from `mutation.data`
 * (rejection is an admin's own action, out of band) — only `pendingRequest`
 * ever carries it.
 */
export function CreateBusinessForm({ pendingRequest, onCreated }: CreateBusinessFormProps) {
  const api = useApi();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateBusinessRequest>({
    resolver: zodResolver(createBusinessRequestSchema),
    defaultValues: { name: "", currencyCode: "LKR", timezone: BUSINESS_TIMEZONE },
  });

  const mutation = useMutation({
    mutationFn: (input: CreateBusinessRequest) =>
      api.post<BusinessCreationResponse>("/api/business", input),
    onSuccess: (result) => {
      if (result.kind === "created") onCreated(result);
    },
  });

  const justSubmittedPending = mutation.data?.kind === "pending";
  const status: "default" | "pending" | "rejected" = justSubmittedPending
    ? "pending"
    : (pendingRequest?.status ?? "default");

  if (status === "pending") {
    return <p className="text-body text-ink-secondary">Your request is being reviewed.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {status === "rejected" ? (
        <p className="text-body text-ink-secondary">
          Request declined: {pendingRequest?.rejectionReason}
        </p>
      ) : null}
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
        <Button type="submit" size="cta" disabled={mutation.isPending}>
          {status === "rejected" ? "Request again" : "Create business"}
        </Button>
      </form>
    </div>
  );
}
