import { zodResolver } from "@hookform/resolvers/zod";
import {
  redeemInviteRequestSchema,
  type RedeemInviteRequest,
  type RedeemInviteResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "../../design/primitives/Button.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { useApi } from "../../lib/ApiContext.js";
import { fieldErrorId } from "../../lib/fieldErrorId.js";

export interface RedeemInviteFormProps {
  onRedeemed: (result: RedeemInviteResponse) => void;
}

/**
 * A11/W-57: one code, one field — the invitee never picks a role or a
 * business (F-1.4's own accept clause: "redeeming a code never lets the
 * invitee pick their own role"), so there is nothing else this form could
 * ask. Serves both F-1.4 (a partner or manager joining) and F-1.8 (a
 * driver's own account) — the code alone decides which, server-side.
 */
export function RedeemInviteForm({ onRedeemed }: RedeemInviteFormProps) {
  const api = useApi();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RedeemInviteRequest>({
    resolver: zodResolver(redeemInviteRequestSchema),
    defaultValues: { code: "" },
  });

  const mutation = useMutation({
    mutationFn: (input: RedeemInviteRequest) =>
      api.post<RedeemInviteResponse>("/api/invite/redeem", input),
    onSuccess: onRedeemed,
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => void handleSubmit((values) => mutation.mutate(values))(e)}
    >
      <Field label="Invite code" htmlFor="code" error={errors.code?.message}>
        <Input
          id="code"
          autoCapitalize="characters"
          aria-invalid={errors.code !== undefined}
          aria-describedby={fieldErrorId("code")}
          {...register("code")}
        />
      </Field>
      {mutation.isError ? (
        <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
      ) : null}
      <Button type="submit" size="cta" disabled={mutation.isPending}>
        Join
      </Button>
    </form>
  );
}
