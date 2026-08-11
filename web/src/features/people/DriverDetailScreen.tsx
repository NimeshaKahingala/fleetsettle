import { addDays, businessToday, parse } from "@fleetsettle/shared";
import type {
  DriverBalancesResponse,
  DriverLinkInviteResponse,
  DriverResponse,
  DriverViewAdvance,
  DriverViewResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Link2, PiggyBank, Unlink, UserCog, Wallet } from "lucide-react";
import { useState } from "react";
import { QueryStateFailure } from "../../components/QueryState.js";
import { TwoBalances } from "../../components/TwoBalances.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { AdvanceSheet } from "./AdvanceSheet.js";
import { DepositSheet } from "./DepositSheet.js";
import { DriverActivitySections } from "./DriverActivitySections.js";
import { OffsetSheet } from "./OffsetSheet.js";
import { PayDriverSheet } from "./PayDriverSheet.js";
import { SettleAdvanceSheet } from "./SettleAdvanceSheet.js";

export interface DriverDetailScreenProps {
  driverId: string;
  onBack: () => void;
}

/**
 * F-6.4/UC-56's two-balance screen, now also F-6.1/F-6.3/F-6.7's home
 * (B13, GAP-63/64/66): pay the driver, record an advance, record a
 * deposit — three write endpoints that existed with no caller until this
 * item, found by the 8 Aug flow-inventory audit. `driverBalancesResponseSchema`
 * gives only the two totals (`owedToUsMinor`/`owedByUsMinor`), never a
 * breakdown — the per-obligation detail lines `TwoBalances`' own props
 * describe (e.g. "6 short days, oldest 14 Jul") aren't backed by any read
 * endpoint yet, so both detail lines are the same "—" `TwoBalances.test.tsx`
 * already uses for "nothing specific to say," rather than a fabricated one.
 * History sections (days, trips, advances, deposit — §3.3's route map) are
 * a separate, larger gap, recorded rather than half-built here.
 *
 * **The three new actions are deliberately not crammed into `TwoBalances`**
 * — its own doc comment reserves it to the one action it already has
 * ("`Offset…` is the only action"). They live behind `Screen`'s own
 * primary action instead, the same `ActionSheet` shape `QuickAddSheet`
 * already establishes for "pick one of several related actions."
 */
export function DriverDetailScreen({ driverId, onBack }: DriverDetailScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const today = businessToday();
  const from = addDays(today, -30);
  const [offsetOpen, setOffsetOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [accessActionsOpen, setAccessActionsOpen] = useState(false);
  const [linkInviteOpen, setLinkInviteOpen] = useState(false);
  const [linkInvite, setLinkInvite] = useState<DriverLinkInviteResponse | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [settleAdvanceOpen, setSettleAdvanceOpen] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<DriverViewAdvance | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  const driverQuery = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => api.get<DriverResponse>(`/api/driver/${driverId}`),
  });
  const balancesQuery = useQuery({
    queryKey: ["driver", driverId, "balances"],
    queryFn: () => api.get<DriverBalancesResponse>(`/api/driver/${driverId}/balances`),
  });
  const historyQuery = useQuery({
    queryKey: ["driver", driverId, "view", from, today],
    queryFn: () =>
      api.get<DriverViewResponse>(`/api/driver/${driverId}/view?from=${from}&to=${today}`),
  });
  const driverState = useQueryState(driverQuery);
  const balancesState = useQueryState(balancesQuery);
  const historyState = useQueryState(historyQuery);
  const failedState =
    driverState.kind === "error"
      ? driverState
      : balancesState.kind === "error"
        ? balancesState
        : null;

  const actions: ActionSheetAction[] = [
    { key: "pay", label: "Pay the driver", icon: HandCoins, onSelect: () => setPayOpen(true) },
    {
      key: "advance",
      label: "Record an advance",
      icon: Wallet,
      onSelect: () => setAdvanceOpen(true),
    },
    {
      key: "deposit",
      label: "Record a deposit",
      icon: PiggyBank,
      onSelect: () => setDepositOpen(true),
    },
  ];

  const linkInviteMutation = useMutation({
    mutationFn: () => api.post<DriverLinkInviteResponse>(`/api/driver/${driverId}/link-invite`, {}),
    onSuccess: (issued) => setLinkInvite(issued),
  });

  const unlinkMutation = useMutation({
    mutationFn: () => api.post<DriverResponse>(`/api/driver/${driverId}/unlink`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
      setUnlinkOpen(false);
    },
  });

  const accessActions: ActionSheetAction[] = [
    {
      key: "link",
      label: "Create account link",
      icon: Link2,
      onSelect: () => {
        setLinkInvite(null);
        setLinkInviteOpen(true);
        linkInviteMutation.mutate();
      },
    },
    {
      key: "unlink",
      label: "Unlink account",
      icon: Unlink,
      onSelect: () => setUnlinkOpen(true),
    },
  ];

  return (
    <Screen
      title={driverQuery.data?.name ?? "Driver"}
      onBack={onBack}
      {...(driverQuery.data !== undefined
        ? {
            action: {
              label: "Driver access",
              icon: UserCog,
              onClick: () => setAccessActionsOpen(true),
            },
          }
        : {})}
      primaryAction={{ label: "Driver money", onClick: () => setActionsOpen(true) }}
    >
      {failedState !== null ? (
        <QueryStateFailure
          error={failedState.error}
          retry={failedState.retry}
          of="this driver's balances"
        />
      ) : driverQuery.data === undefined || balancesQuery.data === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <TwoBalances
            owedToYouMinor={parse(balancesQuery.data.owedToUsMinor)}
            owedToYouDetail="—"
            owedByYouMinor={parse(balancesQuery.data.owedByUsMinor)}
            owedByYouDetail="—"
            onOffset={() => setOffsetOpen(true)}
          />
          {historyState.kind === "error" ? (
            <QueryStateFailure
              error={historyState.error}
              retry={historyState.retry}
              of="this driver's history"
            />
          ) : historyQuery.data === undefined ? (
            <p className="text-body-sm text-ink-muted">Loading history…</p>
          ) : (
            <DriverActivitySections
              view={historyQuery.data}
              onSettleAdvance={(advance) => {
                setSelectedAdvance(advance);
                setSettleAdvanceOpen(true);
              }}
            />
          )}
        </div>
      )}
      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Driver money"
        actions={actions}
      />
      <ActionSheet
        open={accessActionsOpen}
        onOpenChange={setAccessActionsOpen}
        title="Driver access"
        actions={accessActions}
      />
      <Sheet open={linkInviteOpen} onOpenChange={setLinkInviteOpen} title="Driver account link">
        <div className="flex flex-col gap-4">
          {linkInviteMutation.isPending ? (
            <p className="text-body-sm text-ink-muted">Creating link…</p>
          ) : linkInviteMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{linkInviteMutation.error.message}</p>
          ) : linkInvite !== null ? (
            <Card className="flex flex-col gap-2">
              <p className="text-label text-ink-secondary">Invite code</p>
              <p className="break-all text-title text-ink-primary">{linkInvite.code}</p>
              <p className="text-caption text-ink-muted">Expires {linkInvite.expiresAt}</p>
            </Card>
          ) : null}
          <Button size="cta" onClick={() => setLinkInviteOpen(false)}>
            Done
          </Button>
        </div>
      </Sheet>
      <Sheet open={unlinkOpen} onOpenChange={setUnlinkOpen} title="Unlink account?">
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body text-ink-secondary">
            The driver will lose app access. Their driver record and history stay unchanged.
          </p>
          {unlinkMutation.isError ? (
            <p className="text-body-sm text-critical-ink">{unlinkMutation.error.message}</p>
          ) : null}
          <DialogConfirmFooter
            confirmLabel="Unlink account"
            variant="destructive"
            onConfirm={() => unlinkMutation.mutate()}
            onCancel={() => setUnlinkOpen(false)}
          />
        </div>
      </Sheet>
      <OffsetSheet
        open={offsetOpen}
        onOpenChange={setOffsetOpen}
        driverId={driverId}
        today={today}
      />
      <PayDriverSheet open={payOpen} onOpenChange={setPayOpen} driverId={driverId} today={today} />
      <AdvanceSheet
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        driverId={driverId}
        today={today}
      />
      <SettleAdvanceSheet
        open={settleAdvanceOpen}
        onOpenChange={setSettleAdvanceOpen}
        driverId={driverId}
        advance={selectedAdvance}
        today={today}
      />
      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        driverId={driverId}
        today={today}
      />
    </Screen>
  );
}
