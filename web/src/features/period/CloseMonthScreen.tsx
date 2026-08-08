import { parse, type BusinessDate } from "@fleetsettle/shared";
import type {
  CloseChecklistResponse,
  CloseAccountingPeriodResponse,
  PaymentListRow,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Can } from "../../components/Can.js";
import { Money } from "../../components/Money.js";
import { Button } from "../../design/primitives/Button.js";
import { Card } from "../../design/primitives/Card.js";
import { Dialog, DialogConfirmFooter } from "../../design/primitives/Dialog.js";
import { Screen } from "../../design/primitives/Screen.js";
import { ApiError } from "../../lib/api.js";
import { useApi } from "../../lib/ApiContext.js";
import { can } from "../../lib/capabilities.js";
import { useMe } from "../../lib/useMe.js";
import { CorrectPaymentSheet } from "./CorrectPaymentSheet.js";

export interface CloseMonthScreenProps {
  today: BusinessDate;
  onBack: () => void;
}

function formatPeriod(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return `${fmt.format(new Date(`${start}T00:00:00`))} – ${fmt.format(new Date(`${end}T00:00:00`))}`;
}

const CHECKLIST_ROWS: {
  key: keyof CloseChecklistResponse["checklist"];
  label: string;
}[] = [
  { key: "unconfirmedDays", label: "Days not yet confirmed" },
  { key: "openTrips", label: "Trips still open" },
  { key: "unreconciledAdvances", label: "Advances not yet closed" },
  { key: "pendingObligations", label: "Dues still outstanding" },
  { key: "openIncidents", label: "Incidents still open" },
];

/**
 * F-9.1/UC-98/UI §7.7 — the close checklist warns and lists, **never
 * blocks** (U-7): every count above renders, and the close action stays
 * enabled regardless of what they say. `Timeline`/`CorrectPaymentSheet`
 * below is F-8.2's "open the receipt, correct it" — the recent-payments
 * list is this screen's own decision for where that row lives, since §7.10
 * only says "open the receipt" without naming a screen.
 */
export function CloseMonthScreen({ today, onBack }: CloseMonthScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  // F-8.2/W-49: `POST /api/payment/{id}/correct` requires `reverseReceipt`
  // (owners only) — a manager can still see the list (`dailyOperations`
  // already covers reading it), but the row must not be tappable into an
  // action the Worker will only 403. M-22 applies to the affordance, not
  // the information.
  const canCorrect = can(me.role, "reverseReceipt");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [correctingPayment, setCorrectingPayment] = useState<PaymentListRow | null>(null);

  const checklistQuery = useQuery({
    queryKey: ["accounting-period", "checklist"],
    queryFn: () => api.get<CloseChecklistResponse>("/api/accounting-period/checklist"),
  });
  const paymentsQuery = useQuery({
    queryKey: ["payment"],
    queryFn: () => api.get<PaymentListRow[]>("/api/payment"),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.post<CloseAccountingPeriodResponse>("/api/accounting-period/close", {}),
    onSuccess: () => {
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["accounting-period"] });
    },
  });

  const isLocked = closeMutation.isError && closeMutation.error instanceof ApiError;

  const period = checklistQuery.data?.period ?? null;
  const closedResult = closeMutation.data ?? null;

  return (
    <Screen title="Close the month" onBack={onBack}>
      <div className="flex flex-col gap-4">
        {closedResult !== null ? (
          <Card className="flex flex-col gap-1 border-l-4 border-brand">
            <p className="text-body text-ink-primary">
              {formatPeriod(
                closedResult.closedPeriod.periodStart,
                closedResult.closedPeriod.periodEnd,
              )}{" "}
              is closed.
            </p>
            <p className="text-body-sm text-ink-secondary">
              {formatPeriod(closedResult.newPeriod.periodStart, closedResult.newPeriod.periodEnd)}{" "}
              is now open — every later write lands there.
            </p>
          </Card>
        ) : period !== null ? (
          <p className="text-body text-ink-primary">
            {formatPeriod(period.periodStart, period.periodEnd)}
          </p>
        ) : null}

        {checklistQuery.isError && closedResult === null ? (
          <p className="text-body-sm text-critical-ink">
            {checklistQuery.error instanceof Error
              ? checklistQuery.error.message
              : "No open accounting period for this business."}
          </p>
        ) : null}

        {checklistQuery.data !== undefined && closedResult === null ? (
          <div className="flex flex-col gap-2">
            {CHECKLIST_ROWS.map((row) => (
              <Card key={row.key} className="flex items-center justify-between gap-4">
                <span className="text-body text-ink-primary">{row.label}</span>
                <span className="text-body text-ink-secondary tabular-nums">
                  {checklistQuery.data.checklist[row.key]}
                </span>
              </Card>
            ))}
          </div>
        ) : null}

        {closedResult === null ? (
          <Can cap="closePeriod">
            <Button
              type="button"
              size="cta"
              onClick={() => setConfirmOpen(true)}
              disabled={checklistQuery.data === undefined}
            >
              Close this month
            </Button>
          </Can>
        ) : null}

        {isLocked ? (
          <p className="text-body-sm text-critical-ink">{closeMutation.error.message}</p>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-line-hairline pt-4">
          <h2 className="text-label font-medium text-ink-secondary">Recent payments</h2>
          {(paymentsQuery.data ?? []).length === 0 ? (
            <p className="text-body-sm text-ink-muted">No payments recorded yet.</p>
          ) : (
            (paymentsQuery.data ?? []).slice(0, 20).map((row) => {
              const rowBody = (
                <Card className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-body text-ink-primary">
                      {row.direction === "received" ? "Received" : "Paid"} — {row.partyType}
                    </p>
                    <p className="text-caption text-ink-muted">
                      {row.occurredOn} · {row.status}
                    </p>
                  </div>
                  <Money value={parse(row.amountMinor)} />
                </Card>
              );
              // W-49/M-22: correcting needs `reverseReceipt` (owners only).
              // `dailyOperations` (every STAFF role) already covers reading
              // the list, so a manager still sees these rows — they're just
              // not a button for him, the same "absent affordance, present
              // information" split the checklist counts already use.
              return canCorrect ? (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setCorrectingPayment(row)}
                  disabled={row.status === "reversed"}
                  className="w-full text-left disabled:opacity-50"
                >
                  {rowBody}
                </button>
              ) : (
                <div key={row.id}>{rowBody}</div>
              );
            })
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={
          period !== null
            ? `Close ${formatPeriod(period.periodStart, period.periodEnd)} permanently`
            : "Close this month"
        }
        description="This cannot be undone. The next month opens in the same action, and every later write lands there instead."
        footer={
          <DialogConfirmFooter
            confirmLabel={
              period !== null
                ? `Close ${new Intl.DateTimeFormat("en-GB", { month: "long" }).format(new Date(`${period.periodStart}T00:00:00`))} permanently`
                : "Close permanently"
            }
            onConfirm={() => closeMutation.mutate()}
            onCancel={() => setConfirmOpen(false)}
          />
        }
      />

      <CorrectPaymentSheet
        open={correctingPayment !== null}
        onOpenChange={(next) => {
          if (!next) setCorrectingPayment(null);
        }}
        payment={correctingPayment}
        today={today}
        onCorrected={() => void queryClient.invalidateQueries({ queryKey: ["payment"] })}
      />
    </Screen>
  );
}
