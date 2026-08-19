import type { AdminRequest, DecideRequestInput } from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, MoreVertical } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface RequestQueueScreenProps {
  onBack: () => void;
}

const STATUS_LABEL: Record<AdminRequest["status"], string> = {
  pending: "Awaiting a decision",
  approved: "Approved",
  rejected: "Declined",
};

const STATUS_BADGE_VARIANT: Record<AdminRequest["status"], "warning" | "good" | "critical"> = {
  pending: "warning",
  approved: "good",
  rejected: "critical",
};

/**
 * F-11.1: every business-creation request, newest first — approve or
 * decline (with a reason, decision 12/W-63). Declining is re-requestable
 * (`business_creation_request_one_pending` only blocks a *second* pending
 * request, not a resubmission after rejection), so it is a `Sheet`, never a
 * `Dialog` (M-32/UI §6.1). A row where `selfAction` is true renders with a
 * visible badge, not just an aria-label (decision 11/W-67) — the kind of
 * thing that cannot be added credibly after the fact.
 */
export function RequestQueueScreen({ onBack }: RequestQueueScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AdminRequest | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const requestsQuery = useQuery({
    queryKey: ["admin", "requests"],
    queryFn: () => api.get<AdminRequest[]>("/api/admin/requests"),
  });
  const requestsState = useQueryState(requestsQuery);
  const requests = requestsQuery.data ?? [];

  const decideMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: DecideRequestInput }) =>
      api.post(`/api/admin/requests/${id}/decide`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "requests"] });
      setActionsOpen(false);
      setApproveOpen(false);
      setRejectOpen(false);
      setSelected(null);
      setReason("");
    },
  });

  const requestActions: ActionSheetAction[] =
    selected === null || selected.status !== "pending"
      ? []
      : [
          {
            key: "approve",
            label: "Approve",
            icon: CircleCheck,
            onSelect: () => setApproveOpen(true),
          },
          {
            key: "reject",
            label: "Decline",
            icon: CircleX,
            onSelect: () => {
              setReason("");
              setRejectOpen(true);
            },
          },
        ];

  return (
    <Screen title="Request queue" onBack={onBack}>
      {requestsState.kind === "error" ? (
        <QueryStateFailure
          error={requestsState.error}
          retry={requestsState.retry}
          of="the request queue"
        />
      ) : requestsQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : requests.length === 0 ? (
        <Card>
          <p className="text-body text-ink-secondary">No requests yet.</p>
        </Card>
      ) : (
        <Section
          title="Requests"
          count={requests.length}
          items={requests.map((request) => {
            const row = (
              <Card className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-body text-ink-primary">{request.name}</p>
                  <p className="truncate text-caption text-ink-muted">
                    {request.requesterName}
                    {request.requesterEmail !== null ? ` · ${request.requesterEmail}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant={STATUS_BADGE_VARIANT[request.status]}>
                      {STATUS_LABEL[request.status]}
                    </Badge>
                    {request.selfAction ? (
                      <Badge variant="neutral">
                        {request.status === "pending" ? "Your own request" : "Self-decided"}
                      </Badge>
                    ) : null}
                  </div>
                  {request.status === "rejected" && request.rejectionReason !== null ? (
                    <p className="mt-1 text-caption text-ink-muted">
                      Declined: {request.rejectionReason}
                    </p>
                  ) : null}
                </div>
                {request.status === "pending" ? (
                  <MoreVertical className="size-4 shrink-0 text-ink-muted" aria-hidden />
                ) : null}
              </Card>
            );
            return request.status === "pending" ? (
              <button
                key={request.id}
                type="button"
                onClick={() => {
                  setSelected(request);
                  setActionsOpen(true);
                }}
                className="w-full text-left"
              >
                {row}
              </button>
            ) : (
              <div key={request.id}>{row}</div>
            );
          })}
        />
      )}

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={selected?.name ?? "Request"}
        actions={requestActions}
      />

      <Sheet open={approveOpen} onOpenChange={setApproveOpen} title="Approve this request?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            {selected?.name} will become a real business, ready to use right away.
          </p>
          {decideMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{decideMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Approve request"
            onConfirm={() => {
              if (selected !== null) {
                decideMutation.mutate({ id: selected.id, input: { decision: "approve" } });
              }
            }}
            onCancel={() => setApproveOpen(false)}
          />
        </div>
      </Sheet>

      <Sheet open={rejectOpen} onOpenChange={setRejectOpen} title="Decline this request?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            The requester will see this reason, and can submit a new request.
          </p>
          <NoteField label="Reason" value={reason} onChange={setReason} />
          {decideMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{decideMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Decline request"
            variant="destructive"
            confirmDisabled={reason.trim().length === 0 || decideMutation.isPending}
            onConfirm={() => {
              if (selected !== null) {
                decideMutation.mutate({ id: selected.id, input: { decision: "reject", reason } });
              }
            }}
            onCancel={() => setRejectOpen(false)}
          />
        </div>
      </Sheet>
    </Screen>
  );
}
