import { format, parse } from "@fleetsettle/shared";
import type {
  ExpenseListRow,
  VehicleDailyLeaseHistoryRow,
  VehicleDocumentResponse,
  VehicleLeaseHistoryRow,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Money } from "../../components/Money.js";
import { NotAvailable } from "../../components/NotAvailable.js";
import { Timeline, type TimelineEntry } from "../../components/Timeline.js";
import { Card } from "../../design/primitives/Card.js";
import { Screen } from "../../design/primitives/Screen.js";
import { Section } from "../../design/primitives/Section.js";
import { useApi } from "../../lib/ApiContext.js";

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

export interface VehicleOverviewScreenProps {
  vehicleId: string;
  onBack: () => void;
  onViewCalendar: () => void;
}

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

/** Web-P5's history tab: arrangement-A and -B periods merged into one chronological list — `Timeline`'s own shape (who, when, what) already fits an arrangement period without a new component. */
function buildHistoryEntries(
  leases: VehicleLeaseHistoryRow[],
  dailyLeases: VehicleDailyLeaseHistoryRow[],
): TimelineEntry[] {
  const leaseEntries = leases.map((row) => ({
    key: `lease-${row.id}`,
    who: row.customerName,
    whenLabel: `${formatShortDate(row.startDate)} – ${row.endDate !== null ? formatShortDate(row.endDate) : "ongoing"}`,
    description: `Lease out · Rs ${format(parse(row.rentAmountMinor))}/month`,
    sortDate: row.startDate,
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
}: VehicleOverviewScreenProps) {
  const api = useApi();
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

  const documents = documentsQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];
  const historyEntries = buildHistoryEntries(
    leaseHistoryQuery.data ?? [],
    dailyLeaseHistoryQuery.data ?? [],
  );

  return (
    <Screen
      title={vehicle?.registration ?? "Vehicle"}
      onBack={onBack}
      action={{ label: "View calendar", icon: CalendarDays, onClick: onViewCalendar }}
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
        </div>
      )}
    </Screen>
  );
}
