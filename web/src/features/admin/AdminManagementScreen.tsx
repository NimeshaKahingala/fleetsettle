import type { PlatformAdmin } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen, type ScreenAction } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { adminIdentityLabel } from "../../lib/adminIdentityLabel.js";
import { cn } from "../../lib/cn.js";
import { formatTimestamp } from "../../lib/formatTimestamp.js";
import { rowButtonFocus } from "../../lib/rowButtonFocus.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface AdminManagementScreenProps {
  onBack: () => void;
}

/**
 * F-11.2/W-65: every active platform admin, revocable — never the *only*
 * remaining one (INV-40, `assert_platform_has_admin()`), and the 409 that
 * refusal produces gets its own specific text, not a generic failure toast.
 * Revoking is re-grantable, therefore reversible, therefore a `Sheet`, not
 * a `Dialog` (M-32/UI §6.1). **Granting** is reached from the Users list
 * (`UsersListScreen`) rather than a raw id-entry field here — the picker's
 * own data (name, whether already an admin) already lives there, so this
 * screen's own "action" button just navigates across rather than
 * duplicating a user search.
 */
export function AdminManagementScreen({ onBack }: AdminManagementScreenProps) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<PlatformAdmin | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const adminsQuery = useQuery({
    queryKey: ["admin", "admins"],
    queryFn: () => api.get<PlatformAdmin[]>("/api/admin/admins"),
  });
  const adminsState = useQueryState(adminsQuery);
  const admins = adminsQuery.data ?? [];

  const revokeMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/api/admin/admins/${userId}/revoke`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "admins"] });
      setRevokeOpen(false);
      setSelected(null);
    },
  });

  const grantAction: ScreenAction = {
    label: "Grant admin access",
    icon: UserPlus,
    onClick: () => void navigate({ to: "/admin/users" }),
  };

  return (
    <Screen title="Admin management" onBack={onBack} action={grantAction}>
      {adminsState.kind === "error" ? (
        <QueryStateFailure
          error={adminsState.error}
          retry={adminsState.retry}
          of="the admin list"
        />
      ) : adminsQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : admins.length === 0 ? (
        // Unreachable in practice (INV-40 keeps at least one), kept as an
        // honest empty state rather than assuming the list can never be
        // empty (W-56).
        <Card>
          <p className="text-body text-ink-secondary">No active admins.</p>
        </Card>
      ) : (
        <Section
          title="Active admins"
          count={admins.length}
          items={admins.map((admin) => (
            <Card key={admin.userId} className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-body text-ink-primary">{adminIdentityLabel(admin)}</p>
                <p className="text-caption text-ink-muted">
                  Admin since {formatTimestamp(admin.grantedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  revokeMutation.reset();
                  setSelected(admin);
                  setRevokeOpen(true);
                }}
                aria-label={`Revoke admin access for ${adminIdentityLabel(admin)}`}
                className={cn(
                  "flex size-tap shrink-0 items-center justify-center rounded-sm text-critical-ink active:bg-critical/10",
                  rowButtonFocus,
                )}
              >
                <UserMinus className="size-5" aria-hidden />
              </button>
            </Card>
          ))}
        />
      )}

      <Sheet open={revokeOpen} onOpenChange={setRevokeOpen} title="Revoke admin access?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            {selected !== null ? adminIdentityLabel(selected) : "This admin"} will lose access to
            the admin panel. Their business memberships, if any, are unaffected.
          </p>
          {revokeMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{revokeMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Revoke access"
            variant="destructive"
            confirmDisabled={revokeMutation.isPending}
            onConfirm={() => {
              if (selected !== null) revokeMutation.mutate(selected.userId);
            }}
            onCancel={() => setRevokeOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
