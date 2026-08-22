import { addDays, businessToday, parse } from "@fleetsettle/shared";
import type {
  DriverBalancesResponse,
  DriverLinkInviteResponse,
  DriverViewDepositMovement,
  DriverResponse,
  DriverViewAdvance,
  DriverViewOffset,
  DriverViewResponse,
  ListWriteOffsResponse,
  SessionResponse,
  WriteOffListRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  FileX2,
  HandCoins,
  Link2,
  MoreVertical,
  PiggyBank,
  Unlink,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Money } from "../../components/Money.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { TwoBalances } from "../../components/TwoBalances.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { useApi } from "../../lib/ApiContext.js";
import { can } from "../../lib/capabilities.js";
import { resolveSelectedMembership } from "../../lib/selectedMembership.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { AdvanceSettlementsSheet } from "./AdvanceSettlementsSheet.js";
import { AdvanceSheet } from "./AdvanceSheet.js";
import { DepositMovementSheet } from "./DepositMovementSheet.js";
import { DepositSheet } from "./DepositSheet.js";
import { DriverActivitySections } from "./DriverActivitySections.js";
import { OffsetSheet } from "./OffsetSheet.js";
import { PayDriverSheet } from "./PayDriverSheet.js";
import { SettleAdvanceSheet } from "./SettleAdvanceSheet.js";
import { VoidAdvanceSheet } from "./VoidAdvanceSheet.js";
import { VoidDepositMovementSheet } from "./VoidDepositMovementSheet.js";
import { VoidOffsetSheet } from "./VoidOffsetSheet.js";
import { VoidWriteOffSheet } from "./VoidWriteOffSheet.js";
import { WriteOffBalanceSheet } from "./WriteOffBalanceSheet.js";
import { WriteOffRecoveriesSheet } from "./WriteOffRecoveriesSheet.js";
import { WriteOffRecoverySheet } from "./WriteOffRecoverySheet.js";

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
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [linkInviteOpen, setLinkInviteOpen] = useState(false);
  const [linkInvite, setLinkInvite] = useState<DriverLinkInviteResponse | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [settleAdvanceOpen, setSettleAdvanceOpen] = useState(false);
  const [voidAdvanceOpen, setVoidAdvanceOpen] = useState(false);
  const [selectedAdvance, setSelectedAdvance] = useState<DriverViewAdvance | null>(null);
  const [settlementsTarget, setSettlementsTarget] = useState<string | null>(null);
  const [voidOffsetTarget, setVoidOffsetTarget] = useState<DriverViewOffset | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositMovementOpen, setDepositMovementOpen] = useState(false);
  const [voidDepositMovementTarget, setVoidDepositMovementTarget] =
    useState<DriverViewDepositMovement | null>(null);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [recoveryTarget, setRecoveryTarget] = useState<WriteOffListRow | null>(null);
  const [voidWriteOffTarget, setVoidWriteOffTarget] = useState<WriteOffListRow | null>(null);
  const [recoveriesTarget, setRecoveriesTarget] = useState<string | null>(null);

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
  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const selectedRole = session !== undefined ? resolveSelectedMembership(session)?.role : undefined;
  // GAP-155: `listWriteOffsHandler` is `dailyOperations` — the same gate as
  // recording the recovery it exists to serve for a manager — so this reuses
  // `canRecordRecovery` rather than a second identical check. Creating and
  // voiding a write-off stay `writeOffOrWaiveAboveThreshold` (`canWriteOff`,
  // below): only who can *see* widened, not who can create or reverse one.
  const canRecordRecovery = selectedRole !== undefined && can(selectedRole, "dailyOperations");
  const canWriteOff =
    selectedRole !== undefined && can(selectedRole, "writeOffOrWaiveAboveThreshold");
  const writeOffsQuery = useQuery({
    queryKey: ["write-off", "driver", driverId],
    queryFn: () =>
      api.get<ListWriteOffsResponse>(
        `/api/write-off?partyType=driver&partyDriverId=${encodeURIComponent(driverId)}`,
      ),
    enabled: canRecordRecovery,
  });
  const driverState = useQueryState(driverQuery);
  const balancesState = useQueryState(balancesQuery);
  const historyState = useQueryState(historyQuery);
  const writeOffsState = useQueryState(writeOffsQuery);
  const writeOffs = writeOffsQuery.data ?? [];
  const failedState =
    driverState.kind === "error"
      ? driverState
      : balancesState.kind === "error"
        ? balancesState
        : null;

  useEffect(() => {
    if (archiveOpen) setArchiveReason("");
  }, [archiveOpen]);

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
    ...(canWriteOff
      ? [
          {
            key: "write-off-driver",
            label: "Write off balance",
            icon: FileX2,
            onSelect: () => setWriteOffOpen(true),
          },
        ]
      : []),
    ...(historyQuery.data?.deposit !== null && historyQuery.data?.deposit !== undefined
      ? [
          {
            key: "deposit-movement",
            label: "Record deposit movement",
            icon: PiggyBank,
            onSelect: () => setDepositMovementOpen(true),
          },
        ]
      : []),
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

  const archiveMutation = useMutation({
    mutationFn: () => {
      if (driverQuery.data === undefined) throw new Error("Choose a driver");
      if (driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined) {
        return api.post<DriverResponse>(`/api/driver/${driverId}/unarchive`, {});
      }
      return api.post<DriverResponse>(`/api/driver/${driverId}/archive`, {
        reason: archiveReason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["driver", driverId] });
      void queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setArchiveOpen(false);
    },
  });

  const driverActions: ActionSheetAction[] = [
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
    ...(driverQuery.data?.archivedAt !== null && driverQuery.data?.archivedAt !== undefined
      ? [
          {
            key: "unarchive-driver",
            label: "Unarchive driver",
            icon: ArchiveRestore,
            onSelect: () => setArchiveOpen(true),
          },
        ]
      : [
          {
            key: "archive-driver",
            label: "Archive driver",
            icon: Archive,
            onSelect: () => setArchiveOpen(true),
          },
        ]),
  ];

  return (
    <Screen
      title={driverQuery.data?.name ?? "Driver"}
      onBack={onBack}
      {...(driverQuery.data !== undefined
        ? {
            action: {
              label: "Driver actions",
              icon: MoreVertical,
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
          <Card>
            <p className="text-label text-ink-secondary">Status</p>
            <Badge
              variant={
                driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
                  ? "warning"
                  : "good"
              }
            >
              {driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
                ? "Archived"
                : "Active"}
            </Badge>
          </Card>
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
              onVoidAdvance={(advance) => {
                setSelectedAdvance(advance);
                setVoidAdvanceOpen(true);
              }}
              onViewAdvanceSettlements={(advance) => setSettlementsTarget(advance.id)}
              onVoidOffset={(offset) => setVoidOffsetTarget(offset)}
              onVoidDepositMovement={(movement) => setVoidDepositMovementTarget(movement)}
            />
          )}
          {canRecordRecovery && writeOffsState.kind === "error" ? (
            <QueryStateFailure
              error={writeOffsState.error}
              retry={writeOffsState.retry}
              of="this driver's write-offs"
            />
          ) : canRecordRecovery && writeOffs.length > 0 ? (
            <Section
              title="Written off losses"
              count={writeOffs.length}
              items={writeOffs.map((writeOff) => (
                <Card
                  key={writeOff.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body text-ink-primary">{writeOff.reason}</p>
                    <p className="text-caption text-ink-muted">
                      {formatShortDate(writeOff.writtenOffOn)}
                      {writeOff.vehicleId !== null ? " · vehicle-linked" : ""}
                      {writeOff.voidedAt !== null ? " · voided" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-4 sm:items-end">
                    <Money value={parse(writeOff.amountMinor)} />
                    {canRecordRecovery && writeOff.voidedAt === null ? (
                      <button
                        type="button"
                        onClick={() => setRecoveryTarget(writeOff)}
                        className="min-h-tap rounded-sm border border-transparent bg-surface-sunken px-3 text-body text-ink-primary"
                      >
                        Record recovery
                      </button>
                    ) : null}
                    {canRecordRecovery ? (
                      <button
                        type="button"
                        onClick={() => setRecoveriesTarget(writeOff.id)}
                        className="min-h-tap rounded-sm border border-transparent bg-surface-sunken px-3 text-body text-ink-primary"
                      >
                        View recoveries
                      </button>
                    ) : null}
                    {canWriteOff && writeOff.voidedAt === null ? (
                      <button
                        type="button"
                        onClick={() => setVoidWriteOffTarget(writeOff)}
                        className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      >
                        Void write-off
                      </button>
                    ) : null}
                  </div>
                </Card>
              ))}
            />
          ) : null}
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
        title="Driver actions"
        actions={driverActions}
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
      {driverQuery.data !== undefined ? (
        <Sheet
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          title={
            driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
              ? "Unarchive driver?"
              : "Archive driver?"
          }
        >
          <div className="flex flex-col gap-4 pb-2">
            <p className="text-body text-ink-secondary">
              {driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
                ? "This puts the driver back into pickers. Existing history is unchanged."
                : "This hides the driver from new work. The API refuses this while money is still open."}
            </p>
            {driverQuery.data.archivedAt === null || driverQuery.data.archivedAt === undefined ? (
              <NoteField label="Reason" value={archiveReason} onChange={setArchiveReason} />
            ) : null}
            {archiveMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{archiveMutation.error.message}</p>
            ) : null}
            <Button
              size="cta"
              variant={
                driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
                  ? "primary"
                  : "destructive"
              }
              disabled={
                archiveMutation.isPending ||
                ((driverQuery.data.archivedAt === null ||
                  driverQuery.data.archivedAt === undefined) &&
                  archiveReason.trim() === "")
              }
              onClick={() => archiveMutation.mutate()}
            >
              {driverQuery.data.archivedAt !== null && driverQuery.data.archivedAt !== undefined
                ? "Unarchive driver"
                : "Archive driver"}
            </Button>
          </div>
        </Sheet>
      ) : null}
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
      <VoidAdvanceSheet
        open={voidAdvanceOpen}
        onOpenChange={(open) => {
          setVoidAdvanceOpen(open);
          if (!open && !settleAdvanceOpen) setSelectedAdvance(null);
        }}
        driverId={driverId}
        advance={selectedAdvance}
      />
      {settlementsTarget !== null ? (
        <AdvanceSettlementsSheet
          open={settlementsTarget !== null}
          onOpenChange={(open) => {
            if (!open) setSettlementsTarget(null);
          }}
          driverId={driverId}
          advanceId={settlementsTarget}
        />
      ) : null}
      <VoidOffsetSheet
        open={voidOffsetTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidOffsetTarget(null);
        }}
        driverId={driverId}
        offset={voidOffsetTarget}
      />
      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        driverId={driverId}
        today={today}
      />
      <DepositMovementSheet
        open={depositMovementOpen}
        onOpenChange={setDepositMovementOpen}
        driverId={driverId}
        depositId={historyQuery.data?.deposit?.id ?? null}
        obligations={historyQuery.data?.owedToUsObligations ?? []}
        today={today}
      />
      <VoidDepositMovementSheet
        open={voidDepositMovementTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidDepositMovementTarget(null);
        }}
        driverId={driverId}
        depositId={historyQuery.data?.deposit?.id ?? null}
        movement={voidDepositMovementTarget}
      />
      <WriteOffBalanceSheet
        open={writeOffOpen}
        onOpenChange={setWriteOffOpen}
        party={{ type: "driver", id: driverId }}
        today={today}
      />
      {recoveryTarget !== null ? (
        <WriteOffRecoverySheet
          open={recoveryTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRecoveryTarget(null);
          }}
          writeOffId={recoveryTarget.id}
          party={{ type: "driver", id: driverId }}
          today={today}
        />
      ) : null}
      {voidWriteOffTarget !== null ? (
        <VoidWriteOffSheet
          open={voidWriteOffTarget !== null}
          onOpenChange={(open) => {
            if (!open) setVoidWriteOffTarget(null);
          }}
          writeOffId={voidWriteOffTarget.id}
          party={{ type: "driver", id: driverId }}
        />
      ) : null}
      {recoveriesTarget !== null ? (
        <WriteOffRecoveriesSheet
          open={recoveriesTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRecoveriesTarget(null);
          }}
          writeOffId={recoveriesTarget}
          party={{ type: "driver", id: driverId }}
        />
      ) : null}
    </Screen>
  );
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}
