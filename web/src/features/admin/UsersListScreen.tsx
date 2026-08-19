import type { AdminUser, SetBusinessAllowanceInput } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, ShieldPlus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Field } from "../../design/primitives/Field.js";
import { Input } from "../../design/primitives/Input.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { adminIdentityLabel } from "../../lib/adminIdentityLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface UsersListScreenProps {
  onBack: () => void;
}

/**
 * F-11.2/decision 22/28: every identity — name (falling back
 * `displayName ?? email ?? "Unnamed user"`, decision 28), the business
 * allowance (decision 22's own screen: without a way to change it, the
 * `app_user.business_allowance` column is unreachable and its `DEFAULT` is
 * the only value it will ever hold), the active-business count, and a
 * platform-admin badge. Doubles as the user picker for granting admin
 * (design §8.2's own "the users list screen is one option" — chosen here
 * over a raw id-entry Sheet because the data needed to pick correctly, a
 * name and whether they already hold the role, is already on screen).
 */
export function UsersListScreen({ onBack }: UsersListScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [allowanceValue, setAllowanceValue] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);

  const usersQuery = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<AdminUser[]>("/api/admin/users"),
  });
  const usersState = useQueryState(usersQuery);
  const users = usersQuery.data ?? [];

  const allowanceMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetBusinessAllowanceInput }) =>
      api.post(`/api/admin/users/${id}/allowance`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setAllowanceOpen(false);
      setSelected(null);
    },
  });

  const grantMutation = useMutation({
    mutationFn: (userId: string) => api.post("/api/admin/admins", { userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "admins"] });
      setGrantOpen(false);
      setSelected(null);
    },
  });

  const userActions: ActionSheetAction[] =
    selected === null
      ? []
      : [
          {
            key: "allowance",
            label: "Set business allowance",
            icon: SlidersHorizontal,
            onSelect: () => {
              allowanceMutation.reset();
              setAllowanceValue(String(selected.businessAllowance));
              setAllowanceOpen(true);
            },
          },
          ...(selected.isPlatformAdmin
            ? []
            : [
                {
                  key: "grant",
                  label: "Grant admin access",
                  icon: ShieldPlus,
                  onSelect: () => {
                    grantMutation.reset();
                    setGrantOpen(true);
                  },
                },
              ]),
        ];

  return (
    <Screen title="Users" onBack={onBack}>
      {usersState.kind === "error" ? (
        <QueryStateFailure error={usersState.error} retry={usersState.retry} of="the user list" />
      ) : usersQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : users.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">No users yet.</p>
        </Card>
      ) : (
        <Section
          title="Users"
          count={users.length}
          items={users.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => {
                setSelected(user);
                setActionsOpen(true);
              }}
              className="w-full text-left"
            >
              <Card className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-body text-ink-primary">{adminIdentityLabel(user)}</p>
                  <p className="text-caption text-ink-muted">
                    {user.activeBusinessCount} of {user.businessAllowance} businesses
                  </p>
                  {user.isPlatformAdmin ? (
                    <Badge variant="brand" className="mt-1">
                      Platform admin
                    </Badge>
                  ) : null}
                </div>
                <MoreVertical className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </Card>
            </button>
          ))}
        />
      )}

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={selected !== null ? adminIdentityLabel(selected) : "User"}
        actions={userActions}
      />

      <Sheet open={allowanceOpen} onOpenChange={setAllowanceOpen} title="Business allowance">
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            // eslint-disable-next-line no-restricted-syntax -- decision 22's allowance, a count, not money
            const parsed = Number(allowanceValue);
            if (selected !== null && Number.isInteger(parsed)) {
              allowanceMutation.mutate({
                id: selected.id,
                input: { businessAllowance: parsed },
              });
            }
          }}
        >
          <p className="text-body-sm text-ink-secondary">
            How many businesses {selected !== null ? adminIdentityLabel(selected) : "this user"} may
            own before a new one queues for review.
          </p>
          <Field label="Allowance" htmlFor="allowance">
            <Input
              id="allowance"
              type="text"
              inputMode="numeric"
              value={allowanceValue}
              onChange={(e) => setAllowanceValue(e.target.value)}
            />
          </Field>
          {allowanceMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{allowanceMutation.error.message}</p>
          ) : null}
          <Button type="submit" size="cta" disabled={allowanceMutation.isPending}>
            Save allowance
          </Button>
        </form>
      </Sheet>

      <Sheet open={grantOpen} onOpenChange={setGrantOpen} title="Grant admin access?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            {selected !== null ? adminIdentityLabel(selected) : "This user"} will be able to review
            business requests, manage other admins, and see business names and member counts — never
            money (INV-38).
          </p>
          {grantMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{grantMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Grant admin access"
            confirmDisabled={grantMutation.isPending}
            onConfirm={() => {
              if (selected !== null) grantMutation.mutate(selected.id);
            }}
            onCancel={() => setGrantOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
