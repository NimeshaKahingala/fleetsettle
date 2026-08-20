import { addDays, asBusinessDate, type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  SessionResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
  useSearch,
  type RouterHistory,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell, type OperateTabKey, type ReviewTabKey } from "../design/primitives/AppShell.js";
import { AdminHomeScreen } from "../features/admin/AdminHomeScreen.js";
import { AdminManagementScreen } from "../features/admin/AdminManagementScreen.js";
import { BusinessesListScreen } from "../features/admin/BusinessesListScreen.js";
import { PlatformAuditLogScreen } from "../features/admin/PlatformAuditLogScreen.js";
import { RequestQueueScreen } from "../features/admin/RequestQueueScreen.js";
import { UsersListScreen } from "../features/admin/UsersListScreen.js";
import { CashScreen } from "../features/cash/CashScreen.js";
import { MileagePackagesScreen } from "../features/cash/MileagePackagesScreen.js";
import { PartnerDetailScreen } from "../features/cash/PartnerDetailScreen.js";
import { PartnerSetupScreen } from "../features/cash/PartnerSetupScreen.js";
import { BusinessSwitcherSheet } from "../features/setup/BusinessSwitcherSheet.js";
import { isBlockedOperatePathname } from "../lib/blockedOperatePathname.js";
import { FirstRunGate } from "../features/setup/FirstRunGate.js";
import { HomeScreen } from "../features/home/HomeScreen.js";
import { IncidentScreen } from "../features/incidents/IncidentScreen.js";
import { CloseLeaseScreen } from "../features/leases/CloseLeaseScreen.js";
import { LeaseHubScreen } from "../features/leases/LeaseHubScreen.js";
import { MembersScreen } from "../features/members/MembersScreen.js";
import { MineScreen } from "../features/mine/MineScreen.js";
import { MoreScreen } from "../features/more/MoreScreen.js";
import { OpeningBalanceScreen } from "../features/opening-balance/OpeningBalanceScreen.js";
import { CustomerDetailScreen } from "../features/people/CustomerDetailScreen.js";
import { DriverDetailScreen } from "../features/people/DriverDetailScreen.js";
import { PeopleListScreen } from "../features/people/PeopleListScreen.js";
import { CloseMonthScreen } from "../features/period/CloseMonthScreen.js";
import { QuickAddSheet } from "../features/quick-add/QuickAddSheet.js";
import { AgeingReportScreen } from "../features/reports/AgeingReportScreen.js";
import { CashPositionReportScreen } from "../features/reports/CashPositionReportScreen.js";
import { ExportTransactionsScreen } from "../features/reports/ExportTransactionsScreen.js";
import { FuelEfficiencyReportScreen } from "../features/reports/FuelEfficiencyReportScreen.js";
import { GoodwillReportScreen } from "../features/reports/GoodwillReportScreen.js";
import { LostDaysReportScreen } from "../features/reports/LostDaysReportScreen.js";
import { ReceivablesReportScreen } from "../features/reports/ReceivablesReportScreen.js";
import {
  ReportsCatalogueScreen,
  type ReportKey,
} from "../features/reports/ReportsCatalogueScreen.js";
import { TripRankingReportScreen } from "../features/reports/TripRankingReportScreen.js";
import { UtilisationReportScreen } from "../features/reports/UtilisationReportScreen.js";
import { VehicleMonthReportScreen } from "../features/reports/VehicleMonthReportScreen.js";
import { VehicleYearReportScreen } from "../features/reports/VehicleYearReportScreen.js";
import { ReviewMoneyScreen } from "../features/review/ReviewMoneyScreen.js";
import { ReviewThisMonthScreen } from "../features/review/ReviewThisMonthScreen.js";
import { ReviewVehicleDetailScreen } from "../features/review/ReviewVehicleDetailScreen.js";
import { ReviewVehiclesScreen } from "../features/review/ReviewVehiclesScreen.js";
import { BookTripScreen } from "../features/trips/BookTripScreen.js";
import { TripDetailScreen } from "../features/trips/TripDetailScreen.js";
import { StartDailyLeaseScreen } from "../features/vehicles/StartDailyLeaseScreen.js";
import { StartLeaseScreen } from "../features/vehicles/StartLeaseScreen.js";
import { VehicleCalendarScreen } from "../features/vehicles/VehicleCalendarScreen.js";
import { VehicleListScreen } from "../features/vehicles/VehicleListScreen.js";
import { VehicleOverviewScreen } from "../features/vehicles/VehicleOverviewScreen.js";
import { useMe } from "../lib/useMe.js";
import { useSelectedBusiness } from "../lib/useSelectedBusiness.js";
import { useApi } from "../lib/ApiContext.js";
import { NotBuiltYetScreen } from "./NotBuiltYetScreen.js";

function HomeRoute() {
  const navigate = useNavigate();
  return (
    <HomeScreen
      onSelectVehicle={(vehicleId: string) => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
      onSelectTrip={(tripId: string) => {
        void navigate({ to: "/trips/$tripId", params: { tripId } });
      }}
    />
  );
}

/**
 * §3.3's route map, code-based rather than file-based:
 * `@tanstack/router-plugin`'s file-based mode emits a committed
 * `routeTree.gen.ts`, and this project hand-writes its SQL migrations
 * specifically to avoid generated artefacts it cannot review
 * (write-migration skill). The route set is small and fixed (§3.1: "fixed
 * order, never reordered or filtered"), so `createRoute` gives full type
 * inference with no build step and nothing generated in the diff.
 */

function VehiclesListRoute({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  return (
    <VehicleListScreen
      today={today}
      onSelectVehicle={(vehicle: VehicleResponse) => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId: vehicle.id } });
      }}
    />
  );
}

function VehicleDetailRoute() {
  const { vehicleId } = useParams({ from: "/vehicles/$vehicleId" });
  const navigate = useNavigate();
  return (
    <VehicleOverviewScreen
      vehicleId={vehicleId}
      onBack={() => {
        void navigate({ to: "/vehicles" });
      }}
      onStartDailyLease={() => {
        void navigate({ to: "/vehicles/$vehicleId/daily-lease/new", params: { vehicleId } });
      }}
      onBookTrip={() => {
        void navigate({ to: "/vehicles/$vehicleId/trip/new", params: { vehicleId } });
      }}
      onViewCalendar={() => {
        void navigate({ to: "/vehicles/$vehicleId/calendar", params: { vehicleId } });
      }}
      onSelectLease={(leaseId: string) => {
        void navigate({ to: "/leases/$leaseId", params: { leaseId } });
      }}
      onSelectIncident={(incidentId: string) => {
        void navigate({ to: "/incidents/$incidentId", params: { incidentId } });
      }}
    />
  );
}

/** §3.3's `/leases/:id` — reached today only from a vehicle's own History (Web-P6c adds a second entry point, the calendar's tap-through). `onBack` is real browser/router-history `back()`, not a hardcoded parent, since which vehicle's history the manager came from isn't this route's to know. */
function LeaseDetailRoute() {
  const { leaseId } = useParams({ from: "/leases/$leaseId" });
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <LeaseHubScreen
      leaseId={leaseId}
      onBack={() => router.history.back()}
      onCloseLease={() => {
        void navigate({ to: "/leases/$leaseId/close", params: { leaseId } });
      }}
    />
  );
}

/** F-2.6's own route (Web-P6d) — an in-screen stepper, not seven routes (§3.3 gives the lease one route for all of F-2.1→F-2.8). `onClosed` lands on the vehicle's own overview, now showing it available again. */
function CloseLeaseRoute({ today }: { today: BusinessDate }) {
  const { leaseId } = useParams({ from: "/leases/$leaseId/close" });
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <CloseLeaseScreen
      leaseId={leaseId}
      today={today}
      onBack={() => router.history.back()}
      onClosed={(vehicleId) => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
    />
  );
}

function VehicleCalendarRoute({ today }: { today: BusinessDate }) {
  const { vehicleId } = useParams({ from: "/vehicles/$vehicleId/calendar" });
  const navigate = useNavigate();
  return (
    <VehicleCalendarScreen
      vehicleId={vehicleId}
      today={today}
      onBack={() => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
      onSelectFreeDay={(date) => {
        void navigate({
          to: "/vehicles/$vehicleId/lease/new",
          params: { vehicleId },
          search: { startDate: date },
        });
      }}
      onSelectFreeDayForTrip={(date) => {
        void navigate({
          to: "/vehicles/$vehicleId/trip/new",
          params: { vehicleId },
          search: { startDate: date },
        });
      }}
    />
  );
}

/** F-1.5's calendar tap-through, F-2.1 half (Web-P6c) — reached with `?startDate=` already validated by the route below. `onCreated` lands on the new lease's own hub. */
function StartLeaseRoute({ today }: { today: BusinessDate }) {
  const { vehicleId } = useParams({ from: "/vehicles/$vehicleId/lease/new" });
  const { startDate } = useSearch({ from: "/vehicles/$vehicleId/lease/new" });
  const navigate = useNavigate();
  return (
    <StartLeaseScreen
      vehicleId={vehicleId}
      today={today}
      {...(startDate !== undefined ? { initialStartDate: startDate } : {})}
      onBack={() => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
      onCreated={(leaseId) => {
        void navigate({ to: "/leases/$leaseId", params: { leaseId } });
      }}
    />
  );
}

/**
 * F-1.7 (B10) — arrangement B's own start flow, reached from the vehicle's
 * "Vehicle actions" menu. No `?startDate=` search param, unlike its two
 * neighbours: F-1.5's calendar tap-through is scoped to F-2.1 and F-5.1 by
 * its own spec, so nothing routes here with a date already chosen.
 * `onCreated` lands back on the vehicle, which is where the new arrangement
 * and its day cards will show — a daily lease has no hub screen of its own
 * (the same reason `VehicleOverviewScreen`'s history rows only make lease
 * entries tappable).
 */
function StartDailyLeaseRoute({ today }: { today: BusinessDate }) {
  const { vehicleId } = useParams({ from: "/vehicles/$vehicleId/daily-lease/new" });
  const navigate = useNavigate();
  return (
    <StartDailyLeaseScreen
      vehicleId={vehicleId}
      today={today}
      onBack={() => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
      onCreated={() => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
    />
  );
}

/** F-1.5's calendar tap-through, F-5.1 half (Web-P7) — the same `?startDate=` validation the lease route already established. `onBooked` lands on the new trip's own detail screen. */
function BookTripRoute({ today }: { today: BusinessDate }) {
  const { vehicleId } = useParams({ from: "/vehicles/$vehicleId/trip/new" });
  const { startDate } = useSearch({ from: "/vehicles/$vehicleId/trip/new" });
  const navigate = useNavigate();
  return (
    <BookTripScreen
      vehicleId={vehicleId}
      today={today}
      {...(startDate !== undefined ? { initialStartDate: startDate } : {})}
      onBack={() => {
        void navigate({ to: "/vehicles/$vehicleId", params: { vehicleId } });
      }}
      onBooked={(tripId) => {
        void navigate({ to: "/trips/$tripId", params: { tripId } });
      }}
    />
  );
}

/** UI §7.5's container screen (Web-P7) — reached from Home's item 7 or the calendar's own tap-through; `onBack` is real router-history `back()`, the same reason `LeaseHubScreen`'s is, since a trip has more than one place it can be reached from. */
function TripDetailRoute({ today }: { today: BusinessDate }) {
  const { tripId } = useParams({ from: "/trips/$tripId" });
  const router = useRouter();
  return <TripDetailScreen tripId={tripId} today={today} onBack={() => router.history.back()} />;
}

/** UC §6.6's container (Web-P8a) — §3.3's `/incidents/:id`, reached from a vehicle's own Incidents section (`VehicleOverviewScreen`), including a just-reported one. `onBack` is real router-history `back()`, the same convention every other hub/container route here already uses. */
function IncidentDetailRoute({ today }: { today: BusinessDate }) {
  const { incidentId } = useParams({ from: "/incidents/$incidentId" });
  const router = useRouter();
  return (
    <IncidentScreen incidentId={incidentId} today={today} onBack={() => router.history.back()} />
  );
}

function PeopleListRoute() {
  const navigate = useNavigate();
  return (
    <PeopleListScreen
      onSelectDriver={(driver: DriverResponse) => {
        void navigate({ to: "/people/drivers/$driverId", params: { driverId: driver.id } });
      }}
      onSelectCustomer={(customer: CustomerResponse) => {
        void navigate({
          to: "/people/customers/$customerId",
          params: { customerId: customer.id },
        });
      }}
    />
  );
}

function DriverDetailRoute() {
  const { driverId } = useParams({ from: "/people/drivers/$driverId" });
  const navigate = useNavigate();
  return <DriverDetailScreen driverId={driverId} onBack={() => void navigate({ to: "/people" })} />;
}

function CustomerDetailRoute() {
  const { customerId } = useParams({ from: "/people/customers/$customerId" });
  const navigate = useNavigate();
  return (
    <CustomerDetailScreen customerId={customerId} onBack={() => void navigate({ to: "/people" })} />
  );
}

/** F-0.2/B12 — reached from `/more`'s own row, gated `<Can cap="manageOpeningBalances">` there. `onBack` returns to `/more`, matching every other action reached from that hub. */
function OpeningBalanceRoute({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  return <OpeningBalanceScreen today={today} onBack={() => void navigate({ to: "/more" })} />;
}

/** F-9.1/B3 — `/period/close`, reached from `/more`'s own row, gated `<Can cap="closePeriod">` there (M-22: absent for a manager, both at the door and inside). */
function CloseMonthRoute({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  return <CloseMonthScreen today={today} onBack={() => void navigate({ to: "/more" })} />;
}

/** A11/UI-8: owner-only member access under More, not People — this grants access to the business itself, distinct from customer/driver records. */
function MembersRoute() {
  const navigate = useNavigate();
  return <MembersScreen onBack={() => void navigate({ to: "/more" })} />;
}

function CashRoute({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  return (
    <CashScreen
      today={today}
      onBack={() => void navigate({ to: "/more" })}
      onSelectPartner={(userId) => {
        void navigate({ to: "/partners/$userId", params: { userId } });
      }}
    />
  );
}

function PartnerDetailRoute({ today }: { today: BusinessDate }) {
  const { userId } = useParams({ from: "/partners/$userId" });
  const navigate = useNavigate();
  return (
    <PartnerDetailScreen
      userId={userId}
      today={today}
      onBack={() => void navigate({ to: "/cash" })}
    />
  );
}

/** F-1.3/F-1.4: ownership shares and vehicle-manager sharing are setup, not cash movement. */
function PartnerSetupRoute({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  return <PartnerSetupScreen today={today} onBack={() => void navigate({ to: "/more" })} />;
}

/** F-1.9/GAP-67: saved mileage packages, reached from More because they are setup data reused by the lease start flow rather than a vehicle's own record. */
function MileagePackagesRoute() {
  const navigate = useNavigate();
  return <MileagePackagesScreen onBack={() => void navigate({ to: "/more" })} />;
}

/**
 * GAP-153/F-5: `/review` and `/reports` are top-level tabs for an `owner`,
 * but drill-downs from Operate's `/more` for `owner_manager`/`manager`.
 * Only the latter needs a visible Back affordance.
 */
function useOperateReviewBack(): (() => void) | undefined {
  const navigate = useNavigate();
  const me = useMe();
  if (me.role !== "owner_manager" && me.role !== "manager") return undefined;
  return () => void navigate({ to: "/more" });
}

/** B4/§5.4: `This month`'s own tab — the per-vehicle card navigates into the read-only Vehicles-tab detail (never `VehicleOverviewScreen`, §7.8's "no entry affordance anywhere"); "What I'm owed" navigates to `My money`, the same figure in more detail. */
function ReviewThisMonthRoute() {
  const navigate = useNavigate();
  const reviewBack = useOperateReviewBack();
  return (
    <ReviewThisMonthScreen
      {...(reviewBack !== undefined ? { onBack: reviewBack } : {})}
      onSelectVehicle={(vehicleId, periodId) => {
        void navigate({
          to: "/review/vehicles/$vehicleId",
          params: { vehicleId },
          search: { periodId },
        });
      }}
      onSelectMyMoney={() => {
        void navigate({ to: "/review/money" });
      }}
    />
  );
}

/** B4/§5.5: `Vehicles`' own tab — one vehicle × all periods, cutting orthogonally from `This month`'s one period × all vehicles. */
function ReviewVehiclesRoute() {
  const navigate = useNavigate();
  return (
    <ReviewVehiclesScreen
      onSelectVehicle={(vehicleId, periodId) => {
        void navigate({
          to: "/review/vehicles/$vehicleId",
          params: { vehicleId },
          search: { periodId },
        });
      }}
    />
  );
}

/** B4/§5.5: the read-only Review vehicle detail, reached from either `This month` or `Vehicles` — `router.history.back()` for the same "more than one entry point" reason `LeaseDetailRoute`/`TripDetailRoute` already use it. */
function ReviewVehicleDetailRoute() {
  const { vehicleId } = useParams({ from: "/review/vehicles/$vehicleId" });
  const { periodId } = useSearch({ from: "/review/vehicles/$vehicleId" });
  const router = useRouter();
  return (
    <ReviewVehicleDetailScreen
      vehicleId={vehicleId}
      periodId={periodId}
      onBack={() => router.history.back()}
    />
  );
}

/** B4/§5.6: `My money`'s own tab — `GET /api/partner/{userId}` rendered read-only, for the signed-in user's own id. */
function ReviewMoneyRoute() {
  const reviewBack = useOperateReviewBack();
  return <ReviewMoneyScreen {...(reviewBack !== undefined ? { onBack: reviewBack } : {})} />;
}

const REPORT_PATH: Record<ReportKey, string> = {
  "vehicle-month": "/reports/vehicle-month",
  "vehicle-year": "/reports/vehicle-year",
  trips: "/reports/trips",
  "fuel-efficiency": "/reports/fuel-efficiency",
  receivables: "/reports/receivables",
  "cash-position": "/reports/cash-position",
  "lost-days": "/reports/lost-days",
  ageing: "/reports/ageing",
  goodwill: "/reports/goodwill",
  utilisation: "/reports/utilisation",
  export: "/reports/export",
};

/** B4/§5.1: the catalogue — eleven cards (GAP-98, then GAP-18), reached identically from the Review shell's own `Reports` tab and Operate's `/more` row (§4's IA). */
function ReportsRoute() {
  const navigate = useNavigate();
  const reviewBack = useOperateReviewBack();
  return (
    <ReportsCatalogueScreen
      {...(reviewBack !== undefined ? { onBack: reviewBack } : {})}
      onSelect={(key) => {
        void navigate({ to: REPORT_PATH[key] });
      }}
    />
  );
}

/** B4/§5.2: `periodId` defaults inside the screen itself (the currently-open period, once the period list resolves) — the route only carries an explicit choice made via the screen's own picker. */
function VehicleMonthReportRoute() {
  const { periodId } = useSearch({ from: "/reports/vehicle-month" });
  const navigate = useNavigate();
  return (
    <VehicleMonthReportScreen
      {...(periodId !== undefined ? { periodId } : {})}
      onPeriodChange={(id) => {
        void navigate({ to: "/reports/vehicle-month", search: { periodId: id } });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

function TripsReportRoute() {
  const navigate = useNavigate();
  return (
    <TripRankingReportScreen
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** B4/§5.2: defaults to the last 90 days ending today (UC-72's own default) when the route carries no explicit window yet. */
function FuelEfficiencyReportRoute({ today }: { today: BusinessDate }) {
  const { vehicleId, from, to } = useSearch({ from: "/reports/fuel-efficiency" });
  const navigate = useNavigate();
  return (
    <FuelEfficiencyReportScreen
      {...(vehicleId !== undefined ? { vehicleId } : {})}
      from={from ?? addDays(today, -90)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/fuel-efficiency", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

function ReceivablesReportRoute() {
  const navigate = useNavigate();
  return (
    <ReceivablesReportScreen
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

function CashPositionReportRoute() {
  const navigate = useNavigate();
  return (
    <CashPositionReportScreen
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** B4/§5.2: defaults to the current calendar month so far — UC-76's own text says "the open period," which needs a fetch this route can't make at search-param-validation time; the screen's own date fields let the manager widen it in two taps. */
function LostDaysReportRoute({ today }: { today: BusinessDate }) {
  const { from, to } = useSearch({ from: "/reports/lost-days" });
  const navigate = useNavigate();
  return (
    <LostDaysReportScreen
      from={from ?? asBusinessDate(`${today.slice(0, 7)}-01`)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/lost-days", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** GAP-98: defaults to today, matching UC-78's own "as of" framing — the ageing buckets are as-of-now views, not period-scoped. */
function AgeingReportRoute({ today }: { today: BusinessDate }) {
  const { asOfDate } = useSearch({ from: "/reports/ageing" });
  const navigate = useNavigate();
  return (
    <AgeingReportScreen
      asOfDate={asOfDate ?? today}
      today={today}
      onParamsChange={(date) => {
        void navigate({ to: "/reports/ageing", search: { asOfDate: date } });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** GAP-98: defaults to the current calendar year — UC-77's own framing is "per year", unlike lost-days' current-month default. */
function GoodwillReportRoute({ today }: { today: BusinessDate }) {
  const { from, to } = useSearch({ from: "/reports/goodwill" });
  const navigate = useNavigate();
  return (
    <GoodwillReportScreen
      from={from ?? asBusinessDate(`${today.slice(0, 4)}-01-01`)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/goodwill", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** GAP-98: the same last-90-days default `FuelEfficiencyReportRoute` uses — the other report parameterised by both a vehicle and a window. */
function UtilisationReportRoute({ today }: { today: BusinessDate }) {
  const { vehicleId, from, to } = useSearch({ from: "/reports/utilisation" });
  const navigate = useNavigate();
  return (
    <UtilisationReportScreen
      {...(vehicleId !== undefined ? { vehicleId } : {})}
      from={from ?? addDays(today, -90)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/utilisation", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** GAP-18: the same current-calendar-year default `GoodwillReportRoute` uses — UC-73's own framing is "the year", not a rolling window. */
function VehicleYearReportRoute({ today }: { today: BusinessDate }) {
  const { from, to } = useSearch({ from: "/reports/vehicle-year" });
  const navigate = useNavigate();
  return (
    <VehicleYearReportScreen
      from={from ?? asBusinessDate(`${today.slice(0, 4)}-01-01`)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/vehicle-year", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** GAP-18: the same current-calendar-year default `VehicleYearReportRoute` uses — "a year of transactions", UC-99's own framing. */
function ExportTransactionsRoute({ today }: { today: BusinessDate }) {
  const { from, to } = useSearch({ from: "/reports/export" });
  const navigate = useNavigate();
  return (
    <ExportTransactionsScreen
      from={from ?? asBusinessDate(`${today.slice(0, 4)}-01-01`)}
      to={to ?? today}
      today={today}
      onParamsChange={(params) => {
        void navigate({ to: "/reports/export", search: params });
      }}
      onBack={() => {
        void navigate({ to: "/reports" });
      }}
    />
  );
}

/** B5's own item builds `MineScreen`; B0b only needs the route and the shell to exist. */
function MineRoute({ today }: { today: BusinessDate }) {
  return <MineScreen today={today} />;
}

function useAdminRouteAllowed(): boolean {
  const api = useApi();
  const navigate = useNavigate();
  // allow: FirstRunGate owns the user-facing /api/session loading/error UI.
  // This child-route observer only prevents premature admin data reads.
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => api.get<SessionResponse>("/api/session"),
  });
  const session = sessionQuery.data;
  const allowed = session?.isPlatformAdmin === true;

  useEffect(() => {
    if (session !== undefined && !allowed) void navigate({ to: "/", replace: true });
  }, [allowed, navigate, session]);

  return allowed;
}

/**
 * UI §3.1 (added 18 Aug 2026): `/admin/*`, reached only once `FirstRunGate`
 * has already gated on `isPlatformAdmin` — every sub-screen's own `onBack`
 * returns to the hub, matching every other `/more`-owned sub-screen's
 * convention. GAP-154/F-6 adds the local route guard because these routes are
 * flat siblings in TanStack Router: a matched child can evaluate before the
 * root gate has rendered its chosen shell, so each admin route must refuse to
 * mount its data-reading screen until the session cache proves platform-admin
 * access.
 */
function AdminRequestsRoute() {
  const navigate = useNavigate();
  const allowed = useAdminRouteAllowed();
  if (!allowed) return null;
  return <RequestQueueScreen onBack={() => void navigate({ to: "/admin" })} />;
}

function AdminBusinessesRoute() {
  const navigate = useNavigate();
  const allowed = useAdminRouteAllowed();
  if (!allowed) return null;
  return <BusinessesListScreen onBack={() => void navigate({ to: "/admin" })} />;
}

function AdminUsersRoute() {
  const navigate = useNavigate();
  const allowed = useAdminRouteAllowed();
  if (!allowed) return null;
  return <UsersListScreen onBack={() => void navigate({ to: "/admin" })} />;
}

function AdminAdminsRoute() {
  const navigate = useNavigate();
  const allowed = useAdminRouteAllowed();
  if (!allowed) return null;
  return <AdminManagementScreen onBack={() => void navigate({ to: "/admin" })} />;
}

function AdminAuditLogRoute() {
  const navigate = useNavigate();
  const allowed = useAdminRouteAllowed();
  if (!allowed) return null;
  return <PlatformAuditLogScreen onBack={() => void navigate({ to: "/admin" })} />;
}

/**
 * Maps a pathname onto the operate shell's tab bar (§3.1's five fixed
 * tabs). `＋` (quick-add) is deliberately absent from this map — it is a
 * sheet trigger, never a route (§3.1: "no route change").
 *
 * GAP-89: More-owned routes (`/review*`, `/reports*`, `/period/close`,
 * `/opening-balances`, B2/member/package setup routes) highlight **More**
 * rather than falling through to Home. `/trips/:id`, `/incidents/:id` and
 * `/leases/:id` (including its own `/close` step) highlight **Vehicles**, the
 * domain parent every one of them shares regardless of whether the tap came
 * from Home, the vehicle itself, or the calendar — true origin-tracking was
 * considered and declined (it would need state threaded through every
 * `navigate()` call site that can reach these routes).
 */
function tabForPathname(pathname: string): OperateTabKey {
  if (pathname.startsWith("/vehicles")) return "vehicles";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/more")) return "more";
  if (
    pathname.startsWith("/review") ||
    pathname.startsWith("/reports") ||
    pathname.startsWith("/period/close") ||
    pathname.startsWith("/opening-balances") ||
    pathname.startsWith("/members") ||
    pathname.startsWith("/cash") ||
    pathname.startsWith("/partners") ||
    pathname.startsWith("/vehicle-sharing") ||
    pathname.startsWith("/mileage-packages")
  ) {
    return "more";
  }
  if (
    pathname.startsWith("/trips/") ||
    pathname.startsWith("/incidents/") ||
    pathname.startsWith("/leases/")
  ) {
    return "vehicles";
  }
  return "home";
}

const TAB_PATH: Record<OperateTabKey, string> = {
  home: "/",
  vehicles: "/vehicles",
  people: "/people",
  more: "/more",
};

/** Maps a pathname onto the Review shell's tab bar (REVIEW_TABS, §3.1). */
function tabForReviewPathname(pathname: string): ReviewTabKey {
  if (pathname.startsWith("/review/vehicles")) return "vehicles";
  if (pathname.startsWith("/review/money")) return "money";
  if (pathname.startsWith("/reports")) return "reports";
  return "month";
}

const REVIEW_TAB_PATH: Record<ReviewTabKey, string> = {
  month: "/review",
  vehicles: "/review/vehicles",
  money: "/review/money",
  reports: "/reports",
};

/**
 * UI §3.1/M-33 (19 Aug 2026): the voluntary switch, distinct from
 * `FirstRunGate`'s own mandatory one. `FirstRunGate`'s `remountGeneration`
 * counter (see its own doc comment) is private to that component and
 * private to the *mandatory* pre-shell case — there is no way to reach it
 * from three render-prop layers down without threading a callback through
 * `FirstRunGateProps` and every shell layout below it. A real navigation
 * sidesteps the "hard remount" problem entirely rather than risking a
 * fourth failed attempt at the in-app version: `queryClient.clear()` alone
 * does not un-stick an already-mounted `useQuery(["session"])` observer
 * (confirmed empirically, `FirstRunGate.tsx`'s own comment), and this
 * component's `["session"]` read is exactly that observer, still mounted
 * two layers up in `FirstRunGate` itself.
 */
function reloadAfterBusinessSwitch(): void {
  window.location.reload();
}

/**
 * Shared by every shell's own voluntary switcher (never `FirstRunGate`'s
 * mandatory one, which needs none of this — its `onOpenChange` is inert).
 *
 * **Fixes a real race, gitar review on PR #78, 19 Aug 2026**:
 * `BusinessSwitcherSheet.selectBusiness` calls `onSelected` then
 * `onOpenChange(false)` — a real `onOpenChange` (a plain `setState`, unlike
 * `FirstRunGate`'s inert one) re-renders this shell, which calls
 * `useSelectedBusiness()` again, which throws: `queryClient.clear()` (also
 * called by `selectBusiness`, just before either callback) has already
 * emptied `["session"]`, and `window.location.reload()` — fired from
 * `onSelected`, a moment earlier — does not synchronously halt the rest of
 * this script, so that re-render can and does flush before the browser
 * actually tears the page down. `reloadingRef` breaks the chain: once
 * `onSelected` has fired, the following `onOpenChange(false)` is swallowed
 * instead of reaching `setState`, so no re-render — and no throw — happens
 * at all in the moment before reload.
 */
function useBusinessSwitcherToggle(): {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openSwitcher: () => void;
  onSelected: () => void;
} {
  const [open, setOpen] = useState(false);
  const reloadingRef = useRef(false);
  return {
    open,
    onOpenChange: (next) => {
      if (reloadingRef.current) return;
      setOpen(next);
    },
    openSwitcher: () => setOpen(true),
    onSelected: () => {
      reloadingRef.current = true;
      reloadAfterBusinessSwitch();
    },
  };
}

/**
 * B0b: `owner`'s shell — its own component tree (§7.9), not Operate filtered
 * by role. `/review*` and `/reports*` are the only paths that belong to it;
 * anything else (most commonly the bare `/` an owner lands on straight out
 * of `FirstRunGate`, since `/` is Operate's Home in the shared route tree)
 * redirects to the default tab. An effect, not a render-time redirect, for
 * the same reason `FirstRunGate` already defers routing decisions until its
 * own data is ready — one redirect pattern in this file, not two.
 */
function ReviewLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const inReview = pathname.startsWith("/review") || pathname.startsWith("/reports");
  const selected = useSelectedBusiness();
  const switcher = useBusinessSwitcherToggle();

  useEffect(() => {
    if (!inReview) void navigate({ to: "/review", replace: true });
  }, [inReview, navigate]);

  return (
    <AppShell
      shell="review"
      activeTab={tabForReviewPathname(pathname)}
      onTabChange={(key) => {
        void navigate({ to: REVIEW_TAB_PATH[key as ReviewTabKey] });
      }}
      businessName={selected.name}
      onSwitchBusiness={switcher.openSwitcher}
    >
      {inReview ? <Outlet /> : null}
      <BusinessSwitcherSheet
        open={switcher.open}
        onOpenChange={switcher.onOpenChange}
        businesses={selected.businesses}
        currentBusinessId={selected.businessId}
        createBusiness={{ pendingRequest: selected.pendingRequest }}
        onSelected={switcher.onSelected}
      />
    </AppShell>
  );
}

/** B0b: `driver`'s shell — one screen, no tab bar (§7.9), reached at `/me` alone. Same redirect reasoning as `ReviewLayout`. */
function MineLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const inMine = pathname === "/me";
  const selected = useSelectedBusiness();
  const switcher = useBusinessSwitcherToggle();

  useEffect(() => {
    if (!inMine) void navigate({ to: "/me", replace: true });
  }, [inMine, navigate]);

  return (
    <AppShell shell="mine" businessName={selected.name} onSwitchBusiness={switcher.openSwitcher}>
      {inMine ? <Outlet /> : null}
      <BusinessSwitcherSheet
        open={switcher.open}
        onOpenChange={switcher.onOpenChange}
        businesses={selected.businesses}
        currentBusinessId={selected.businessId}
        createBusiness={{ pendingRequest: selected.pendingRequest }}
        onSelected={switcher.onSelected}
      />
    </AppShell>
  );
}

/**
 * UI §3.1 (added 18 Aug 2026): the platform admin surface — not a fourth
 * business-role shell (M-3). No redirect effect the way `ReviewLayout`/
 * `MineLayout` have: those exist because their shell renders unconditionally
 * once a role resolves, regardless of pathname, so an out-of-shell URL needs
 * steering back in. This shell only ever mounts because `FirstRunGate`
 * already gated it on the pathname being under `/admin` (see `RootLayout`
 * below), so there is nothing to redirect from.
 */
function AdminLayout() {
  const navigate = useNavigate();
  return (
    <AppShell
      shell="admin"
      onExit={{ label: "Leave admin panel", onClick: () => void navigate({ to: "/" }) }}
    >
      <Outlet />
    </AppShell>
  );
}

/**
 * B0b: `owner-manager`/`manager`'s shell. Extracted out of `RootLayout`'s
 * own `renderOperate` closure (19 Aug 2026) rather than left inline — the
 * business-switcher chrome needs `useSelectedBusiness()`, which throws
 * unless a membership is already resolved (its own doc comment), a
 * guarantee `RootLayout` itself cannot make (it wraps `FirstRunGate`, which
 * is what resolves one). A real component here, matching
 * `ReviewLayout`/`MineLayout`/`AdminLayout`'s own pattern, is what gives
 * the hook somewhere legal to be called from — its own `pathname`
 * subscription is the same independent-`useRouterState`-per-shell pattern
 * those three already use, rather than threading it down as a prop.
 */
function OperateLayout({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const selected = useSelectedBusiness();
  const switcher = useBusinessSwitcherToggle();
  const blockedShellPathname = isBlockedOperatePathname(pathname);

  // GAP-134: `QuickAddSheet` lives here, outside every route, so a route
  // change while it's open (an iOS edge-swipe back — iOS has no hardware
  // back button/gesture for `useCloseWatcherDismiss` to answer, only this
  // real history navigation) would otherwise leave it open over the wrong
  // screen. Every other sheet is owned by the route it opens on and
  // unmounts with it for free; this is the one exception.
  useEffect(() => {
    setQuickAddOpen(false);
  }, [pathname]);

  // GAP-154/F-6: Operate deliberately hosts `/review*` and `/reports*` when
  // reached from More, but it must not render the Mine or platform-admin
  // surfaces inside Operate chrome.
  useEffect(() => {
    if (blockedShellPathname) void navigate({ to: "/", replace: true });
  }, [blockedShellPathname, navigate]);

  return (
    <AppShell
      shell="operate"
      activeTab={tabForPathname(pathname)}
      onTabChange={(key) => {
        void navigate({ to: TAB_PATH[key as OperateTabKey] });
      }}
      onQuickAdd={() => setQuickAddOpen(true)}
      businessName={selected.name}
      onSwitchBusiness={switcher.openSwitcher}
    >
      {blockedShellPathname ? null : <Outlet />}
      <QuickAddSheet
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        today={today}
        onBookTrip={(vehicleId) => {
          setQuickAddOpen(false);
          void navigate({
            to: "/vehicles/$vehicleId/trip/new",
            params: { vehicleId },
            search: {},
          });
        }}
      />
      <BusinessSwitcherSheet
        open={switcher.open}
        onOpenChange={switcher.onOpenChange}
        businesses={selected.businesses}
        currentBusinessId={selected.businessId}
        createBusiness={{ pendingRequest: selected.pendingRequest }}
        onSelected={switcher.onSelected}
      />
    </AppShell>
  );
}

function RootLayout({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  // The root route owns `<Outlet />` but has no match of its own to read
  // params from — subscribing to the router's own location keeps
  // `FirstRunGate`'s own admin-pathname gate (and `OperateLayout`'s tab
  // bar, via its own independent subscription) derived from the URL rather
  // than tracked state that could drift from it.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <FirstRunGate
      pathname={pathname}
      onOpenAdmin={() => void navigate({ to: "/admin" })}
      renderOperate={() => <OperateLayout today={today} />}
      renderReview={() => <ReviewLayout />}
      renderMine={() => <MineLayout />}
      renderAdmin={() => <AdminLayout />}
      renderBlockedOperatePathname={() => <RedirectToOperateHome />}
    />
  );
}

function RedirectToOperateHome() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}

/**
 * Builds the whole tree given `today` (F-1.1's vehicle list needs it) — a
 * factory rather than a module-level singleton so tests can build an
 * isolated router per case (`renderWithRouter`, over `createMemoryHistory`)
 * while production builds exactly one, in `main.tsx`, over the default
 * browser history (`history` omitted). `today` is computed once via
 * `businessToday()` and threaded through; no route ever calls `new Date()`
 * itself.
 */
export function createAppRouteTree(today: BusinessDate, history?: RouterHistory) {
  const rootRoute = createRootRoute({ component: () => <RootLayout today={today} /> });

  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: HomeRoute,
  });

  const vehiclesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles",
    component: () => <VehiclesListRoute today={today} />,
  });

  const vehicleDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles/$vehicleId",
    component: VehicleDetailRoute,
  });

  const vehicleCalendarRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles/$vehicleId/calendar",
    component: () => <VehicleCalendarRoute today={today} />,
  });

  const startLeaseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles/$vehicleId/lease/new",
    validateSearch: (search: Record<string, unknown>): { startDate?: BusinessDate } => {
      const raw = search["startDate"];
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? { startDate: asBusinessDate(raw) }
        : {};
    },
    component: () => <StartLeaseRoute today={today} />,
  });

  const startDailyLeaseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles/$vehicleId/daily-lease/new",
    component: () => <StartDailyLeaseRoute today={today} />,
  });

  const bookTripRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicles/$vehicleId/trip/new",
    validateSearch: (search: Record<string, unknown>): { startDate?: BusinessDate } => {
      const raw = search["startDate"];
      return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? { startDate: asBusinessDate(raw) }
        : {};
    },
    component: () => <BookTripRoute today={today} />,
  });

  const tripDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/trips/$tripId",
    component: () => <TripDetailRoute today={today} />,
  });

  const incidentDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/incidents/$incidentId",
    component: () => <IncidentDetailRoute today={today} />,
  });

  const leaseDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/leases/$leaseId",
    component: LeaseDetailRoute,
  });

  const closeLeaseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/leases/$leaseId/close",
    component: () => <CloseLeaseRoute today={today} />,
  });

  const peopleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people",
    component: PeopleListRoute,
  });

  const driverDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people/drivers/$driverId",
    component: DriverDetailRoute,
  });

  const customerDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people/customers/$customerId",
    component: CustomerDetailRoute,
  });

  const moreRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/more",
    component: MoreScreen,
  });

  const openingBalanceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/opening-balances",
    component: () => <OpeningBalanceRoute today={today} />,
  });

  const closeMonthRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/period/close",
    component: () => <CloseMonthRoute today={today} />,
  });

  const membersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/members",
    component: MembersRoute,
  });

  const cashRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/cash",
    component: () => <CashRoute today={today} />,
  });

  const partnerDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/partners/$userId",
    component: () => <PartnerDetailRoute today={today} />,
  });

  const partnerSetupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/vehicle-sharing",
    component: () => <PartnerSetupRoute today={today} />,
  });

  const mileagePackagesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/mileage-packages",
    component: MileagePackagesRoute,
  });

  // B0b: the Review shell's four tabs and the Mine shell's one screen —
  // siblings of every Operate route above, exactly as `/more` is, since
  // `ReviewLayout`/`MineLayout` (not a nested route) supply the AppShell
  // wrapper the same way `RootLayout` already does for Operate.
  const reviewThisMonthRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review",
    component: ReviewThisMonthRoute,
  });

  const reviewVehiclesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review/vehicles",
    component: ReviewVehiclesRoute,
  });

  const reviewVehicleDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review/vehicles/$vehicleId",
    validateSearch: (search: Record<string, unknown>): { periodId: string } => {
      const raw = search["periodId"];
      if (typeof raw !== "string" || raw === "") {
        throw new Error("periodId is required to open a vehicle's Review detail");
      }
      return { periodId: raw };
    },
    component: ReviewVehicleDetailRoute,
  });

  const reviewMoneyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/review/money",
    component: ReviewMoneyRoute,
  });

  const reportsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports",
    component: ReportsRoute,
  });

  // B4/§5.2: three of the six carry search params (§4's IA); the other
  // three navigate straight through. `businessDateSchema`'s own
  // `YYYY-MM-DD` shape, validated the same loose regex way
  // `startLeaseRoute`'s `startDate` already is above.
  const isBusinessDateLike = (v: unknown): v is BusinessDate =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

  const vehicleMonthReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/vehicle-month",
    validateSearch: (search: Record<string, unknown>): { periodId?: string } => {
      const raw = search["periodId"];
      return typeof raw === "string" && raw !== "" ? { periodId: raw } : {};
    },
    component: VehicleMonthReportRoute,
  });

  const tripsReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/trips",
    component: TripsReportRoute,
  });

  const fuelEfficiencyReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/fuel-efficiency",
    validateSearch: (
      search: Record<string, unknown>,
    ): { vehicleId?: string; from?: BusinessDate; to?: BusinessDate } => {
      const rawVehicleId = search["vehicleId"];
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(typeof rawVehicleId === "string" && rawVehicleId !== ""
          ? { vehicleId: rawVehicleId }
          : {}),
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <FuelEfficiencyReportRoute today={today} />,
  });

  const receivablesReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/receivables",
    component: ReceivablesReportRoute,
  });

  const cashPositionReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/cash-position",
    component: CashPositionReportRoute,
  });

  const lostDaysReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/lost-days",
    validateSearch: (
      search: Record<string, unknown>,
    ): { from?: BusinessDate; to?: BusinessDate } => {
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <LostDaysReportRoute today={today} />,
  });

  const ageingReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/ageing",
    validateSearch: (search: Record<string, unknown>): { asOfDate?: BusinessDate } => {
      const raw = search["asOfDate"];
      return isBusinessDateLike(raw) ? { asOfDate: raw } : {};
    },
    component: () => <AgeingReportRoute today={today} />,
  });

  const goodwillReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/goodwill",
    validateSearch: (
      search: Record<string, unknown>,
    ): { from?: BusinessDate; to?: BusinessDate } => {
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <GoodwillReportRoute today={today} />,
  });

  const utilisationReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/utilisation",
    validateSearch: (
      search: Record<string, unknown>,
    ): { vehicleId?: string; from?: BusinessDate; to?: BusinessDate } => {
      const rawVehicleId = search["vehicleId"];
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(typeof rawVehicleId === "string" && rawVehicleId !== ""
          ? { vehicleId: rawVehicleId }
          : {}),
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <UtilisationReportRoute today={today} />,
  });

  const vehicleYearReportRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/vehicle-year",
    validateSearch: (
      search: Record<string, unknown>,
    ): { from?: BusinessDate; to?: BusinessDate } => {
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <VehicleYearReportRoute today={today} />,
  });

  const exportTransactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reports/export",
    validateSearch: (
      search: Record<string, unknown>,
    ): { from?: BusinessDate; to?: BusinessDate } => {
      const rawFrom = search["from"];
      const rawTo = search["to"];
      return {
        ...(isBusinessDateLike(rawFrom) ? { from: rawFrom } : {}),
        ...(isBusinessDateLike(rawTo) ? { to: rawTo } : {}),
      };
    },
    component: () => <ExportTransactionsRoute today={today} />,
  });

  const mineRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/me",
    component: () => <MineRoute today={today} />,
  });

  // UI §3.1: the platform admin surface — six routes (the hub plus five
  // screens), reached only once `FirstRunGate` gates on `isPlatformAdmin`
  // and the pathname (see `RootLayout`'s own `renderAdmin`).
  const adminHomeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin",
    component: AdminHomeScreen,
  });

  const adminRequestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/requests",
    component: AdminRequestsRoute,
  });

  const adminBusinessesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/businesses",
    component: AdminBusinessesRoute,
  });

  const adminUsersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/users",
    component: AdminUsersRoute,
  });

  const adminAdminsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/admins",
    component: AdminAdminsRoute,
  });

  const adminAuditLogRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/audit-log",
    component: AdminAuditLogRoute,
  });

  const routeTree = rootRoute.addChildren([
    homeRoute,
    vehiclesRoute,
    vehicleDetailRoute,
    vehicleCalendarRoute,
    startLeaseRoute,
    startDailyLeaseRoute,
    bookTripRoute,
    tripDetailRoute,
    incidentDetailRoute,
    leaseDetailRoute,
    closeLeaseRoute,
    peopleRoute,
    driverDetailRoute,
    customerDetailRoute,
    moreRoute,
    openingBalanceRoute,
    closeMonthRoute,
    membersRoute,
    cashRoute,
    partnerDetailRoute,
    partnerSetupRoute,
    mileagePackagesRoute,
    reviewThisMonthRoute,
    reviewVehiclesRoute,
    reviewVehicleDetailRoute,
    reviewMoneyRoute,
    reportsRoute,
    vehicleMonthReportRoute,
    tripsReportRoute,
    fuelEfficiencyReportRoute,
    receivablesReportRoute,
    cashPositionReportRoute,
    lostDaysReportRoute,
    ageingReportRoute,
    goodwillReportRoute,
    utilisationReportRoute,
    vehicleYearReportRoute,
    exportTransactionsRoute,
    mineRoute,
    adminHomeRoute,
    adminRequestsRoute,
    adminBusinessesRoute,
    adminUsersRoute,
    adminAdminsRoute,
    adminAuditLogRoute,
  ]);

  return createRouter({
    routeTree,
    ...(history !== undefined ? { history } : {}),
    defaultNotFoundComponent: () => <NotBuiltYetScreen title="Not found" />,
  });
}

// One router *type* is registered globally, even though production and each
// test build their own instance (`createAppRouteTree` is a factory, not a
// singleton) — every instance shares this exact shape, so `useNavigate`,
// `useParams({ from })` and `navigate({ to, params })` stay fully typed
// everywhere without depending on which instance is mounted.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouteTree>;
  }
}
