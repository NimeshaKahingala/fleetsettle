import { parse, type BusinessDate } from "@fleetsettle/shared";
import type {
  ExpenseListRow,
  IncidentDetailResponse,
  IncidentRecoveryResponse,
  InsuranceClaimResponse,
} from "@fleetsettle/shared/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, MoreVertical, TriangleAlert, Wallet } from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { CustomerContributionSheet } from "./CustomerContributionSheet.js";
import { InsuranceClaimSheet } from "./InsuranceClaimSheet.js";
import { OffRoadSheet } from "./OffRoadSheet.js";
import { RecoveryReceivedSheet } from "./RecoveryReceivedSheet.js";
import { SettleInsuranceClaimSheet } from "./SettleInsuranceClaimSheet.js";

export interface IncidentScreenProps {
  incidentId: string;
  today: BusinessDate;
  onBack: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  repairs_recorded: "Repairs recorded",
  recovery_pending: "Recovery pending",
  closed: "Closed",
};

const TREATMENT_LABEL: Record<string, string> = {
  continue: "Rent continues",
  credit_days: "Days credited",
  extend: "Rental extended",
};

const CLAIM_STATUS_LABEL: Record<string, string> = {
  submitted: "Submitted",
  in_progress: "In progress",
  settled: "Settled",
  rejected: "Rejected",
};

const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  fuel: "Fuel",
  tolls: "Tolls",
  fines: "Fines",
  cleaning: "Cleaning",
  tyres: "Tyres",
  servicing: "Servicing",
  repairs: "Repairs",
  insurance: "Insurance",
  licence: "Licence",
  crew_food: "Crew food",
  permits: "Permits",
  office: "Office",
  legal: "Legal",
  messaging: "Messaging",
  other: "Other",
};

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function isReceivable(recovery: IncidentRecoveryResponse): boolean {
  return parse(recovery.receivedAmountMinor) < parse(recovery.agreedAmountMinor);
}

function InsuranceClaimCard({ claim }: { claim: InsuranceClaimResponse }) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-label text-ink-secondary">Insurance claim</p>
        <p className="text-caption text-ink-muted">
          {CLAIM_STATUS_LABEL[claim.status] ?? claim.status}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-body text-ink-primary">Claimed</p>
        <Money value={parse(claim.claimedAmountMinor)} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-body text-ink-primary">Excess you bear</p>
        <Money value={parse(claim.excessBorneMinor)} />
      </div>
      {claim.receivedAmountMinor !== null ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-body text-ink-primary">Received</p>
          <Money value={parse(claim.receivedAmountMinor)} />
        </div>
      ) : null}
    </Card>
  );
}

/**
 * F-3.4/UC-12, UI §7.10: a container "opened once, edited independently
 * over weeks" (§6.6) — the bottom line (spent/recovered/expected/net cost
 * to you) shows "at the top, always," never buried under the sections that
 * produce it. Every action here (off-road, a new contribution, a claim)
 * stays available regardless of `status`; `closeIncident` never guards on
 * it either — closing is a manual bookkeeping wrap-up, not a lock.
 */
export function IncidentScreen({ incidentId, today, onBack }: IncidentScreenProps) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [offRoadOpen, setOffRoadOpen] = useState(false);
  const [contributionOpen, setContributionOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<IncidentRecoveryResponse | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  const incidentQuery = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => api.get<IncidentDetailResponse>(`/api/incident/${incidentId}`),
  });
  const expensesQuery = useQuery({
    queryKey: ["incident", incidentId, "expense"],
    queryFn: () => api.get<ExpenseListRow[]>(`/api/incident/${incidentId}/expense`),
  });

  const incident = incidentQuery.data;
  const expenses = expensesQuery.data ?? [];
  const customerRecoveries = (incident?.recoveries ?? []).filter((r) => r.source === "customer");
  const claim = incident?.insuranceClaim ?? null;
  const claimSettleable =
    claim !== null && (claim.status === "submitted" || claim.status === "in_progress");

  const closeMutation = useMutation({
    mutationFn: () => api.post<IncidentDetailResponse>(`/api/incident/${incidentId}/close`, {}),
    onSuccess: (closed) => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      void queryClient.invalidateQueries({ queryKey: ["vehicle", closed.vehicleId, "incident"] });
    },
  });

  const actions: ActionSheetAction[] =
    incident !== undefined
      ? [
          ...(incident.offRoadFrom === null
            ? [
                {
                  key: "off-road",
                  label: "Record off-road days",
                  icon: TriangleAlert,
                  onSelect: () => setOffRoadOpen(true),
                },
              ]
            : []),
          {
            key: "contribution",
            label: "Customer contribution",
            icon: Wallet,
            onSelect: () => setContributionOpen(true),
          },
          ...(incident.insuranceClaim === null
            ? [
                {
                  key: "claim",
                  label: "Submit insurance claim",
                  icon: AlertCircle,
                  onSelect: () => setClaimOpen(true),
                },
              ]
            : []),
        ]
      : [];

  return (
    <Screen
      title={incident !== undefined ? formatShortDate(incident.occurredOn) : "Incident"}
      onBack={onBack}
      {...(incident !== undefined
        ? {
            action: {
              label: "Incident actions",
              icon: MoreVertical,
              onClick: () => setActionsOpen(true),
            },
          }
        : {})}
      {...(incident !== undefined && incident.status !== "closed"
        ? {
            primaryAction: {
              label: "Close incident",
              disabled: closeMutation.isPending,
              onClick: () => closeMutation.mutate(),
            },
          }
        : {})}
    >
      {incident === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <p className="text-body-sm text-ink-muted">
              {STATUS_LABEL[incident.status] ?? incident.status}
            </p>
            <p className="text-body text-ink-primary">
              {incident.description ?? "No description recorded"}
            </p>
            {closeMutation.isError ? (
              <p className="text-body-sm text-critical-ink">{closeMutation.error.message}</p>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-3">
            <p className="text-label text-ink-secondary">Bottom line</p>
            <div className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">Total repairs</p>
              <Money value={parse(incident.bottomLine.totalRepairCostMinor)} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">Recovered</p>
              <Money value={parse(incident.bottomLine.totalRecoveredMinor)} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-body text-ink-primary">Pending recovery</p>
              <Money value={parse(incident.bottomLine.pendingRecoveryMinor)} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <p className="text-body font-medium text-ink-primary">Net cost to you</p>
              <Money value={parse(incident.bottomLine.netCostMinor)} className="text-title" />
            </div>
          </Card>

          {incident.offRoadFrom !== null && incident.offRoadTo !== null ? (
            <Card className="flex flex-col gap-1">
              <p className="text-label text-ink-secondary">Off-road</p>
              <p className="text-body text-ink-primary">
                {formatShortDate(incident.offRoadFrom)} – {formatShortDate(incident.offRoadTo)}
              </p>
              <p className="text-caption text-ink-muted">
                {incident.rentTreatment !== null
                  ? (TREATMENT_LABEL[incident.rentTreatment] ?? incident.rentTreatment)
                  : ""}
              </p>
            </Card>
          ) : null}

          {customerRecoveries.length > 0 ? (
            <Section
              title="Customer contributions"
              count={customerRecoveries.length}
              items={customerRecoveries.map((recovery) => {
                const row = (
                  <Card className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">Agreed</p>
                      <p className="text-caption text-ink-muted">
                        Received <Money value={parse(recovery.receivedAmountMinor)} />
                      </p>
                    </div>
                    <Money value={parse(recovery.agreedAmountMinor)} />
                  </Card>
                );
                return isReceivable(recovery) ? (
                  <button
                    key={recovery.id}
                    type="button"
                    onClick={() => setReceiveTarget(recovery)}
                    className="w-full text-left"
                  >
                    {row}
                  </button>
                ) : (
                  <div key={recovery.id}>{row}</div>
                );
              })}
            />
          ) : null}

          {claim !== null ? (
            <>
              {claimSettleable ? (
                <button
                  type="button"
                  onClick={() => setSettleOpen(true)}
                  className="w-full text-left"
                >
                  <InsuranceClaimCard claim={claim} />
                </button>
              ) : (
                <InsuranceClaimCard claim={claim} />
              )}
            </>
          ) : null}

          {expenses.length > 0 ? (
            <Section
              title="Repair costs"
              count={expenses.length}
              items={expenses.map((expense) => (
                <Card key={expense.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-4">
                    <p
                      className={
                        expense.voidedAt !== null
                          ? "text-body text-ink-muted line-through"
                          : "text-body text-ink-primary"
                      }
                    >
                      {EXPENSE_CATEGORY_LABEL[expense.category] ?? expense.category}
                    </p>
                    <Money
                      value={parse(expense.amountMinor)}
                      className={expense.voidedAt !== null ? "line-through text-ink-muted" : ""}
                    />
                  </div>
                  <p className="text-caption text-ink-muted">
                    {formatShortDate(expense.spentOn)}
                    {expense.voidedReason !== null ? ` · Voided: ${expense.voidedReason}` : ""}
                  </p>
                </Card>
              ))}
            />
          ) : null}

          <OffRoadSheet
            open={offRoadOpen}
            onOpenChange={setOffRoadOpen}
            incidentId={incidentId}
            today={today}
            onRecorded={() => setOffRoadOpen(false)}
          />
          <CustomerContributionSheet
            open={contributionOpen}
            onOpenChange={setContributionOpen}
            incidentId={incidentId}
            today={today}
            onRecorded={() => setContributionOpen(false)}
          />
          <InsuranceClaimSheet
            open={claimOpen}
            onOpenChange={setClaimOpen}
            incidentId={incidentId}
            today={today}
            onSubmitted={() => setClaimOpen(false)}
          />
          {receiveTarget !== null ? (
            <RecoveryReceivedSheet
              open={receiveTarget !== null}
              onOpenChange={(next) => {
                if (!next) setReceiveTarget(null);
              }}
              incidentId={incidentId}
              recoveryId={receiveTarget.id}
              agreedAmountMinor={parse(receiveTarget.agreedAmountMinor)}
              receivedAmountMinor={parse(receiveTarget.receivedAmountMinor)}
              today={today}
              onRecorded={() => setReceiveTarget(null)}
            />
          ) : null}
          {incident.insuranceClaim !== null ? (
            <SettleInsuranceClaimSheet
              open={settleOpen}
              onOpenChange={setSettleOpen}
              incidentId={incidentId}
              claimId={incident.insuranceClaim.id}
              claimedAmountMinor={parse(incident.insuranceClaim.claimedAmountMinor)}
              excessBorneMinor={parse(incident.insuranceClaim.excessBorneMinor)}
              receivedAmountMinor={
                incident.insuranceClaim.receivedAmountMinor !== null
                  ? parse(incident.insuranceClaim.receivedAmountMinor)
                  : null
              }
              today={today}
              onSettled={() => setSettleOpen(false)}
            />
          ) : null}
          <ActionSheet
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            title="Incident actions"
            actions={actions}
          />
        </div>
      )}
    </Screen>
  );
}
