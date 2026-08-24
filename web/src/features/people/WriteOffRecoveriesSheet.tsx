import { parse } from "@fleetsettle/shared";
import type {
  ListWriteOffRecoveriesResponse,
  VoidedResponse,
  WriteOffRecoveryListRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface WriteOffRecoveriesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  writeOffId: string;
  party: { type: "customer" | "driver"; id: string };
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * GAP-147: the one recovery `WriteOffRecoverySheet` just created had no
 * later home to be found again in — `recordWriteOffRecoveryHandler` had
 * always returned only the row it just made, and nothing listed past
 * recoveries to void one entered by mistake. One sheet with two modes,
 * toggled by `voidTarget` (`BusinessSwitcherSheet`'s own established
 * shape for this), rather than a second `Sheet` stacked on top of this
 * one — untested territory in this client, and unnecessary here.
 */
export function WriteOffRecoveriesSheet({
  open,
  onOpenChange,
  writeOffId,
  party,
}: WriteOffRecoveriesSheetProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [voidTarget, setVoidTarget] = useState<WriteOffRecoveryListRow | null>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setVoidTarget(null);
      setReason("");
    }
  }, [open]);

  const recoveriesQuery = useQuery({
    queryKey: ["write-off", writeOffId, "recovery"],
    queryFn: () => api.get<ListWriteOffRecoveriesResponse>(`/api/write-off/${writeOffId}/recovery`),
    enabled: open,
  });
  const recoveriesState = useQueryState(recoveriesQuery);
  const recoveries = recoveriesQuery.data ?? [];

  const voidMutation = useMutation({
    mutationFn: () => {
      if (voidTarget === null) throw new Error("Choose a recovery");
      return api.post<VoidedResponse>(
        `/api/write-off/${writeOffId}/recovery/${voidTarget.id}/void`,
        { reason: reason.trim() },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["write-off", writeOffId, "recovery"] });
      void queryClient.invalidateQueries({ queryKey: ["write-off"] });
      if (party.type === "customer") {
        void queryClient.invalidateQueries({ queryKey: ["customer", party.id, "payment"] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "balances"] });
        void queryClient.invalidateQueries({ queryKey: ["driver", party.id, "view"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      setVoidTarget(null);
      setReason("");
    },
  });

  if (voidTarget !== null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title="Void recovery">
        <div className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-secondary">
            This corrects a recovery entered by mistake. The row stays visible with your reason.
          </p>
          <NoteField label="Reason" value={reason} onChange={setReason} />
          {voidMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{voidMutation.error.message}</p>
          ) : null}
          <Button
            size="cta"
            variant="destructive"
            disabled={reason.trim() === "" || voidMutation.isPending}
            onClick={() => voidMutation.mutate()}
          >
            Void recovery
          </Button>
          <Button variant="ghost" onClick={() => setVoidTarget(null)}>
            Back to recoveries
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Recoveries">
      {recoveriesState.kind === "error" ? (
        <QueryStateFailure
          error={recoveriesState.error}
          retry={recoveriesState.retry}
          of="recoveries against this write-off"
        />
      ) : recoveriesState.kind === "pending" || recoveriesState.kind === "idle" ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : recoveries.length === 0 ? (
        <p className="text-body-sm text-ink-secondary">No recoveries recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-3 pb-2">
          {recoveries.map((recovery) => (
            <Card
              key={recovery.id}
              className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-caption text-ink-muted">
                  {formatShortDate(recovery.occurredOn)}
                  {recovery.voidedAt !== null ? " · voided" : ""}
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:items-end">
                <Money value={parse(recovery.amountMinor)} />
                {recovery.voidedAt === null ? (
                  <button
                    type="button"
                    onClick={() => setVoidTarget(recovery)}
                    className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                  >
                    Void recovery
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Sheet>
  );
}
