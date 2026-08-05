import { businessToday, format, parse } from "@fleetsettle/shared";
import type {
  ExpenseListRow,
  IncidentResponse,
  VehicleDailyLeaseHistoryRow,
  VehicleDocumentResponse,
  VehicleLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MoreVertical, Receipt, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn.js";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { Timeline, type TimelineEntry } from "../../components/Timeline.js";
import { RecordExpenseSheet } from "../costs/RecordExpenseSheet.js";
import { ReportIncidentSheet } from "../incidents/ReportIncidentSheet.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { EXPENSE_CATEGORY_LABEL } from "../../lib/expenseCategoryLabels.js";

const ARRANGEMENT_LABEL: Record<string, string> = {
  A: "Lease out",
  B: "Daily lease",
  C: "Trips / charter",
};

const DOC_TYPE_LABEL: Record<string, string> = {
  insurance: "Insurance",
  registration: "Registration",
  revenue_licence: "Revenue licence",
  permit: "Permit",
  emissions: "Emissions",
};

const INCIDENT_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  repairs_recorded: "Repairs recorded",
  recovery_pending: "Recovery pending",
  closed: "Closed",
};

export interface VehicleOverviewScreenProps {
  vehicleId: string;
  onBack: () => void;
  onViewCalendar: () => void;
  /** History's own tap-through (Web-P6b) — daily-lease entries have no hub screen yet, so only a lease entry passes `onClick` (below). */
  onSelectLease: (leaseId: string) => void;
  /** Incidents section's own tap-through (Web-P8a) — also where a just-reported incident lands, from `ReportIncidentSheet`'s own `onCreated`. */
  onSelectIncident: (incidentId: string) => void;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/**
 * Web-P5's history tab: arrangement-A and -B periods merged into one
 * chronological list — `Timeline`'s own shape (who, when, what) already
 * fits an arrangement period without a new component. Web-P6b makes a
 * lease entry tappable, onto its own `/leases/:id` hub (§3.3); a
 * daily-lease entry stays a plain row — there is no daily-lease hub yet to
 * send it to.
 */
function buildHistoryEntries(
  leases: VehicleLeaseHistoryRow[],
  dailyLeases: VehicleDailyLeaseHistoryRow[],
  onSelectLease: (leaseId: string) => void,
): TimelineEntry[] {
  const leaseEntries = leases.map((row) => ({
    key: `lease-${row.id}`,
    who: row.customerName,
    whenLabel: `${formatShortDate(row.startDate)} – ${row.endDate !== null ? formatShortDate(row.endDate) : "ongoing"}`,
    description: `Lease out · Rs ${format(parse(row.rentAmountMinor))}/month`,
    sortDate: row.startDate,
    onClick: () => onSelectLease(row.id),
  }));
  const dailyLeaseEntries = dailyLeases.map((row) => ({
    key: `daily-lease-${row.id}`,
    who: row.driverName,
    whenLabel: `${formatShortDate(row.effectiveFrom)} – ${row.effectiveTo !== null ? formatShortDate(row.effectiveTo) : "ongoing"}`,
    description: `Daily lease · Rs ${format(parse(row.dailyLeaseAmountMinor))}/day`,
    sortDate: row.effectiveFrom,
  }));

  return [...leaseEntries, ...dailyLeaseEntries]
    .sort((a, b) => (a.sortDate < b.sortDate ? 1 : -1))
    .map(({ sortDate: _sortDate, ...entry }) => entry);
}

/**
 * F-1.1's overview — §3.3's `/vehicles/:id`. Registration, type, current
 * arrangement, plus Web-P5's paperwork/costs/history sections — each reads
 * independently and simply doesn't render when empty (the same convention
 * `HomeScreen` already uses per-section, not an overall empty state, since
 * the overview `Card` above always has real content). The `calendar` tab
 * (F-1.5, UI §7.6) is its own screen and route, reached via `Screen`'s one
 * contextual app-bar action (§4.2) rather than a section here.
 */
export function VehicleOverviewScreen({
  vehicleId,
  onBack,
  onViewCalendar,
  onSelectLease,
  onSelectIncident,
}: VehicleOverviewScreenProps) {
  const api = useApi();
  const today = businessToday();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reportIncidentOpen, setReportIncidentOpen] = useState(false);
  const [recordExpenseOpen, setRecordExpenseOpen] = useState(false);
  const { data: vehicle, isLoading } = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const documentsQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "document"],
    queryFn: () => api.get<VehicleDocumentResponse[]>(`/api/vehicle/${vehicleId}/document`),
  });
  const expensesQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "expense"],
    queryFn: () => api.get<ExpenseListRow[]>(`/api/vehicle/${vehicleId}/expense`),
  });
  const leaseHistoryQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "lease"],
    queryFn: () => api.get<VehicleLeaseHistoryRow[]>(`/api/vehicle/${vehicleId}/lease`),
  });
  const dailyLeaseHistoryQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "daily-lease"],
    queryFn: () => api.get<VehicleDailyLeaseHistoryRow[]>(`/api/vehicle/${vehicleId}/daily-lease`),
  });
  const incidentsQuery = useQuery({
    queryKey: ["vehicle", vehicleId, "incident"],
    queryFn: () => api.get<IncidentResponse[]>(`/api/vehicle/${vehicleId}/incident`),
  });

  const documents = documentsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const historyEntries = buildHistoryEntries(
    leaseHistoryQuery.data ?? [],
    dailyLeaseHistoryQuery.data ?? [],
    onSelectLease,
  );

  const vehicleActions: ActionSheetAction[] = [
    { key: "calendar", label: "View calendar", icon: CalendarDays, onSelect: onViewCalendar },
    {
      key: "expense",
      label: "Record expense",
      icon: Receipt,
      onSelect: () => setRecordExpenseOpen(true),
    },
    {
      key: "incident",
      label: "Report incident",
      icon: TriangleAlert,
      onSelect: () => setReportIncidentOpen(true),
    },
  ];

  return (
    <Screen
      title={vehicle?.registration ?? "Vehicle"}
      onBack={onBack}
      action={{ label: "Vehicle actions", icon: MoreVertical, onClick: () => setActionsOpen(true) }}
    >
      {isLoading || vehicle === undefined ? (
        <p className="text-body-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <div>
              <p className="text-label text-ink-secondary">Registration</p>
              <p className="text-title text-ink-primary">{vehicle.registration}</p>
            </div>
            <div>
              <p className="text-label text-ink-secondary">Type</p>
              <p className="text-body text-ink-primary">{vehicle.vehicleType}</p>
            </div>
            <div>
              <p className="text-label text-ink-secondary">Arrangement</p>
              {vehicle.arrangement !== undefined ? (
                <p className="text-body text-ink-primary">
                  {ARRANGEMENT_LABEL[vehicle.arrangement] ?? vehicle.arrangement}
                </p>
              ) : (
                <NotAvailable reason="no active arrangement" />
              )}
            </div>
          </Card>

          {documents.length > 0 ? (
            <Section
              title="Paperwork"
              count={documents.length}
              items={documents.map((doc) => (
                <Card key={doc.docType} className="flex items-center justify-between gap-4">
                  <p className="text-body text-ink-primary">
                    {DOC_TYPE_LABEL[doc.docType] ?? doc.docType}
                  </p>
                  <p className="text-body-sm text-ink-muted">
                    Expires {formatShortDate(doc.expiryDate)}
                  </p>
                </Card>
              ))}
            />
          ) : null}

          {expenses.length > 0 ? (
            <Section
              title="Costs"
              count={expenses.length}
              items={expenses.map((expense) => (
                <Card key={expense.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-4">
                    <p
                      className={cn(
                        "text-body",
                        expense.voidedAt !== null
                          ? "text-ink-muted line-through"
                          : "text-ink-primary",
                      )}
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

          {incidents.length > 0 ? (
            <Section
              title="Incidents"
              count={incidents.length}
              items={incidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => onSelectIncident(incident.id)}
                  className="w-full text-left"
                >
                  <Card className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">
                        {incident.description ?? "No description recorded"}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(incident.occurredOn)}
                      </p>
                    </div>
                    <p className="text-caption text-ink-muted">
                      {INCIDENT_STATUS_LABEL[incident.status] ?? incident.status}
                    </p>
                  </Card>
                </button>
              ))}
            />
          ) : null}

          {historyEntries.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-label font-medium text-ink-secondary">
                History · {historyEntries.length}
              </h2>
              <Card>
                <Timeline entries={historyEntries} />
              </Card>
            </section>
          ) : null}

          <ReportIncidentSheet
            open={reportIncidentOpen}
            onOpenChange={setReportIncidentOpen}
            vehicleId={vehicleId}
            today={today}
            onCreated={(incidentId) => {
              setReportIncidentOpen(false);
              onSelectIncident(incidentId);
            }}
          />
          <RecordExpenseSheet
            open={recordExpenseOpen}
            onOpenChange={setRecordExpenseOpen}
            vehicleId={vehicleId}
            today={today}
            onRecorded={() => setRecordExpenseOpen(false)}
          />
          <ActionSheet
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            title="Vehicle actions"
            actions={vehicleActions}
          />
        </div>
      )}
    </Screen>
  );
}
