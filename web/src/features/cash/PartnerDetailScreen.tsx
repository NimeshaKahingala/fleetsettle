import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  BankingEventsResponse,
  CapitalContributionResponse,
  CapitalContributionsResponse,
  PartnerPayoutResponse,
  PartnerPayoutsResponse,
  PartnerSummaryResponse,
  SessionResponse,
  VoidedResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { DateField } from "../../components/DateField.js";
import { Money } from "../../components/Money.js";
import { MoneyField } from "../../components/MoneyField.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { NoteField } from "../../design/primitives/NoteField.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { Sheet } from "../../design/primitives/Sheet.js";
import { StatTile } from "../../design/primitives/StatTile.js";
import { useApi } from "../../lib/ApiContext.js";
import { can } from "../../lib/capabilities.js";
import { resolveSelectedMembership } from "../../lib/selectedMembership.js";
import { useQueryState } from "../../lib/useQueryState.js";

export interface PartnerDetailScreenProps {
  userId: string;
  today: BusinessDate;
  onBack: () => void;
}

function displayName(name: string | null): string {
  return name ?? "Unnamed partner";
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function SummaryRow({ label, amountMinor }: { label: string; amountMinor: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line-hairline py-2 last:border-b-0">
      <span className="text-body text-ink-secondary">{label}</span>
      <Money value={BigInt(amountMinor) as Minor} />
    </div>
  );
}

function CapitalContributionSheet({
  open,
  onOpenChange,
  userId,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  today: BusinessDate;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [contributedOn, setContributedOn] = useState<BusinessDate>(today);
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      if (amountMinor === null) throw new Error("Enter an amount");
      return api.post<CapitalContributionResponse>("/api/capital-contribution", {
        userId,
        amountMinor: toWire(amountMinor),
        contributedOn,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["partner", userId] });
      void queryClient.invalidateQueries({ queryKey: ["capital-contribution", userId] });
      setAmountMinor(null);
      setNote("");
      setContributedOn(today);
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Capital contribution">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField
          label="Contributed on"
          value={contributedOn}
          today={today}
          onChange={setContributedOn}
        />
        <NoteField value={note} onChange={setNote} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={amountMinor === null || mutation.isPending}>
          Save contribution
        </Button>
      </form>
    </Sheet>
  );
}

function PartnerPayoutSheet({
  open,
  onOpenChange,
  userId,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  today: BusinessDate;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [amountMinor, setAmountMinor] = useState<Minor | null>(null);
  const [occurredOn, setOccurredOn] = useState<BusinessDate>(today);
  const [kind, setKind] = useState<"payout" | "partner_settlement">("payout");

  const mutation = useMutation({
    mutationFn: () => {
      if (amountMinor === null) throw new Error("Enter an amount");
      return api.post<PartnerPayoutResponse>("/api/partner-payout", {
        userId,
        amountMinor: toWire(amountMinor),
        kind,
        occurredOn,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["partner", userId] });
      void queryClient.invalidateQueries({ queryKey: ["partner-payout", userId] });
      setAmountMinor(null);
      setOccurredOn(today);
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Partner payout">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["payout", "Payout"],
              ["partner_settlement", "Settlement"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={
                kind === value
                  ? "min-h-tap rounded-sm border border-brand bg-brand-wash px-2 text-body-sm text-brand-ink"
                  : "min-h-tap rounded-sm border border-transparent bg-surface-sunken px-2 text-body-sm text-ink-primary"
              }
            >
              {label}
            </button>
          ))}
        </div>
        <MoneyField label="Amount" valueMinor={amountMinor} onChange={setAmountMinor} />
        <DateField label="Occurred on" value={occurredOn} today={today} onChange={setOccurredOn} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button type="submit" size="cta" disabled={amountMinor === null || mutation.isPending}>
          Save payout
        </Button>
      </form>
    </Sheet>
  );
}

interface VoidTarget {
  id: string;
}

/** GAP-147/W-61: void a capital contribution — the `voidOffset` shape, same gate as recording one (`managePartnerCapital`). */
function VoidCapitalContributionSheet({
  open,
  onOpenChange,
  userId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  target: VoidTarget | null;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (target === null) throw new Error("Choose a contribution");
      return api.post<VoidedResponse>(`/api/capital-contribution/${target.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["partner", userId] });
      void queryClient.invalidateQueries({ queryKey: ["capital-contribution", userId] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void contribution">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a contribution entered by mistake. The row stays visible with your reason.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Void contribution
        </Button>
      </div>
    </Sheet>
  );
}

/** GAP-147/W-61: void a payout or settlement — same gate as recording one (`managePartnerCapital`). */
function VoidPartnerPayoutSheet({
  open,
  onOpenChange,
  userId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  target: VoidTarget | null;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (target === null) throw new Error("Choose a payout");
      return api.post<VoidedResponse>(`/api/partner-payout/${target.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["partner", userId] });
      void queryClient.invalidateQueries({ queryKey: ["partner-payout", userId] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void payout">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a payout or settlement entered by mistake. The row stays visible with your
          reason.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Void payout
        </Button>
      </div>
    </Sheet>
  );
}

/** GAP-147/W-61/INV-23: void a banking event — same gate as recording one (`dailyOperations`). Removes the whole event, its shortfall included (no child rows to unwind). */
function VoidBankingEventSheet({
  open,
  onOpenChange,
  userId,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  target: VoidTarget | null;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (target === null) throw new Error("Choose a banking event");
      return api.post<VoidedResponse>(`/api/banking-event/${target.id}/void`, {
        reason: reason.trim(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reports", "cash-position"] });
      void queryClient.invalidateQueries({ queryKey: ["banking-event", userId] });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Void banking">
      <div className="flex flex-col gap-4">
        <p className="text-body-sm text-ink-secondary">
          This corrects a banking event entered by mistake, shortfall included. The row stays
          visible with your reason.
        </p>
        <NoteField label="Reason" value={reason} onChange={setReason} />
        {mutation.isError ? (
          <p className="text-body-sm text-critical-ink">{mutation.error.message}</p>
        ) : null}
        <Button
          size="cta"
          variant="destructive"
          disabled={reason.trim() === "" || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Void banking
        </Button>
      </div>
    </Sheet>
  );
}

export function PartnerDetailScreen({ userId, today, onBack }: PartnerDetailScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [voidContributionTarget, setVoidContributionTarget] = useState<VoidTarget | null>(null);
  const [voidPayoutTarget, setVoidPayoutTarget] = useState<VoidTarget | null>(null);
  const [voidBankingTarget, setVoidBankingTarget] = useState<VoidTarget | null>(null);

  const session = queryClient.getQueryData<SessionResponse>(["session"]);
  const selectedRole = session !== undefined ? resolveSelectedMembership(session)?.role : undefined;
  // GAP-147: `summaryQuery`/`contributionsQuery`/`payoutsQuery` all require
  // `managePartnerCapital` (owners) on the Worker; `bankingQuery` requires
  // `dailyOperations` (all three operational roles) — banking is an
  // ordinary operational entry (F-7.4), never partner capital. Previously
  // none of the four was gated client-side, so a manager who reached this
  // screen (nothing blocks the navigation from CashScreen) got the whole
  // summary read's 403 rendered as a permanent "Loading…" — found fixing
  // GAP-147's own void buttons, same shape as GAP-155.
  const canManagePartnerCapital =
    selectedRole !== undefined && can(selectedRole, "managePartnerCapital");
  const canBankingOps = selectedRole !== undefined && can(selectedRole, "dailyOperations");

  const summaryQuery = useQuery({
    queryKey: ["partner", userId],
    queryFn: () => api.get<PartnerSummaryResponse>(`/api/partner/${userId}`),
    enabled: canManagePartnerCapital,
  });
  const contributionsQuery = useQuery({
    queryKey: ["capital-contribution", userId],
    queryFn: () =>
      api.get<CapitalContributionsResponse>(`/api/capital-contribution?userId=${userId}`),
    enabled: canManagePartnerCapital,
  });
  const payoutsQuery = useQuery({
    queryKey: ["partner-payout", userId],
    queryFn: () => api.get<PartnerPayoutsResponse>(`/api/partner-payout?userId=${userId}`),
    enabled: canManagePartnerCapital,
  });
  const bankingQuery = useQuery({
    queryKey: ["banking-event", userId],
    queryFn: () => api.get<BankingEventsResponse>(`/api/banking-event?userId=${userId}`),
    enabled: canBankingOps,
  });

  const summaryState = useQueryState(summaryQuery);
  const contributionsState = useQueryState(contributionsQuery);
  const payoutsState = useQueryState(payoutsQuery);
  const bankingState = useQueryState(bankingQuery);
  const summary = summaryQuery.data;
  const contributions = contributionsQuery.data ?? [];
  const payouts = payoutsQuery.data ?? [];
  const bankings = bankingQuery.data ?? [];

  const actions: ActionSheetAction[] = [
    {
      key: "capital",
      label: "Capital contribution",
      icon: Landmark,
      onSelect: () => setCapitalOpen(true),
    },
    {
      key: "payout",
      label: "Partner payout",
      icon: HandCoins,
      onSelect: () => setPayoutOpen(true),
    },
  ];

  return (
    <Screen
      title={summary !== undefined ? displayName(summary.displayName) : "Partner"}
      onBack={onBack}
      {...(canManagePartnerCapital
        ? { primaryAction: { label: "Partner money", onClick: () => setActionsOpen(true) } }
        : {})}
    >
      <div className="flex flex-col gap-5">
        {canManagePartnerCapital ? (
          summaryState.kind === "error" ? (
            <QueryStateFailure
              error={summaryState.error}
              retry={summaryState.retry}
              of="this partner"
            />
          ) : summary === undefined ? (
            <p className="text-body-sm text-ink-muted">Loading…</p>
          ) : (
            <>
              <StatTile
                label="Balance"
                value={<Money value={BigInt(summary.balanceMinor) as Minor} />}
                size="hero"
              />
              <Card className="flex flex-col">
                <SummaryRow label="Contributions" amountMinor={summary.putIn.contributionsMinor} />
                <SummaryRow label="Out of pocket" amountMinor={summary.putIn.outOfPocketMinor} />
                <SummaryRow label="Payouts" amountMinor={summary.takenOut.payoutsMinor} />
                <SummaryRow label="Settlements" amountMinor={summary.takenOut.settlementsMinor} />
                <SummaryRow label="Profit share" amountMinor={summary.earned.profitShareMinor} />
                <SummaryRow
                  label="Management fee"
                  amountMinor={summary.earned.managementFeeMinor}
                />
                <SummaryRow label="Holding" amountMinor={summary.holdingMinor} />
              </Card>
            </>
          )
        ) : null}

        {canManagePartnerCapital ? (
          contributionsState.kind === "error" ? (
            <QueryStateFailure
              error={contributionsState.error}
              retry={contributionsState.retry}
              of="capital contributions"
            />
          ) : contributions.length > 0 ? (
            <Section
              title="Capital contributions"
              count={contributions.length}
              items={contributions.map((row) => (
                <Card
                  key={row.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body text-ink-primary">
                      {formatShortDate(row.contributedOn)}
                    </p>
                    {row.voidedAt !== null ? (
                      <p className="text-caption text-ink-muted">Voided</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-4 sm:items-end">
                    <Money value={BigInt(row.amountMinor) as Minor} />
                    {row.voidedAt === null ? (
                      <button
                        type="button"
                        onClick={() => setVoidContributionTarget({ id: row.id })}
                        className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      >
                        Void contribution
                      </button>
                    ) : null}
                  </div>
                </Card>
              ))}
            />
          ) : null
        ) : null}

        {canManagePartnerCapital ? (
          payoutsState.kind === "error" ? (
            <QueryStateFailure
              error={payoutsState.error}
              retry={payoutsState.retry}
              of="partner payouts"
            />
          ) : payouts.length > 0 ? (
            <Section
              title="Payouts and settlements"
              count={payouts.length}
              items={payouts.map((row) => (
                <Card
                  key={row.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body text-ink-primary">
                      {row.kind === "payout" ? "Payout" : "Settlement"}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {formatShortDate(row.occurredOn)}
                      {row.voidedAt !== null ? " · voided" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-4 sm:items-end">
                    <Money value={BigInt(row.amountMinor) as Minor} />
                    {row.voidedAt === null ? (
                      <button
                        type="button"
                        onClick={() => setVoidPayoutTarget({ id: row.id })}
                        className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      >
                        Void payout
                      </button>
                    ) : null}
                  </div>
                </Card>
              ))}
            />
          ) : null
        ) : null}

        {canBankingOps ? (
          bankingState.kind === "error" ? (
            <QueryStateFailure
              error={bankingState.error}
              retry={bankingState.retry}
              of="banking events"
            />
          ) : bankings.length > 0 ? (
            <Section
              title="Banking"
              count={bankings.length}
              items={bankings.map((row) => (
                <Card
                  key={row.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-body text-ink-primary">{row.destination}</p>
                    <p className="text-caption text-ink-muted">
                      {formatShortDate(row.bankedOn)}
                      {row.voidedAt !== null ? " · voided" : ""}
                    </p>
                  </div>
                  <div className="flex flex-col gap-4 sm:items-end">
                    <Money value={BigInt(row.amountCountedMinor) as Minor} />
                    {row.voidedAt === null ? (
                      <button
                        type="button"
                        onClick={() => setVoidBankingTarget({ id: row.id })}
                        className="min-h-tap rounded-sm border border-critical px-3 text-body text-critical-ink"
                      >
                        Void banking
                      </button>
                    ) : null}
                  </div>
                </Card>
              ))}
            />
          ) : null
        ) : null}
      </div>

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Partner money"
        actions={actions}
      />
      <CapitalContributionSheet
        open={capitalOpen}
        onOpenChange={setCapitalOpen}
        userId={userId}
        today={today}
      />
      <PartnerPayoutSheet
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        userId={userId}
        today={today}
      />
      <VoidCapitalContributionSheet
        open={voidContributionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidContributionTarget(null);
        }}
        userId={userId}
        target={voidContributionTarget}
      />
      <VoidPartnerPayoutSheet
        open={voidPayoutTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidPayoutTarget(null);
        }}
        userId={userId}
        target={voidPayoutTarget}
      />
      <VoidBankingEventSheet
        open={voidBankingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setVoidBankingTarget(null);
        }}
        userId={userId}
        target={voidBankingTarget}
      />
    </Screen>
  );
}
