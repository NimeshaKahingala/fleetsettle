import type {
  BusinessResponse,
  SessionResponse,
  VehicleResponse,
} from "@fleetsettle/shared/schemas";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../lib/api.js";
import { renderWithRouter } from "../test/renderWithRouter.js";

const EMPTY_DRIVER_VIEW = {
  owedToUsMinor: "0",
  owedByUsMinor: "0",
  days: [],
  trips: [],
  advances: [],
  offsets: [],
  deposit: null,
  owedToUsObligations: [],
};

/**
 * Phase 2 (18 Aug 2026): `FirstRunGate` reads `/api/session`, not `/api/me`
 * — see `FirstRunGate.tsx`'s own doc comment. `sessionFor` builds the
 * `SessionResponse` shape these tests need from the same
 * `{ userId, businessId, role, driverId? }` quad the old `/api/me` mocks
 * used, so each test below reads the same way it always did.
 */
function sessionFor(
  userId: string,
  businessId: string,
  role: "owner" | "owner_manager" | "manager" | "driver",
  extra: { driverId?: string; isPlatformAdmin?: boolean } = {},
): SessionResponse {
  return {
    userId,
    isPlatformAdmin: extra.isPlatformAdmin ?? false,
    businesses: [
      {
        businessId,
        name: "Test Fleet",
        role,
        ...(extra.driverId !== undefined ? { driverId: extra.driverId } : {}),
      },
    ],
    pendingRequest: null,
    hadMembership: true,
  };
}

const SESSION_OPERATE = sessionFor("u1", "b1", "owner_manager");

const NO_BUSINESS: SessionResponse = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [],
  pendingRequest: null,
  hadMembership: false,
};

function mockOperateHomeGet(session: SessionResponse = SESSION_OPERATE) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(session);
    if (
      path === "/api/home/paperwork-warnings" ||
      path === "/api/daily-lease" ||
      path === "/api/day-record" ||
      path === "/api/reports/receivables" ||
      path === "/api/home/deposit-releases" ||
      path === "/api/trip"
    ) {
      return Promise.resolve([]);
    }
    throw new Error(`unexpected path ${path}`);
  });
}

test("no business yet shows the create-business form, not the shell", async () => {
  const get = vi.fn();
  get.mockResolvedValue(NO_BUSINESS);

  renderWithRouter("/vehicles", { get });

  expect(await screen.findByRole("button", { name: "Create business" })).toBeInTheDocument();
});

test("owner_manager renders the operate shell at the deep-linked path, with no list visit first", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
        serviceIntervalKm: null,
        arrangement: "B",
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  renderWithRouter("/vehicles/v1", { get });

  // "CAB-1234" appears twice once loaded (the Screen header and the body
  // card, same ambiguity VehicleOverviewScreen.test.tsx already sidesteps
  // by asserting on the vehicle type instead) — the heading role picks out
  // the routed screen's own title unambiguously.
  expect(await screen.findByRole("heading", { name: "CAB-1234" })).toBeInTheDocument();
  expect(screen.getByText("Bus")).toBeInTheDocument();
  expect(screen.queryByText("No vehicles yet.")).not.toBeInTheDocument();
});

test("tapping a vehicle row navigates to its detail route", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") {
      return Promise.resolve([
        {
          id: "v1",
          registration: "CAB-1234",
          vehicleType: "Bus",
          lifecycle: "active",
          serviceIntervalKm: null,
        },
      ] satisfies VehicleResponse[]);
    }
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
        serviceIntervalKm: null,
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });

  await user.click(await screen.findByText("CAB-1234"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/vehicles/v1"));
});

test("Screen's back button from a vehicle detail returns to the list", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/vehicle/v1") {
      return Promise.resolve({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle: "active",
        serviceIntervalKm: null,
      } satisfies VehicleResponse);
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles/v1", { get });
  await screen.findByRole("heading", { name: "CAB-1234" });

  await user.click(screen.getByRole("button", { name: "Back" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/vehicles"));
  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

test("tapping a tab navigates and the tab bar's active state follows the URL", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/driver") return Promise.resolve([]);
    if (path === "/api/customer") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByRole("navigation", { name: "Operate" });

  await user.click(screen.getByRole("button", { name: "People" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/people"));
  expect(screen.getByRole("button", { name: "People" })).toHaveAttribute("aria-current", "page");
});

test("the More tab reaches the /more hub (GAP-37), no longer NotBuiltYetScreen", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByText("No vehicles yet.");

  await user.click(screen.getByRole("button", { name: "More" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/more"));
  expect(screen.getByText("Sign out")).toBeInTheDocument();
  expect(screen.queryByText("Not built yet.")).not.toBeInTheDocument();
});

test("B12/GAP-61 — More → Opening balances reaches the real screen, not a placeholder", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/opening-balance") {
      return Promise.reject(new ApiError(404, "NOT_FOUND", "no batch yet", "req-ob"));
    }
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/more", { get });
  await user.click(await screen.findByText("Opening balances"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/opening-balances"));
  expect(await screen.findByRole("heading", { name: "Opening balances" })).toBeInTheDocument();
});

test("B3/F-9.1 — More → Close the month reaches the real screen, not a placeholder", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    if (path === "/api/accounting-period/checklist") {
      return Promise.resolve({
        period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
        checklist: {
          unconfirmedDays: 0,
          openTrips: 0,
          unreconciledAdvances: 0,
          pendingObligations: 0,
          openIncidents: 0,
        },
      });
    }
    if (path === "/api/payment") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/more", { get });
  await user.click(await screen.findByText("Close the month"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/period/close"));
  expect(await screen.findByRole("heading", { name: "Close the month" })).toBeInTheDocument();
});

test('the quick-add ("+") tab never changes the route (§3.1: "no route change" — the sheet itself is a later phase\'s gap, tracked separately)', async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(SESSION_OPERATE);
    if (path === "/api/vehicle") return Promise.resolve([] satisfies VehicleResponse[]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await screen.findByText("No vehicles yet.");

  await user.click(screen.getByRole("button", { name: "Add" }));

  expect(router.state.location.pathname).toBe("/vehicles");
});

test("an unknown path renders the not-found placeholder, not a blank screen", async () => {
  const get = vi.fn();
  get.mockResolvedValue(SESSION_OPERATE);
  renderWithRouter("/this-route-does-not-exist", { get });

  expect(await screen.findByRole("heading", { name: "Not found" })).toBeInTheDocument();
});

test("GAP-154/F-6: an Operate user deep-linking to admin is returned to Operate home", async () => {
  const get = mockOperateHomeGet();

  const { router } = renderWithRouter("/admin/users", { get });

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(await screen.findByRole("navigation", { name: "Operate" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Users" })).not.toBeInTheDocument();
});

test("GAP-154/F-6: an Operate user deep-linking to Mine is returned to Operate home", async () => {
  const get = mockOperateHomeGet();

  const { router } = renderWithRouter("/me", { get });

  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  expect(await screen.findByRole("navigation", { name: "Operate" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Mine" })).not.toBeInTheDocument();
});

/** B4: every Review-shell tab this file exercises reads through these five endpoints — one owner, no vehicles, so each resolves to its own honest-empty shape rather than crashing on a wrong one. */
function mockReviewEndpoints(get: ReturnType<typeof vi.fn>, ownerUserId: string) {
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(sessionFor(ownerUserId, "b1", "owner"));
    if (path === "/api/accounting-period") {
      return Promise.resolve([
        {
          id: "p1",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          status: "open",
          closedAt: null,
        },
      ]);
    }
    if (path.startsWith("/api/reports/vehicle-month")) {
      return Promise.resolve({
        period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
        vehicles: [],
      });
    }
    if (path.startsWith("/api/reports/overheads")) return Promise.resolve({ totalMinor: "0" });
    if (path === "/api/home/paperwork-warnings") return Promise.resolve([]);
    if (path === `/api/partner/${ownerUserId}`) {
      return Promise.resolve({
        userId: ownerUserId,
        displayName: null,
        period: { id: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31" },
        putIn: { contributionsMinor: "0", outOfPocketMinor: "0" },
        takenOut: { payoutsMinor: "0", settlementsMinor: "0" },
        earned: { profitShareMinor: "0", managementFeeMinor: "0" },
        holdingMinor: "0",
        balanceMinor: "0",
      });
    }
    throw new Error(`unexpected path ${path}`);
  });
}

test("owner lands in the Review shell (redirected from / to its default tab), driver lands in the Mine shell (B0b, UI §1.1)", async () => {
  const getOwner = vi.fn();
  mockReviewEndpoints(getOwner, "u2");
  const { router: ownerRouter, unmount } = renderWithRouter("/", { get: getOwner });
  expect(await screen.findByRole("heading", { name: "This month" })).toBeInTheDocument();
  await waitFor(() => expect(ownerRouter.state.location.pathname).toBe("/review"));
  // Review's own tab bar, not Operate's — the shell is a different
  // component tree, never Operate filtered by role (§7.9).
  expect(screen.getByRole("button", { name: "My money" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Home" })).not.toBeInTheDocument();
  unmount();

  const getDriver = vi.fn();
  getDriver.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(sessionFor("u3", "b1", "driver", { driverId: "d1" }));
    }
    if (path.startsWith("/api/driver-view?")) return Promise.resolve(EMPTY_DRIVER_VIEW);
    throw new Error(`unexpected path ${path}`);
  });
  const { router: driverRouter } = renderWithRouter("/", { get: getDriver });
  expect(await screen.findByRole("heading", { name: "Mine" })).toBeInTheDocument();
  await waitFor(() => expect(driverRouter.state.location.pathname).toBe("/me"));
  // Mine has no tab bar at all (§7.9) — the redirect proves the route
  // changed; the absence of a nav proves the shell did too.
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

test("Review's tabs navigate between its own routes, and owner_manager never reaches them (M-3)", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  mockReviewEndpoints(get, "u2");
  const { router } = renderWithRouter("/review", { get });

  await screen.findByRole("heading", { name: "This month" });
  await user.click(screen.getByRole("button", { name: "Reports" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/reports"));
  expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
});

/** B4-REPORTS-DESIGN.md §10: route-level, since `<Can>` around a card does nothing if the route itself renders for a role holding only `viewOwnData` — a `driver` reaching `/reports` must redirect to `/me`, the same way any non-`/me` path already does for that shell (B0b's `MineLayout`). */
test("a driver deep-linking to /reports lands on the Mine shell instead (W-49)", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(sessionFor("u3", "b1", "driver", { driverId: "d1" }));
    }
    if (path.startsWith("/api/driver-view?")) return Promise.resolve(EMPTY_DRIVER_VIEW);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/reports", { get });

  expect(await screen.findByRole("heading", { name: "Mine" })).toBeInTheDocument();
  await waitFor(() => expect(router.state.location.pathname).toBe("/me"));
  expect(screen.queryByText("How was this month")).not.toBeInTheDocument();
});

/** GAP-98/B4-REPORTS-DESIGN.md §5.1: the phase-1 nine, now that UC-77/78/79 moved to phase 1 (11 Aug 2026) and this catalogue caught up — a plain `manager` (`viewOwnerOnlyReports`'s `OWNERS` set is `owner`/`owner_manager` only, per UC-77/79's own "Sees: owner, owner-manager") sees the staff-visible seven but not the two owner-only ones. */
test("the catalogue renders the nine phase-1 cards, owner-only ones filtered for a plain manager", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockResolvedValue(sessionFor("u1", "b1", "manager"));

  const { router } = renderWithRouter("/reports", { get });

  expect(await screen.findByText("How was this month")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/more"));

  await user.click(screen.getByRole("button", { name: "Reports" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/reports"));
  expect(await screen.findByText("How was this month")).toBeInTheDocument();
  expect(screen.getByText("Which trips made money")).toBeInTheDocument();
  expect(screen.getByText("Is the bus drinking fuel")).toBeInTheDocument();
  expect(screen.getByText("Who owes us")).toBeInTheDocument();
  expect(screen.getByText("Where is our cash")).toBeInTheDocument();
  expect(screen.getByText("Lost days")).toBeInTheDocument();
  expect(screen.getByText("Who is overdue, and by how long")).toBeInTheDocument();
  // GAP-98: goodwill and utilisation are viewOwnerOnlyReports (UC-77/79) —
  // a plain manager is staff but not an owner, so neither card renders here.
  expect(screen.queryByText("Goodwill given")).not.toBeInTheDocument();
  expect(screen.queryByText("How hard is each vehicle working")).not.toBeInTheDocument();
});

/** GAP-98: the owner-only pair does render for owner_manager — `viewOwnerOnlyReports`'s own `OWNERS` set includes it, and the filter is role-based, not a permanent absence. "Money questions" now has 4 cards, one over `Section`'s own `maxVisible=3`, so its own "Show all" needs a tap first — unrelated to the owner-only filter this test is pinning. */
test("the catalogue also shows the owner-only pair for owner_manager", async () => {
  const get = vi.fn();
  get.mockResolvedValue(sessionFor("u1", "b1", "owner_manager"));

  renderWithRouter("/reports", { get });

  // "Trips and vehicles" has exactly 3 cards including utilisation — visible without expanding.
  expect(await screen.findByText("How hard is each vehicle working")).toBeInTheDocument();

  // "Money questions" has 4; goodwill is the 4th, behind "Show all".
  const showAllButtons = screen.getAllByRole("button", { name: /Show all/ });
  await userEvent.click(showAllButtons[showAllButtons.length - 1] as HTMLElement);
  expect(await screen.findByText("Goodwill given")).toBeInTheDocument();
});

/** GAP-98: a route that used to 404 as unshipped now resolves to the real screen — the scope moved, and this pins the new permanent shape rather than leaving the old absence assertion to rot. */
test("the ageing/goodwill/utilisation report routes all resolve now, not 'Not found'", async () => {
  const get = vi.fn();
  get.mockResolvedValue(sessionFor("u1", "b1", "owner"));

  const { router } = renderWithRouter("/reports/goodwill", { get });

  expect(await screen.findByRole("heading", { name: "Goodwill given" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/reports/goodwill");
  expect(screen.queryByRole("heading", { name: "Not found" })).not.toBeInTheDocument();
});

test("creating a business from the first-run gate replaces it with the operate shell", async () => {
  const user = userEvent.setup();
  let hasBusiness = false;
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(hasBusiness ? SESSION_OPERATE : NO_BUSINESS);
    }
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn();
  post.mockImplementation(() => {
    hasBusiness = true;
    return Promise.resolve({
      kind: "created",
      id: "b1",
      name: "Test Fleet",
      currencyCode: "LKR",
      timezone: "Asia/Colombo",
      accountingPeriodId: "p1",
    } satisfies BusinessResponse);
  });

  renderWithRouter("/vehicles", { get, post });

  // The form is behind FirstRunGate's own /api/session query — it isn't in
  // the DOM on the first, pending render, so it has to be awaited before
  // typing into it (unlike CreateBusinessForm.test.tsx, where the form is
  // the whole subject under test and needs no query to appear first).
  await user.type(await screen.findByLabelText("Business name"), "Test Fleet");
  await user.click(screen.getByRole("button", { name: "Create business" }));

  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

test("redeeming an invite code from the first-run gate replaces it with the operate shell (A11/W-57)", async () => {
  const user = userEvent.setup();
  let hasAccess = false;
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(hasAccess ? sessionFor("u2", "b1", "manager") : NO_BUSINESS);
    }
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });
  const post = vi.fn();
  post.mockImplementation(() => {
    hasAccess = true;
    return Promise.resolve({ kind: "business_member", businessId: "b1", role: "manager" });
  });

  renderWithRouter("/vehicles", { get, post });

  // Deliberately not the create-business flow — this is FirstRunGate's
  // second, equally first-class option (Plan.md A11: "one screen serving
  // both the never-had-access and the revoked cases").
  await user.type(await screen.findByLabelText("Invite code"), "ABCDE-FGHJK");
  await user.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByText("No vehicles yet.")).toBeInTheDocument();
});

/** UI §3.1 (added 18 Aug 2026): the platform admin surface — reached from `/more`'s own row, and reachable even for an admin with no business memberships at all. */
test("a platform admin with a business reaches the admin panel via More, and it lives outside the tab bar", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(sessionFor("u1", "b1", "owner_manager", { isPlatformAdmin: true }));
    }
    if (path === "/api/vehicle") return Promise.resolve([]);
    if (path === "/api/admin/requests") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/more", { get });
  await user.click(await screen.findByText("Admin panel"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  expect(await screen.findByRole("heading", { name: "Admin panel" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

  await user.click(screen.getByText("Request queue"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/requests"));
  expect(await screen.findByText("No requests yet.")).toBeInTheDocument();
});

test("an admin holding no business membership at all still has a door into the admin panel", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve({ ...NO_BUSINESS, isPlatformAdmin: true } satisfies SessionResponse);
    }
    if (path === "/api/admin/businesses") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/vehicles", { get });
  await user.click(await screen.findByText("Open the admin panel"));

  await waitFor(() => expect(router.state.location.pathname).toBe("/admin"));
  await user.click(await screen.findByText("Businesses"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/businesses"));
  expect(await screen.findByText("No businesses yet.")).toBeInTheDocument();
});

test("a platform admin can deep-link directly to the admin users screen", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") {
      return Promise.resolve(sessionFor("u1", "b1", "owner_manager", { isPlatformAdmin: true }));
    }
    if (path === "/api/admin/users") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  const { router } = renderWithRouter("/admin/users", { get });

  await waitFor(() => expect(router.state.location.pathname).toBe("/admin/users"));
  expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

test("GAP-149/M-33: a single-membership identity can open the business hub from the app bar", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  const get = mockOperateHomeGet();

  renderWithRouter("/", { get });

  await user.click(await screen.findByRole("button", { name: "BusinessTest Fleet" }));

  expect(await screen.findByRole("heading", { name: "Businesses" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create a business" })).toBeInTheDocument();
});

test("UI §3.1/M-33: a multi-membership identity can voluntarily reopen the switcher from the app bar", async () => {
  localStorage.clear();
  const user = userEvent.setup();
  const TWO_BUSINESSES: SessionResponse = {
    userId: "u1",
    isPlatformAdmin: false,
    businesses: [
      { businessId: "b1", name: "TESTA", role: "owner_manager" },
      { businessId: "b2", name: "TestBusinesByChamath", role: "manager" },
    ],
    pendingRequest: null,
    hadMembership: true,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(TWO_BUSINESSES);
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  renderWithRouter("/vehicles", { get });

  // Two memberships with no stored selection: FirstRunGate's own mandatory
  // picker renders first (its own "Businesses" heading, held open with no
  // dismiss) — pick one to reach a shell at all, matching how a real first
  // visit behaves, before this test's own concern (the voluntary reopen).
  const firstRow = (await screen.findByText("TESTA")).closest("button");
  if (firstRow === null) throw new Error("business row button not found");
  await user.click(firstRow);

  const trigger = await screen.findByRole("button", { name: "BusinessTESTA" });
  await user.click(trigger);

  expect(await screen.findByText("TestBusinesByChamath")).toBeInTheDocument();
  expect(screen.getByText("Manager")).toBeInTheDocument();
});

/**
 * Gitar review on PR #78, 19 Aug 2026: `BusinessSwitcherSheet.selectBusiness`
 * calls `queryClient.clear()` then (previously) `onOpenChange(false)` before
 * `onSelected` — a real `onOpenChange` (unlike `FirstRunGate`'s inert one)
 * re-renders the shell, which called `useSelectedBusiness()` again against
 * the now-empty `["session"]` cache and threw, surfacing the error
 * boundary's "Something went wrong!" fallback for a moment before
 * `window.location.reload()` actually navigated away. Reproduces the full
 * click-through this file's other switcher test stops short of (it only
 * opens the sheet, never selects), with `reload` itself stubbed so the
 * assertion is "no error boundary fired", not "jsdom navigated".
 */
test("UI §3.1/M-33: actually selecting a business from the voluntary switcher never trips the error boundary", async () => {
  localStorage.clear();
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    writable: true,
  });
  const user = userEvent.setup();
  const TWO_BUSINESSES: SessionResponse = {
    userId: "u1",
    isPlatformAdmin: false,
    businesses: [
      { businessId: "b1", name: "TESTA", role: "owner_manager" },
      { businessId: "b2", name: "TestBusinesByChamath", role: "manager" },
    ],
    pendingRequest: null,
    hadMembership: true,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === "/api/session") return Promise.resolve(TWO_BUSINESSES);
    if (path === "/api/vehicle") return Promise.resolve([]);
    throw new Error(`unexpected path ${path}`);
  });

  renderWithRouter("/vehicles", { get });

  const firstRow = (await screen.findByText("TESTA")).closest("button");
  if (firstRow === null) throw new Error("business row button not found");
  await user.click(firstRow);

  await user.click(await screen.findByRole("button", { name: "BusinessTESTA" }));
  const secondRow = (await screen.findByText("TestBusinesByChamath")).closest("button");
  if (secondRow === null) throw new Error("business row button not found");
  await user.click(secondRow);

  expect(reload).toHaveBeenCalledOnce();
  expect(screen.queryByText("Something went wrong!")).not.toBeInTheDocument();
});
