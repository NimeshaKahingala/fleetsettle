import { add, businessToday, format, parse, ZERO } from "@fleetsettle/shared";
import type {
  ExpenseListRow,
  IncidentResponse,
  VehicleDailyLeaseHistoryRow,
  VehicleDocumentResponse,
  VehicleLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarOff,
  CalendarPlus,
  ChevronRight,
  FileText,
  MoreVertical,
  PiggyBank,
  Receipt,
  Route,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { QueryStateFailure } from "../../components/QueryState.js";
import { Timeline, type TimelineEntry } from "../../components/Timeline.js";
import { ExpenseCostRow } from "../costs/ExpenseCostRow.js";
import { RecordExpenseSheet } from "../costs/RecordExpenseSheet.js";
import { ReportIncidentSheet } from "../incidents/ReportIncidentSheet.js";
import { ActionSheet, type ActionSheetAction } from "../../design/primitives/ActionSheet.js";
import { Badge } from "../../design/primitives/Badge.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";
import { ARRANGEMENT_BADGE_VARIANT, ARRANGEMENT_LABEL } from "../../lib/arrangementLabel.js";
import {
  INCIDENT_STATUS_BADGE_VARIANT,
  INCIDENT_STATUS_LABEL,
} from "../../lib/incidentStatusLabel.js";
import { useQueryState } from "../../lib/useQueryState.js";
import { VEHICLE_DOC_TYPE_LABEL } from "../../lib/vehicleDocumentLabel.js";
import { ChangeDailyLeaseRateSheet } from "./ChangeDailyLeaseRateSheet.js";
import { EndDailyLeaseSheet } from "./EndDailyLeaseSheet.js";
import { RenewVehicleDocumentSheet } from "./RenewVehicleDocumentSheet.js";

export interface VehicleOverviewScreenProps {
  vehicleId: string;
  onBack: () => void;
  onViewCalendar: () => void;
  /** History's own tap-through (Web-P6b) — daily-lease entries have no hub screen yet, so only a lease entry passes `onClick` (below). */
  onSelectLease: (leaseId: string) => void;
  /** Incidents section's own tap-through (Web-P8a) — also where a just-reported incident lands, from `ReportIncidentSheet`'s own `onCreated`. */
  onSelectIncident: (incidentId: string) => void;
  /** F-1.7 (B10) — offered only for a vehicle that could actually take one; see `vehicleActions` below. */
  onStartDailyLease: () => void;
  /** GAP-97 — the mirror of B10's own finding: booking works from the calendar and Quick Add, but not from the one screen where a manager is already looking at this vehicle. Offered only for arrangement B or C, matching `canBookTrip` on the calendar and `bookTrip`'s own server-side gate. */
  onBookTrip: () => void;
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
  onStartDailyLease,
  onBookTrip,
}: VehicleOverviewScreenProps) {
  const api = useApi();
  const today = businessToday();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reportIncidentOpen, setReportIncidentOpen] = useState(false);
  const [recordExpenseOpen, setRecordExpenseOpen] = useState(false);
  const [renewPaperworkOpen, setRenewPaperworkOpen] = useState(false);
  const [endDailyLeaseOpen, setEndDailyLeaseOpen] = useState(false);
  const [changeDailyLeaseRateOpen, setChangeDailyLeaseRateOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<VehicleDocumentResponse | null>(null);
  const vehicleQuery = useQuery({
    queryKey: ["vehicle", vehicleId],
    queryFn: () => api.get<VehicleResponse>(`/api/vehicle/${vehicleId}`),
  });
  const vehicle = vehicleQuery.data;
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
  const vehicleState = useQueryState(vehicleQuery);
  const documentsState = useQueryState(documentsQuery);
  const expensesState = useQueryState(expensesQuery);
  const leaseHistoryState = useQueryState(leaseHistoryQuery);
  const dailyLeaseHistoryState = useQueryState(dailyLeaseHistoryQuery);
  const incidentsState = useQueryState(incidentsQuery);

  const documents = documentsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  // GAP-96: a manager voiding a cost row had nothing on this screen to
  // check the effect against — the row-level void itself was already
  // correct (GAP-81). Voided rows are excluded, the same rule
  // `TripDetailScreen`'s "Costs so far" already uses.
  const costsTotal = expenses
    .filter((row) => row.voidedAt === null)
    .reduce((sum, row) => add(sum, parse(row.amountMinor)), ZERO);
  const historyEntries = buildHistoryEntries(
    leaseHistoryQuery.data ?? [],
    dailyLeaseHistoryQuery.data ?? [],
    onSelectLease,
  );
  const historyFailure =
    leaseHistoryState.kind === "error"
      ? leaseHistoryState
      : dailyLeaseHistoryState.kind === "error"
        ? dailyLeaseHistoryState
        : null;

  // F-1.7's entry point, and the one this flow was missing entirely until
  // B10 (GAP-51). Offered when the vehicle is on arrangement B **or has no
  // active arrangement at all** — the latter is precisely the vehicle you
  // would start one on, and `arrangement` is undefined exactly then. Hidden
  // for A and C, whose own start flows live on the calendar (F-2.1/F-5.1);
  // `VehicleCalendarScreen`'s `canStartLease`/`canBookTrip` gate the same way.
  const canStartDailyLease = vehicle?.arrangement === undefined || vehicle.arrangement === "B";
  // GAP-97: the same gate `bookTrip` itself enforces server-side and
  // `VehicleCalendarScreen`'s own `canBookTrip` uses — never A, never unset.
  const canBookTrip = vehicle?.arrangement === "B" || vehicle?.arrangement === "C";
  // F-4.8/GAP-25: offered only when a daily lease is actually running — the
  // history entry with no `effectiveTo` yet is exactly that one, the same
  // "ongoing" reading `buildHistoryEntries` above already gives it.
  const activeDailyLease = (dailyLeaseHistoryQuery.data ?? []).find(
    (row) => row.effectiveTo === null,
  );

  const vehicleActions: ActionSheetAction[] = [
    { key: "calendar", label: "View calendar", icon: CalendarDays, onSelect: onViewCalendar },
    {
      key: "paperwork",
      label: "Renew paperwork",
      icon: FileText,
      onSelect: () => {
        setSelectedDocument(null);
        setRenewPaperworkOpen(true);
      },
    },
    ...(canStartDailyLease
      ? [
          {
            key: "daily-lease",
            label: "Start a daily lease",
            icon: CalendarPlus,
            onSelect: onStartDailyLease,
          },
        ]
      : []),
    ...(canBookTrip
      ? [
          {
            key: "book-trip",
            label: "Book trip",
            icon: Route,
            onSelect: onBookTrip,
          },
        ]
      : []),
    ...(activeDailyLease !== undefined
      ? [
          {
            key: "change-daily-lease-rate",
            label: "Change the daily lease amount",
            icon: PiggyBank,
            onSelect: () => setChangeDailyLeaseRateOpen(true),
          },
          {
            key: "end-daily-lease",
            label: "End daily lease",
            icon: CalendarOff,
            onSelect: () => setEndDailyLeaseOpen(true),
          },
        ]
      : []),
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
      {vehicleState.kind === "error" ? (
        <QueryStateFailure
          error={vehicleState.error}
          retry={vehicleState.retry}
          of="this vehicle"
        />
      ) : vehicle === undefined ? (
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
                <Badge variant={ARRANGEMENT_BADGE_VARIANT[vehicle.arrangement]}>
                  {ARRANGEMENT_LABEL[vehicle.arrangement] ?? vehicle.arrangement}
                </Badge>
              ) : (
                <NotAvailable reason="no active arrangement" />
              )}
            </div>
          </Card>

          {documentsState.kind === "error" ? (
            <QueryStateFailure
              error={documentsState.error}
              retry={documentsState.retry}
              of="paperwork"
            />
          ) : null}
          {documents.length > 0 ? (
            <Section
              title="Paperwork"
              count={documents.length}
              items={documents.map((doc) => (
                <button
                  key={doc.docType}
                  type="button"
                  onClick={() => {
                    setSelectedDocument(doc);
                    setRenewPaperworkOpen(true);
                  }}
                  className="w-full text-left"
                >
                  <Card className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-body text-ink-primary">
                        {VEHICLE_DOC_TYPE_LABEL[doc.docType] ?? doc.docType}
                      </p>
                      {doc.reference !== undefined ? (
                        <p className="text-caption text-ink-muted">{doc.reference}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-body-sm text-ink-muted">
                        Expires {formatShortDate(doc.expiryDate)}
                      </p>
                      <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                    </div>
                  </Card>
                </button>
              ))}
            />
          ) : null}

          {expensesState.kind === "error" ? (
            <QueryStateFailure
              error={expensesState.error}
              retry={expensesState.retry}
              of="this vehicle's costs"
            />
          ) : null}
          {expenses.length > 0 ? (
            <Section
              title="Costs"
              count={expenses.length}
              total={<Money value={costsTotal} />}
              items={expenses.map((expense) => (
                <ExpenseCostRow
                  key={expense.id}
                  expense={expense}
                  formattedDate={formatShortDate(expense.spentOn)}
                  invalidateKeys={[["vehicle", vehicleId, "expense"]]}
                />
              ))}
            />
          ) : null}

          {incidentsState.kind === "error" ? (
            <QueryStateFailure
              error={incidentsState.error}
              retry={incidentsState.retry}
              of="incidents"
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
                  <Card
                    accent={INCIDENT_STATUS_BADGE_VARIANT[incident.status]}
                    className="flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-body text-ink-primary">
                        {incident.description ?? "Incident with no description"}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {formatShortDate(incident.occurredOn)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={INCIDENT_STATUS_BADGE_VARIANT[incident.status]}>
                        {INCIDENT_STATUS_LABEL[incident.status] ?? incident.status}
                      </Badge>
                      <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                    </div>
                  </Card>
                </button>
              ))}
            />
          ) : null}

          {historyFailure !== null ? (
            <QueryStateFailure
              error={historyFailure.error}
              retry={() => {
                if (leaseHistoryState.kind === "error") leaseHistoryState.retry();
                if (dailyLeaseHistoryState.kind === "error") dailyLeaseHistoryState.retry();
              }}
              of="this vehicle's history"
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
          <RenewVehicleDocumentSheet
            open={renewPaperworkOpen}
            onOpenChange={setRenewPaperworkOpen}
            vehicleId={vehicleId}
            today={today}
            {...(selectedDocument !== null ? { initialDocument: selectedDocument } : {})}
          />
          {activeDailyLease !== undefined ? (
            <EndDailyLeaseSheet
              open={endDailyLeaseOpen}
              onOpenChange={setEndDailyLeaseOpen}
              vehicleId={vehicleId}
              dailyLeaseId={activeDailyLease.id}
              today={today}
            />
          ) : null}
          {activeDailyLease !== undefined ? (
            <ChangeDailyLeaseRateSheet
              open={changeDailyLeaseRateOpen}
              onOpenChange={setChangeDailyLeaseRateOpen}
              vehicleId={vehicleId}
              dailyLeaseId={activeDailyLease.id}
              today={today}
            />
          ) : null}
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
