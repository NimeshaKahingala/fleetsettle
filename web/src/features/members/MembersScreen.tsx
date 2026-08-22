import type {
  BusinessMemberResponse,
  BusinessMemberRole,
  BusinessMemberRoleChangedResponse,
  InviteBusinessMemberResponse,
  RevokedBusinessMemberResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, UserCog, UserMinus, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import {
  BUSINESS_MEMBER_ROLE_LABEL,
  INVITABLE_BUSINESS_MEMBER_ROLES,
} from "../../lib/businessMemberRoleLabel.js";
import { can } from "../../lib/capabilities.js";
import { useMe } from "../../lib/useMe.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface MembersScreenProps {
  onBack: () => void;
}

function memberName(member: BusinessMemberResponse): string {
  return member.displayName ?? "Unnamed member";
}

function RolePicker({
  value,
  onChange,
}: {
  value: BusinessMemberRole;
  onChange: (role: BusinessMemberRole) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label font-medium text-ink-secondary">Role</span>
      <div className="grid grid-cols-2 gap-2">
        {INVITABLE_BUSINESS_MEMBER_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            aria-pressed={value === role}
            onClick={() => onChange(role)}
            className={
              value === role
                ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                : "min-h-tap rounded-sm border border-transparent bg-surface-sunken px-2 text-body-sm text-ink-primary"
            }
          >
            {BUSINESS_MEMBER_ROLE_LABEL[role]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * UI-8/A11: active business members and the owner-only access writes. The
 * member list now carries the membership row id because revoke/change-role
 * target membership rows, not users.
 */
export function MembersScreen({ onBack }: MembersScreenProps) {
  const api = useApi();
  const me = useMe();
  const queryClient = useQueryClient();
  const canManageMembers = can(me.role, "manageMembers");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<BusinessMemberRole>("owner_manager");
  const [inviteResult, setInviteResult] = useState<InviteBusinessMemberResponse | null>(null);
  const [selectedMember, setSelectedMember] = useState<BusinessMemberResponse | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [changeRoleOpen, setChangeRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState<BusinessMemberRole>("owner_manager");
  const [revokeOpen, setRevokeOpen] = useState(false);

  const membersQuery = useQuery({
    queryKey: ["business-member"],
    queryFn: () => api.get<BusinessMemberResponse[]>("/api/business-member"),
  });
  const membersState = useQueryState(membersQuery);
  const members = membersQuery.data ?? [];

  const inviteMutation = useMutation({
    mutationFn: (role: BusinessMemberRole) =>
      api.post<InviteBusinessMemberResponse>("/api/business-member/invite", { role }),
    onSuccess: (issued) => setInviteResult(issued),
  });

  const revokeMutation = useMutation({
    mutationFn: (member: BusinessMemberResponse) =>
      api.post<RevokedBusinessMemberResponse>(`/api/business-member/${member.id}/revoke`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["business-member"] });
      setRevokeOpen(false);
      setSelectedMember(null);
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ member, role }: { member: BusinessMemberResponse; role: BusinessMemberRole }) =>
      api.post<BusinessMemberRoleChangedResponse>(`/api/business-member/${member.id}/change-role`, {
        role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["business-member"] });
      setChangeRoleOpen(false);
      setSelectedMember(null);
    },
  });

  const memberActions = useMemo<ActionSheetAction[]>(
    () =>
      selectedMember === null || !canManageMembers
        ? []
        : [
            {
              key: "role",
              label: "Change role",
              icon: UserCog,
              onSelect: () => {
                setNewRole(selectedMember.role === "owner_manager" ? "owner" : "owner_manager");
                setChangeRoleOpen(true);
              },
            },
            {
              key: "revoke",
              label: "Revoke access",
              icon: UserMinus,
              onSelect: () => setRevokeOpen(true),
            },
          ],
    [canManageMembers, selectedMember],
  );

  return (
    <Screen
      title="Members"
      onBack={onBack}
      {...(canManageMembers
        ? {
            action: {
              label: "Invite member",
              icon: UserPlus,
              onClick: () => {
                inviteMutation.reset();
                setInviteResult(null);
                setInviteOpen(true);
              },
            },
          }
        : {})}
    >
      {membersState.kind === "error" ? (
        <QueryStateFailure error={membersState.error} retry={membersState.retry} of="members" />
      ) : membersQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : members.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">No active members.</p>
        </Card>
      ) : (
        <Section
          title="Active members"
          count={members.length}
          items={members.map((member) => {
            const row = (
              <Card className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-body text-ink-primary">{memberName(member)}</p>
                  <p className="text-caption text-ink-muted">
                    {BUSINESS_MEMBER_ROLE_LABEL[member.role]}
                  </p>
                </div>
                {canManageMembers ? (
                  <MoreVertical className="size-4 text-ink-muted" aria-hidden />
                ) : null}
              </Card>
            );
            return canManageMembers ? (
              <button
                key={member.id}
                type="button"
                onClick={() => {
                  setSelectedMember(member);
                  setActionsOpen(true);
                }}
                className="w-full text-left"
              >
                {row}
              </button>
            ) : (
              <div key={member.id}>{row}</div>
            );
          })}
        />
      )}

      <Sheet open={inviteOpen} onOpenChange={setInviteOpen} title="Invite member">
        {inviteResult === null ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              inviteMutation.mutate(inviteRole);
            }}
          >
            <RolePicker value={inviteRole} onChange={setInviteRole} />
            {inviteMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{inviteMutation.error.message}</p>
            ) : null}
            <Button type="submit" size="cta" disabled={inviteMutation.isPending}>
              Create invite
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-2">
              <p className="text-label text-ink-secondary">
                {BUSINESS_MEMBER_ROLE_LABEL[inviteResult.role]} invite code
              </p>
              <p className="break-all text-title text-ink-primary">{inviteResult.code}</p>
              <p className="text-caption text-ink-muted">Expires {inviteResult.expiresAt}</p>
            </Card>
            <Button size="cta" onClick={() => setInviteOpen(false)}>
              Done
            </Button>
          </div>
        )}
      </Sheet>

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={selectedMember !== null ? memberName(selectedMember) : "Member"}
        actions={memberActions}
      />

      <Sheet open={changeRoleOpen} onOpenChange={setChangeRoleOpen} title="Change role">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (selectedMember !== null) {
              changeRoleMutation.mutate({ member: selectedMember, role: newRole });
            }
          }}
        >
          <RolePicker value={newRole} onChange={setNewRole} />
          {changeRoleMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{changeRoleMutation.error.message}</p>
          ) : null}
          <Button type="submit" size="cta" disabled={changeRoleMutation.isPending}>
            Save role
          </Button>
        </form>
      </Sheet>

      <Sheet open={revokeOpen} onOpenChange={setRevokeOpen} title="Revoke access?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            This member will lose access. Their past records stay attributed to them.
          </p>
          {revokeMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{revokeMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Revoke access"
            variant="destructive"
            onConfirm={() => {
              if (selectedMember !== null) revokeMutation.mutate(selectedMember);
            }}
            onCancel={() => setRevokeOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
