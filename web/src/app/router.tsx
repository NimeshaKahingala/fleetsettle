import type { BusinessDate } from "@fleetsettle/shared";
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
  useRouterState,
  type RouterHistory,
} from "@tanstack/react-router";
import { AppShell, type OperateTabKey } from "../design/primitives/AppShell.js";
import { FirstRunGate } from "../features/setup/FirstRunGate.js";
import { PeopleListScreen } from "../features/people/PeopleListScreen.js";
import { VehicleListScreen } from "../features/vehicles/VehicleListScreen.js";
import { VehicleOverviewScreen } from "../features/vehicles/VehicleOverviewScreen.js";
import { NotBuiltYetScreen } from "./NotBuiltYetScreen.js";

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
    />
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

/** Web-P4/P6 build the real driver/customer screens; a placeholder still needs its own way back to the list (§7.5's back-button convention) — unlike the tab-root placeholders (Home/More), which have nothing to return to. */
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

function RootLayout() {
  const navigate = useNavigate();
  // The root route owns `<Outlet />` but has no match of its own to read
  // params from — subscribing to the router's own location keeps the tab
  // bar's `activeTab` derived from the URL rather than tracked state that
  // could drift from it.
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <FirstRunGate
      renderOperate={() => (
        <AppShell
          shell="operate"
          activeTab={tabForPathname(pathname)}
          onTabChange={(key) => {
            void navigate({ to: TAB_PATH[key as OperateTabKey] });
          }}
        >
          <Outlet />
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
  const rootRoute = createRootRoute({ component: RootLayout });

  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <NotBuiltYetScreen title="Home" />,
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

  const peopleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people",
    component: PeopleListRoute,
  });

  const driverDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/people/drivers/$driverId",
    component: () => <PlaceholderDetailRoute title="Driver" />,
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
