import { asBusinessDate, type BusinessDate } from "@fleetsettle/shared";
import type {
  CustomerResponse,
  DriverResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
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
import { useState } from "react";
import { AppShell, type OperateTabKey } from "../design/primitives/AppShell.js";
import { FirstRunGate } from "../features/setup/FirstRunGate.js";
import { HomeScreen } from "../features/home/HomeScreen.js";
import { IncidentScreen } from "../features/incidents/IncidentScreen.js";
import { CloseLeaseScreen } from "../features/leases/CloseLeaseScreen.js";
import { LeaseHubScreen } from "../features/leases/LeaseHubScreen.js";
import { DriverDetailScreen } from "../features/people/DriverDetailScreen.js";
import { PeopleListScreen } from "../features/people/PeopleListScreen.js";
import { QuickAddSheet } from "../features/quick-add/QuickAddSheet.js";
import { BookTripScreen } from "../features/trips/BookTripScreen.js";
import { TripDetailScreen } from "../features/trips/TripDetailScreen.js";
import { StartLeaseScreen } from "../features/vehicles/StartLeaseScreen.js";
import { VehicleCalendarScreen } from "../features/vehicles/VehicleCalendarScreen.js";
import { VehicleListScreen } from "../features/vehicles/VehicleListScreen.js";
import { VehicleOverviewScreen } from "../features/vehicles/VehicleOverviewScreen.js";
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

/** Web-P6 builds the real customer screen; a placeholder still needs its own way back to the list (§7.5's back-button convention) — unlike the tab-root placeholders (Home/More), which have nothing to return to. */
function PlaceholderDetailRoute({ title }: { title: string }) {
  const navigate = useNavigate();
  return <NotBuiltYetScreen title={title} onBack={() => void navigate({ to: "/people" })} />;
}

/** Maps a pathname onto the operate shell's tab bar (§3.1's five fixed tabs). `＋` (quick-add) is deliberately absent from this map — it is a sheet trigger, never a route (§3.1: "no route change"). */
function tabForPathname(pathname: string): OperateTabKey {
  if (pathname.startsWith("/vehicles")) return "vehicles";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/more")) return "more";
  return "home";
}

const TAB_PATH: Record<OperateTabKey, string> = {
  home: "/",
  vehicles: "/vehicles",
  people: "/people",
  more: "/more",
};

function RootLayout({ today }: { today: BusinessDate }) {
  const navigate = useNavigate();
  // The root route owns `<Outlet />` but has no match of its own to read
  // params from — subscribing to the router's own location keeps the tab
  // bar's `activeTab` derived from the URL rather than tracked state that
  // could drift from it.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <FirstRunGate
      renderOperate={() => (
        <AppShell
          shell="operate"
          activeTab={tabForPathname(pathname)}
          onTabChange={(key) => {
            void navigate({ to: TAB_PATH[key as OperateTabKey] });
          }}
          onQuickAdd={() => setQuickAddOpen(true)}
        >
          <Outlet />
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
        </AppShell>
      )}
    />
  );
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
    component: () => <PlaceholderDetailRoute title="Customer" />,
  });

  const moreRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/more",
    component: () => <NotBuiltYetScreen title="More" />,
  });

  const routeTree = rootRoute.addChildren([
    homeRoute,
    vehiclesRoute,
    vehicleDetailRoute,
    vehicleCalendarRoute,
    startLeaseRoute,
    bookTripRoute,
    tripDetailRoute,
    incidentDetailRoute,
    leaseDetailRoute,
    closeLeaseRoute,
    peopleRoute,
    driverDetailRoute,
    customerDetailRoute,
    moreRoute,
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
