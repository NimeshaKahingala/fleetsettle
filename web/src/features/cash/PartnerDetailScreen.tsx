import { toWire, type BusinessDate, type Minor } from "@fleetsettle/shared";
import type {
  CapitalContributionResponse,
  CapitalContributionsResponse,
  PartnerPayoutResponse,
  PartnerPayoutsResponse,
  PartnerSummaryResponse,
  BankingEventsResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Landmark } from "lucide-react";
import { useState } from "react";
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
import { useApi } from "../../lib/ApiContext.js";
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
                  : "min-h-tap rounded-sm border border-line-strong px-2 text-body-sm text-ink-primary"
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

export function PartnerDetailScreen({ userId, today, onBack }: PartnerDetailScreenProps) {
  const api = useApi();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [capitalOpen, setCapitalOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ["partner", userId],
    queryFn: () => api.get<PartnerSummaryResponse>(`/api/partner/${userId}`),
  });
  const contributionsQuery = useQuery({
    queryKey: ["capital-contribution", userId],
    queryFn: () =>
      api.get<CapitalContributionsResponse>(`/api/capital-contribution?userId=${userId}`),
  });
  const payoutsQuery = useQuery({
    queryKey: ["partner-payout", userId],
    queryFn: () => api.get<PartnerPayoutsResponse>(`/api/partner-payout?userId=${userId}`),
  });
  const bankingQuery = useQuery({
    queryKey: ["banking-event", userId],
    queryFn: () => api.get<BankingEventsResponse>(`/api/banking-event?userId=${userId}`),
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
      primaryAction={{ label: "Partner money", onClick: () => setActionsOpen(true) }}
    >
      {summaryState.kind === "error" ? (
        <QueryStateFailure
          error={summaryState.error}
          retry={summaryState.retry}
          of="this partner"
        />
      ) : summary === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-1">
            <span className="text-caption text-ink-muted">Balance</span>
            <Money
              value={BigInt(summary.balanceMinor) as Minor}
              className="text-title-lg font-medium"
            />
          </Card>
          <Card className="flex flex-col">
            <SummaryRow label="Contributions" amountMinor={summary.putIn.contributionsMinor} />
            <SummaryRow label="Out of pocket" amountMinor={summary.putIn.outOfPocketMinor} />
            <SummaryRow label="Payouts" amountMinor={summary.takenOut.payoutsMinor} />
            <SummaryRow label="Settlements" amountMinor={summary.takenOut.settlementsMinor} />
            <SummaryRow label="Profit share" amountMinor={summary.earned.profitShareMinor} />
            <SummaryRow label="Management fee" amountMinor={summary.earned.managementFeeMinor} />
            <SummaryRow label="Holding" amountMinor={summary.holdingMinor} />
          </Card>

          {contributionsState.kind === "error" ? (
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
                <Card key={row.id} className="flex items-center justify-between gap-4">
                  <p className="text-body text-ink-primary">{formatShortDate(row.contributedOn)}</p>
                  <Money value={BigInt(row.amountMinor) as Minor} />
                </Card>
              ))}
            />
          ) : null}

          {payoutsState.kind === "error" ? (
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
                <Card key={row.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-body text-ink-primary">
                      {row.kind === "payout" ? "Payout" : "Settlement"}
                    </p>
                    <p className="text-caption text-ink-muted">{formatShortDate(row.occurredOn)}</p>
                  </div>
                  <Money value={BigInt(row.amountMinor) as Minor} />
                </Card>
              ))}
            />
          ) : null}

          {bankingState.kind === "error" ? (
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
                <Card key={row.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-body text-ink-primary">{row.destination}</p>
                    <p className="text-caption text-ink-muted">{formatShortDate(row.bankedOn)}</p>
                  </div>
                  <Money value={BigInt(row.amountCountedMinor) as Minor} />
                </Card>
              ))}
            />
          ) : null}
        </div>
      )}

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
    </Screen>
  );
}
