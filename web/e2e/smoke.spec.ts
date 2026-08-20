import { expect, test, type Page } from "@playwright/test";

/**
 * These run against a real production build with `VITE_AUTH_MODE=stub`
 * (set on the *build* in playwright.config.ts). The stub token getter
 * resolves instead of throwing, so requests are actually issued — which is
 * the only reason `page.route()` below has anything to intercept. The API
 * itself is never running here; every response is fulfilled by Playwright.
 *
 * The stub is not a security hole: it produces an unsigned, obviously-fake
 * token that no Worker will ever accept (see lib/auth-stub.ts), and it is
 * opt-in via an env var a real deployment doesn't set.
 */
const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" };
/**
 * `FirstRunGate` (Phase 2, 18 Aug 2026) resolves off `/api/session`, not
 * `/api/me` — `/api/me` still exists and is mocked alongside it below for
 * anything that reads it directly, but every gating decision in this suite
 * now needs a matching `/api/session` response too, or the app hangs on an
 * unmocked `fetch` (confirmed empirically: without this, every test below
 * timed out waiting on its first assertion — `ECONNREFUSED` against
 * `/api/session`, no backend running here).
 */
const SESSION_OPERATE = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" as const }],
  pendingRequest: null,
  hadMembership: true,
};
const SESSION_NO_BUSINESS = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [] as const,
  pendingRequest: null,
  hadMembership: false,
};
const SESSION_PLATFORM_ADMIN = {
  ...SESSION_OPERATE,
  isPlatformAdmin: true,
};
const SESSION_MANAGER = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [{ businessId: "b1", name: "Test Fleet", role: "manager" as const }],
  pendingRequest: null,
  hadMembership: true,
};

async function mockJson(page: Page, urlPattern: string, status: number, body: unknown) {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function mockOperateDashboardEndpoints(page: Page) {
  await Promise.all([
    mockJson(page, "**/api/home/paperwork-warnings", 200, []),
    mockJson(page, "**/api/daily-lease", 200, []),
    mockJson(page, "**/api/day-record", 200, []),
    mockJson(page, "**/api/reports/receivables", 200, []),
    mockJson(page, "**/api/home/deposit-releases", 200, []),
    mockJson(page, "**/api/trip", 200, []),
  ]);
}

async function mockVehicleOverviewSections(page: Page, vehicleId: string) {
  await Promise.all([
    mockJson(page, `**/api/vehicle/${vehicleId}/document`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/expense`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/lease`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/daily-lease`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/incident`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/**`, 200, []),
  ]);
}

async function expectNoHorizontalScrollAt360And320(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
}

test("no business yet: the create-business form loads, fits 360×640, and still fits at 320px", async ({
  page,
}) => {
  await mockJson(page, "**/api/session", 200, SESSION_NO_BUSINESS);

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Create business" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("a deep link straight to a vehicle's detail route renders it directly, with no list visit first", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
  });
  await mockVehicleOverviewSections(page, "v1");

  await page.goto("/vehicles/v1");

  await expect(page.getByRole("heading", { name: "CAB-1234" })).toBeVisible();
  await expect(page.getByText("Bus")).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a vehicle arrangement can be changed from the vehicle's own actions", async ({
  page,
}) => {
  let arrangementRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
    serviceIntervalKm: null,
  });
  await mockVehicleOverviewSections(page, "v1");
  await page.route("**/api/vehicle/v1/arrangement", async (route) => {
    arrangementRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "11111111-1111-1111-1111-111111111111",
        vehicleId: "v1",
        arrangement: "C",
        effectiveFrom: "2026-08-21",
        effectiveTo: null,
      }),
    });
  });

  await page.goto("/vehicles/v1");
  await page.getByRole("button", { name: "Vehicle actions" }).click();
  await page.getByRole("button", { name: "Change arrangement" }).click();
  await page.getByLabel("New arrangement").selectOption("C");
  await page.getByLabel(/Effective from/).fill("2026-08-21");
  await page.getByRole("button", { name: "Change arrangement" }).click();

  await expect
    .poll(() => arrangementRequest)
    .toEqual({ arrangement: "C", effectiveFrom: "2026-08-21" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a vehicle can be archived and unarchived from its own actions", async ({ page }) => {
  let lifecycle: "active" | "archived" = "active";
  let archiveCalled = false;
  let unarchiveCalled = false;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await page.route("**/api/vehicle/v1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle,
        arrangement: "B",
        serviceIntervalKm: null,
      }),
    });
  });
  await mockVehicleOverviewSections(page, "v1");
  await page.route("**/api/vehicle/v1/archive", async (route) => {
    archiveCalled = true;
    lifecycle = "archived";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle,
        arrangement: "B",
        serviceIntervalKm: null,
      }),
    });
  });
  await page.route("**/api/vehicle/v1/unarchive", async (route) => {
    unarchiveCalled = true;
    lifecycle = "active";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "v1",
        registration: "CAB-1234",
        vehicleType: "Bus",
        lifecycle,
        arrangement: "B",
        serviceIntervalKm: null,
      }),
    });
  });

  await page.goto("/vehicles/v1");
  await expect(page.getByText("Active")).toBeVisible();
  await page.getByRole("button", { name: "Vehicle actions" }).click();
  await page.getByRole("button", { name: "Archive vehicle" }).click();
  await expect(page.getByRole("heading", { name: "Archive vehicle?" })).toBeVisible();
  await page.getByRole("button", { name: "Archive vehicle" }).click();
  await expect(page.getByText("Archived")).toBeVisible();

  await page.getByRole("button", { name: "Vehicle actions" }).click();
  await page.getByRole("button", { name: "Unarchive vehicle" }).click();
  await expect(page.getByRole("heading", { name: "Unarchive vehicle?" })).toBeVisible();
  await page.getByRole("button", { name: "Unarchive vehicle" }).click();
  await expect(page.getByText("Active")).toBeVisible();

  expect(archiveCalled).toBe(true);
  expect(unarchiveCalled).toBe(true);
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: an active daily lease's driver can be changed from the vehicle's own actions", async ({
  page,
}) => {
  let driverChangeRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
    serviceIntervalKm: null,
  });
  await mockVehicleOverviewSections(page, "v1");
  await mockJson(page, "**/api/vehicle/v1/daily-lease", 200, [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ]);
  await mockJson(page, "**/api/daily-lease/dl1/exception", 200, []);
  await mockJson(page, "**/api/driver", 200, [
    {
      id: "d1",
      name: "Sunil Perera",
      mobile: null,
      driverDayFeeMinor: null,
      driverTripFeeMinor: null,
      licenceExpiry: null,
    },
    {
      id: "d2",
      name: "Nimal Fernando",
      mobile: null,
      driverDayFeeMinor: null,
      driverTripFeeMinor: null,
      licenceExpiry: null,
    },
  ]);
  await page.route("**/api/daily-lease/dl1/change-driver", async (route) => {
    driverChangeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "dl2",
        vehicleId: "v1",
        driverId: "d2",
        patternType: "every_day",
        patternWeekdays: null,
        effectiveFrom: "2026-08-21",
        effectiveTo: null,
        dailyLeaseAmountMinor: "450000",
      }),
    });
  });

  await page.goto("/vehicles/v1");
  await page.getByRole("button", { name: "Vehicle actions" }).click();
  await page.getByRole("button", { name: "Change daily lease driver" }).click();
  await page.getByRole("button", { name: "Choose driver" }).click();
  await page.getByRole("button", { name: "Nimal Fernando" }).click();
  await page.getByLabel(/Effective from/).fill("2026-08-21");
  await page.getByRole("button", { name: "Change driver" }).click();

  await expect
    .poll(() => driverChangeRequest)
    .toEqual({ driverId: "d2", effectiveFrom: "2026-08-21" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: an active daily lease day can be skipped from the vehicle's own actions", async ({
  page,
}) => {
  let skipRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
    serviceIntervalKm: null,
  });
  await mockVehicleOverviewSections(page, "v1");
  await mockJson(page, "**/api/vehicle/v1/daily-lease", 200, [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ]);
  await page.route("**/api/daily-lease/dl1/exception", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }
    skipRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "11111111-1111-1111-1111-111111111111",
        dailyLeaseId: "dl1",
        exceptionDate: "2026-08-21",
        reason: "Driver wedding",
      }),
    });
  });

  await page.goto("/vehicles/v1");
  await page.getByRole("button", { name: "Vehicle actions" }).click();
  await page.getByRole("button", { name: "Skip daily lease day" }).click();
  await page.getByLabel(/Skipped date/).fill("2026-08-21");
  await page.getByLabel("Reason (optional)").fill("Driver wedding");
  await page.getByRole("button", { name: "Skip daily lease day" }).click();

  await expect
    .poll(() => skipRequest)
    .toEqual({ exceptionDate: "2026-08-21", reason: "Driver wedding" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147: a skipped daily lease day can be undone from the vehicle overview", async ({
  page,
}) => {
  let undoRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
    serviceIntervalKm: null,
  });
  await mockVehicleOverviewSections(page, "v1");
  await mockJson(page, "**/api/vehicle/v1/daily-lease", 200, [
    {
      id: "dl1",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
      dailyLeaseAmountMinor: "450000",
      driverId: "d1",
      driverName: "Sunil Perera",
    },
  ]);
  await mockJson(page, "**/api/daily-lease/dl1/exception", 200, [
    {
      id: "11111111-1111-4111-8111-111111111111",
      dailyLeaseId: "dl1",
      exceptionDate: "2026-08-21",
      reason: "Driver wedding",
    },
  ]);
  await page.route(
    "**/api/daily-lease/dl1/exception/11111111-1111-4111-8111-111111111111/void",
    async (route) => {
      undoRequest = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          voidedAt: "2026-08-20T00:00:00.000Z",
        }),
      });
    },
  );

  await page.goto("/vehicles/v1");
  await expect(page.getByText("Skipped daily-lease days · 1")).toBeVisible();
  await expect(page.getByText("Driver wedding")).toBeVisible();
  await page.getByRole("button", { name: "Undo skip" }).click();
  await page.getByLabel("Reason").fill("Driver came back");
  await page.getByRole("button", { name: "Undo skip" }).last().click();

  await expect.poll(() => undoRequest).toEqual({ reason: "Driver came back" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147: an unreceived incident contribution can be voided from incident detail", async ({
  page,
}) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/incident/inc1", 200, {
    id: "inc1",
    vehicleId: "v1",
    leaseId: "l1",
    status: "open",
    occurredOn: "2026-08-18",
    description: "Bumper repair",
    offRoadFrom: null,
    offRoadTo: null,
    rentTreatment: null,
    closedAt: null,
    bottomLine: {
      totalRepairCostMinor: "0",
      totalRecoveredMinor: "0",
      pendingRecoveryMinor: "2000000",
      netCostMinor: "0",
    },
    recoveries: [
      {
        id: "rec1",
        incidentId: "inc1",
        source: "customer",
        agreedAmountMinor: "2000000",
        receivedAmountMinor: "0",
        replacesId: null,
        voidedAt: null,
        voidedReason: null,
      },
    ],
    insuranceClaim: null,
  });
  await mockJson(page, "**/api/incident/inc1/expense", 200, []);
  await page.route("**/api/incident/inc1/recovery/rec1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "rec1", voidedAt: "2026-08-20T00:00:00.000Z" }),
    });
  });

  await page.goto("/incidents/inc1");
  await expect(page.getByText("Customer contributions · 1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark received" })).toBeVisible();
  await page.getByRole("button", { name: "Void" }).click();
  await page.getByLabel("Reason").fill("Entered against the wrong customer");
  await page.getByRole("button", { name: "Void contribution" }).click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Entered against the wrong customer" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("the browser back button returns from a vehicle detail to the list — the Android case §3.3 calls the most-missed behaviour", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, [
    { id: "v1", registration: "CAB-1234", vehicleType: "Bus", lifecycle: "active" },
  ]);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
  });
  await mockVehicleOverviewSections(page, "v1");

  await page.goto("/vehicles");
  await page.getByText("CAB-1234").click();
  await expect(page).toHaveURL(/\/vehicles\/v1$/);

  await page.goBack();

  await expect(page).toHaveURL(/\/vehicles$/);
  await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
});

test("tapping a tab changes the URL, so a reload keeps the manager where they were", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, []);
  await mockJson(page, "**/api/driver", 200, []);
  await mockJson(page, "**/api/customer", 200, []);

  await page.goto("/vehicles");
  await page.getByRole("button", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);

  await page.reload();

  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
});

test("GAP-149: a single-membership user can open the business hub and request another business", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockOperateDashboardEndpoints(page);

  let posted: unknown = null;
  await page.route("**/api/business", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "pending",
        id: "req-1",
        status: "pending",
        businessName: "Second Fleet",
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Test Fleet" }).click();
  await expect(page.getByRole("heading", { name: "Businesses" })).toBeVisible();
  await page.getByRole("button", { name: "Create a business" }).click();
  await page.getByLabel("Business name").fill("Second Fleet");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page.getByText("Your request is being reviewed.")).toBeVisible();
  expect(posted).toMatchObject({
    name: "Second Fleet",
    currencyCode: "LKR",
    timezone: "Asia/Colombo",
  });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-150: adding a vehicle uses a closed native vehicle-type picker", async ({ page }) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);

  let posted: unknown = null;
  await page.route("**/api/vehicle", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "v2",
        registration: "CAR-1200",
        vehicleType: "Car",
        lifecycle: "active",
        arrangement: "B",
      }),
    });
  });

  await page.goto("/vehicles");
  await page.getByRole("button", { name: "Add a vehicle" }).click();
  await expect(page.getByRole("heading", { name: "Add a vehicle" })).toBeVisible();
  await page.getByLabel("Registration").fill("CAR-1200");
  await page.getByLabel("Vehicle type").selectOption("Car");
  await page.getByRole("button", { name: "Add vehicle" }).click();

  expect(posted).toMatchObject({
    registration: "CAR-1200",
    vehicleType: "Car",
    defaultArrangement: "B",
  });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-151: a platform admin can leave the admin panel for the normal shell", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_PLATFORM_ADMIN);
  await mockOperateDashboardEndpoints(page);

  await page.goto("/more");
  await page.getByText("Admin panel").click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin panel" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave admin panel" })).toBeVisible();

  await page.getByRole("button", { name: "Leave admin panel" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: "Operate" })).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-154: a non-admin admin deep link returns to Operate home", async ({ page }) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_MANAGER);
  await mockOperateDashboardEndpoints(page);
  let adminUsersRequested = false;
  await page.route("**/api/admin/users", async (route) => {
    adminUsersRequested = true;
    await route.fulfill({ status: 403, contentType: "application/json", body: "[]" });
  });

  await page.goto("/admin/users");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: "Operate" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Users" })).not.toBeVisible();
  expect(adminUsersRequested).toBe(false);
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-153: Reports opened from More has a visible Back path to More", async ({ page }) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_MANAGER);

  await page.goto("/more");
  await page.getByText("Reports").click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

  await page.getByRole("button", { name: "Back" }).click();

  await expect(page).toHaveURL(/\/more$/);
  await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("F-1.7: a manager can start a daily lease from a vehicle, the flow GAP-51 found missing entirely", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
  });
  await mockVehicleOverviewSections(page, "v1");
  await mockJson(page, "**/api/driver", 200, [
    {
      id: "d1",
      name: "Sunil Perera",
      mobile: "0771234567",
      driverDayFeeMinor: "300000",
      driverTripFeeMinor: "500000",
      licenceExpiry: null,
    },
  ]);

  let posted: unknown = null;
  await page.route("**/api/daily-lease", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "dl1" }),
    });
  });

  await page.goto("/vehicles/v1/daily-lease/new");

  await page.getByRole("button", { name: "Choose driver" }).click();
  await page.getByText("Sunil Perera").click();
  await page.getByRole("button", { name: "Enter daily lease amount" }).click();
  for (const digit of "500000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expectNoHorizontalScrollAt360And320(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.getByRole("button", { name: "Start daily lease" }).click();

  await expect(page).toHaveURL(/\/vehicles\/v1$/);
  expect(posted).toEqual({
    vehicleId: "v1",
    driverId: "d1",
    patternType: "every_day",
    effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    dailyLeaseAmountMinor: "500000",
  });
});

test("GAP-148: an owner-manager can write off a lease due from the lease hub", async ({ page }) => {
  let writeOffRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/lease/l1", 200, {
    id: "l1",
    vehicleId: "v1",
    customerId: "c1",
    status: "active",
    startDate: "2026-01-12",
    endDate: null,
    billingDay: 12,
    rentAmountMinor: "7000000",
    mileageDailyLimitKm: null,
    mileageExcessRateMinor: null,
    reminderDaysBefore: 3,
  });
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/lease/l1/billing-period", 200, []);
  await mockJson(page, "**/api/lease/l1/obligation", 200, [
    {
      id: "o1",
      kind: "rent",
      dueOn: "2026-01-12",
      effectiveDueOn: "2026-01-12",
      amountMinor: "7000000",
      settledMinor: "0",
      waivedMinor: "0",
      status: "pending",
    },
  ]);
  await page.route("**/api/write-off", async (route) => {
    writeOffRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "11111111-1111-1111-1111-111111111111",
        obligationId: "o1",
        partyType: "customer",
        partyCustomerId: "c1",
        partyDriverId: null,
        vehicleId: "v1",
        amountMinor: "7000000",
        reason: "Customer disappeared",
        writtenOffOn: "2026-08-20",
        replacesId: null,
      }),
    });
  });

  await page.goto("/leases/l1");
  await page.getByText("Rent").click();
  await page.getByRole("button", { name: "Write off" }).click();
  await page.getByLabel("Reason").fill("Customer disappeared");
  await page.getByRole("button", { name: "Write off" }).click();

  await expect
    .poll(() => writeOffRequest)
    .toMatchObject({
      obligationId: "o1",
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      amountMinor: "7000000",
      reason: "Customer disappeared",
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a closed lease can record a post-closure charge from the lease hub", async ({
  page,
}) => {
  let lateChargeRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/lease/l1", 200, {
    id: "l1",
    vehicleId: "v1",
    customerId: "c1",
    status: "closed",
    startDate: "2026-01-12",
    endDate: "2026-07-31",
    billingDay: 12,
    rentAmountMinor: "7000000",
    mileageDailyLimitKm: null,
    mileageExcessRateMinor: null,
    reminderDaysBefore: 3,
  });
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/lease/l1/billing-period", 200, []);
  await mockJson(page, "**/api/lease/l1/obligation", 200, []);
  await page.route("**/api/post-closure-charge", async (route) => {
    lateChargeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        obligationId: "22222222-2222-2222-2222-222222222222",
        partyType: "customer",
        amountMinor: "125000",
        dueOn: "2026-08-20",
        status: "pending",
        replacesId: null,
        deductedFromFeeOffsetId: null,
      }),
    });
  });

  await page.goto("/leases/l1");
  await page.getByRole("button", { name: "Lease actions" }).click();
  await page.getByRole("button", { name: "Record late charge" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "125000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Note").fill("Parking ticket after return");
  await page.getByRole("button", { name: "Record charge" }).click();

  await expect
    .poll(() => lateChargeRequest)
    .toMatchObject({
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      sourceType: "lease",
      sourceId: "l1",
      amountMinor: "125000",
      note: "Parking ticket after return",
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a closed trip can record a post-closure charge from trip detail", async ({
  page,
}) => {
  let lateChargeRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/trip/t1", 200, {
    id: "t1",
    vehicleId: "v1",
    customerId: "c1",
    driverId: null,
    status: "closed",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    destination: "Matara",
    agreedAmountMinor: "4500000",
    driverFeeMinor: "0",
    closingDate: "2026-08-02",
    cancelReason: null,
    advanceDisposition: null,
    holdExpiresOn: null,
    receivable: null,
  });
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/trip/t1/expense", 200, []);
  await page.route("**/api/post-closure-charge", async (route) => {
    lateChargeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        obligationId: "55555555-5555-5555-5555-555555555555",
        partyType: "customer",
        amountMinor: "50000",
        dueOn: "2026-08-20",
        status: "pending",
        replacesId: null,
        deductedFromFeeOffsetId: null,
      }),
    });
  });

  await page.goto("/trips/t1");
  await expect(page.getByText(/Closed 2 Aug 2026/)).toBeVisible();
  await page.getByRole("button", { name: "Record late charge" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "50000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Note").fill("Toll arrived after return");
  await page.getByRole("button", { name: "Record charge" }).click();

  await expect
    .poll(() => lateChargeRequest)
    .toMatchObject({
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      sourceType: "trip",
      sourceId: "t1",
      amountMinor: "50000",
      note: "Toll arrived after return",
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a vehicle-linked standalone customer write-off can be recorded from customer detail", async ({
  page,
}) => {
  let writeOffRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/customer/c1/obligation", 200, []);
  await mockJson(page, "**/api/customer/c1/payment", 200, []);
  await mockJson(page, "**/api/vehicle", 200, [
    {
      id: "v1",
      registration: "CAB-1234",
      vehicleType: "Car",
      lifecycle: "active",
      arrangement: "A",
      serviceIntervalKm: null,
    },
  ]);
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/write-off", async (route) => {
    writeOffRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "66666666-6666-6666-6666-666666666666",
        obligationId: null,
        partyType: "customer",
        partyCustomerId: "c1",
        partyDriverId: null,
        vehicleId: "v1",
        amountMinor: "400000",
        reason: "Bad debt after review",
        writtenOffOn: "2026-08-20",
        voidedAt: null,
        voidedReason: null,
        replacesId: null,
      }),
    });
  });

  await page.goto("/people/customers/c1");
  await page.getByRole("button", { name: "Customer actions" }).click();
  await page.getByRole("button", { name: "Write off balance" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "400000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Reason").fill("Bad debt after review");
  await page.getByRole("button", { name: "Choose vehicle" }).click();
  await page.getByText("CAB-1234").click();
  await page.getByRole("button", { name: "Write off" }).click();

  await expect
    .poll(() => writeOffRequest)
    .toMatchObject({
      partyType: "customer",
      partyCustomerId: "c1",
      vehicleId: "v1",
      amountMinor: "400000",
      reason: "Bad debt after review",
      writtenOffOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  expect(writeOffRequest).not.toMatchObject({ obligationId: expect.anything() });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a customer write-off recovery can be recorded from customer detail", async ({
  page,
}) => {
  let recoveryRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/customer/c1/obligation", 200, []);
  await mockJson(page, "**/api/customer/c1/payment", 200, []);
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "wo1",
          obligationId: null,
          partyType: "customer",
          partyCustomerId: "c1",
          partyDriverId: null,
          vehicleId: "v1",
          amountMinor: "400000",
          reason: "Customer disappeared",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]),
    });
  });
  await page.route("**/api/write-off/wo1/recovery", async (route) => {
    recoveryRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "33333333-3333-3333-3333-333333333333",
        writeOffId: "wo1",
        paymentId: "44444444-4444-4444-4444-444444444444",
        amountMinor: "100000",
        replacesId: null,
      }),
    });
  });

  await page.goto("/people/customers/c1");
  await expect(page.getByText("Written off losses · 1")).toBeVisible();
  await page.getByRole("button", { name: "Record recovery" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "100000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Record recovery" }).last().click();

  await expect
    .poll(() => recoveryRequest)
    .toMatchObject({
      amountMinor: "100000",
      occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147/GAP-148: a customer write-off can be voided from customer detail", async ({
  page,
}) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Nimal Perera",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/customer/c1/obligation", 200, []);
  await mockJson(page, "**/api/customer/c1/payment", 200, []);
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "wo1",
          obligationId: null,
          partyType: "customer",
          partyCustomerId: "c1",
          partyDriverId: null,
          vehicleId: "v1",
          amountMinor: "400000",
          reason: "Customer disappeared",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]),
    });
  });
  await page.route("**/api/write-off/wo1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "wo1",
        voidedAt: "2026-08-20T00:00:00.000Z",
      }),
    });
  });

  await page.goto("/people/customers/c1");
  await expect(page.getByText("Written off losses · 1")).toBeVisible();
  await page.getByRole("button", { name: "Void write-off" }).click();
  await page.getByLabel("Reason").fill("Entered against the wrong customer");
  await page.getByRole("button", { name: "Void write-off" }).last().click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Entered against the wrong customer" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a customer can be archived and unarchived from customer detail", async ({
  page,
}) => {
  let archivedAt: string | null = null;
  let archiveRequest: unknown;
  let unarchiveCalled = false;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await page.route("**/api/customer/c1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "c1",
        customerType: "person",
        name: "Nimal Perera",
        nic: null,
        registrationNo: null,
        contactPerson: null,
        mobile: null,
        address: null,
        archivedAt,
      }),
    });
  });
  await mockJson(page, "**/api/customer/c1/obligation", 200, []);
  await mockJson(page, "**/api/customer/c1/payment", 200, []);
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/customer/c1/archive", async (route) => {
    archiveRequest = route.request().postDataJSON();
    archivedAt = "2026-08-20T00:00:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "c1",
        customerType: "person",
        name: "Nimal Perera",
        nic: null,
        registrationNo: null,
        contactPerson: null,
        mobile: null,
        address: null,
        archivedAt,
      }),
    });
  });
  await page.route("**/api/customer/c1/unarchive", async (route) => {
    unarchiveCalled = true;
    archivedAt = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "c1",
        customerType: "person",
        name: "Nimal Perera",
        nic: null,
        registrationNo: null,
        contactPerson: null,
        mobile: null,
        address: null,
        archivedAt,
      }),
    });
  });

  await page.goto("/people/customers/c1");
  await expect(page.getByText("Active")).toBeVisible();
  await page.getByRole("button", { name: "Customer actions" }).click();
  await page.getByRole("button", { name: "Archive customer" }).click();
  await page.getByLabel("Reason").fill("Duplicate customer");
  await page.getByRole("button", { name: "Archive customer" }).click();
  await expect(page.getByText("Archived")).toBeVisible();

  await page.getByRole("button", { name: "Customer actions" }).click();
  await page.getByRole("button", { name: "Unarchive customer" }).click();
  await page.getByRole("button", { name: "Unarchive customer" }).click();
  await expect(page.getByText("Active")).toBeVisible();

  await expect.poll(() => archiveRequest).toEqual({ reason: "Duplicate customer" });
  expect(unarchiveCalled).toBe(true);
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a driver can be archived and unarchived from driver detail", async ({ page }) => {
  let archivedAt: string | null = null;
  let archiveRequest: unknown;
  let unarchiveCalled = false;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await page.route("**/api/driver/d1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
        archivedAt,
      }),
    });
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "0",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/driver/d1/archive", async (route) => {
    archiveRequest = route.request().postDataJSON();
    archivedAt = "2026-08-20T00:00:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
        archivedAt,
      }),
    });
  });
  await page.route("**/api/driver/d1/unarchive", async (route) => {
    unarchiveCalled = true;
    archivedAt = null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "d1",
        name: "Sunil Perera",
        mobile: null,
        driverDayFeeMinor: null,
        driverTripFeeMinor: null,
        licenceExpiry: null,
        archivedAt,
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await expect(page.getByText("Active")).toBeVisible();
  await page.getByRole("button", { name: "Driver actions" }).click();
  await page.getByRole("button", { name: "Archive driver" }).click();
  await page.getByLabel("Reason").fill("Duplicate driver");
  await page.getByRole("button", { name: "Archive driver" }).click();
  await expect(page.getByText("Archived")).toBeVisible();

  await page.getByRole("button", { name: "Driver actions" }).click();
  await page.getByRole("button", { name: "Unarchive driver" }).click();
  await page.getByRole("button", { name: "Unarchive driver" }).click();
  await expect(page.getByText("Active")).toBeVisible();

  await expect.poll(() => archiveRequest).toEqual({ reason: "Duplicate driver" });
  expect(unarchiveCalled).toBe(true);
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a held driver deposit can record a movement from driver detail", async ({
  page,
}) => {
  let movementRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "0",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: { id: "dep1", heldMinor: "250000", movements: [] },
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/deposit/dep1/movement", async (route) => {
    movementRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "dep1",
        partyDriverId: "d1",
        status: "held",
        heldMinor: "225000",
        movementId: "m1",
        movementReplacesId: null,
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await expect(page.getByText("Held deposit")).toBeVisible();
  await page.getByRole("button", { name: "Driver money" }).click();
  await page.getByRole("button", { name: "Record deposit movement" }).click();
  await page.getByLabel("Movement", { exact: true }).selectOption("reduced");
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "25000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel(/Reason/).fill("Returned early");
  await page.getByRole("button", { name: "Record movement" }).click();

  await expect
    .poll(() => movementRequest)
    .toMatchObject({
      movementType: "reduced",
      amountMinor: "25000",
      occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      reason: "Returned early",
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a held driver deposit can be applied against selected arrears", async ({ page }) => {
  let movementRequest: unknown;
  const obligationId = "11111111-1111-4111-8111-111111111111";
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "50000",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "50000",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: { id: "dep1", heldMinor: "250000", movements: [] },
        owedToUsObligations: [
          {
            id: obligationId,
            kind: "daily_amount",
            dueOn: "2026-08-01",
            effectiveDueOn: "2026-08-01",
            amountMinor: "75000",
            settledMinor: "25000",
            waivedMinor: "0",
            status: "part_paid",
          },
        ],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/deposit/dep1/movement", async (route) => {
    movementRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "dep1",
        partyDriverId: "d1",
        status: "held",
        heldMinor: "200000",
        movementId: "m1",
        movementReplacesId: null,
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await page.getByRole("button", { name: "Driver money" }).click();
  await page.getByRole("button", { name: "Record deposit movement" }).click();
  await page.getByLabel("Movement", { exact: true }).selectOption("applied");
  await page.getByLabel("Arrears").selectOption(obligationId);
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "50000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel(/Reason/).fill("Apply deposit to short days");
  await page.getByRole("button", { name: "Record movement" }).click();

  await expect
    .poll(() => movementRequest)
    .toMatchObject({
      movementType: "applied",
      amountMinor: "50000",
      obligationId,
      occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      reason: "Apply deposit to short days",
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-146: a held driver deposit movement can be voided from driver detail", async ({
  page,
}) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "0",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: {
          id: "dep1",
          heldMinor: "250000",
          movements: [
            {
              id: "dm1",
              movementType: "taken",
              amountMinor: "250000",
              occurredOn: "2026-08-01",
              reason: null,
              voidedAt: null,
              voidedReason: null,
            },
          ],
        },
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/deposit/dep1/movement/dm1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "dm1",
        voidedAt: "2026-08-20T10:00:00.000Z",
        deposit: { id: "dep1", partyDriverId: "d1", status: "held", heldMinor: "0" },
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await expect(page.getByText("Taken")).toBeVisible();
  await page.getByRole("button", { name: /Void deposit movement/ }).click();
  await page.getByLabel("Reason").fill("Duplicate deposit entry");
  await page.getByRole("button", { name: "Void movement" }).click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Duplicate deposit entry" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a vehicle-linked standalone driver write-off can be recorded from driver detail", async ({
  page,
}) => {
  let writeOffRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "50000",
    owedByUsMinor: "0",
  });
  await mockJson(page, "**/api/vehicle", 200, [
    {
      id: "v1",
      registration: "CAB-1234",
      vehicleType: "Car",
      lifecycle: "active",
      arrangement: "A",
      serviceIntervalKm: null,
    },
  ]);
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "50000",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/write-off", async (route) => {
    writeOffRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "77777777-7777-7777-7777-777777777777",
        obligationId: null,
        partyType: "driver",
        partyCustomerId: null,
        partyDriverId: "d1",
        vehicleId: "v1",
        amountMinor: "50000",
        reason: "Unrecoverable shortage",
        writtenOffOn: "2026-08-20",
        voidedAt: null,
        voidedReason: null,
        replacesId: null,
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await page.getByRole("button", { name: "Driver money" }).click();
  await page.getByRole("button", { name: "Write off balance" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "50000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByLabel("Reason").fill("Unrecoverable shortage");
  await page.getByRole("button", { name: "Choose vehicle" }).click();
  await page.getByText("CAB-1234").click();
  await page.getByRole("button", { name: "Write off" }).click();

  await expect
    .poll(() => writeOffRequest)
    .toMatchObject({
      partyType: "driver",
      partyDriverId: "d1",
      vehicleId: "v1",
      amountMinor: "50000",
      reason: "Unrecoverable shortage",
      writtenOffOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  expect(writeOffRequest).not.toMatchObject({ obligationId: expect.anything() });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-148: a driver write-off recovery can be recorded from driver detail", async ({
  page,
}) => {
  let recoveryRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "0",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "wo1",
          obligationId: null,
          partyType: "driver",
          partyCustomerId: null,
          partyDriverId: "d1",
          vehicleId: "v1",
          amountMinor: "50000",
          reason: "Unrecoverable shortage",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]),
    });
  });
  await page.route("**/api/write-off/wo1/recovery", async (route) => {
    recoveryRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "88888888-8888-8888-8888-888888888888",
        writeOffId: "wo1",
        paymentId: "99999999-9999-9999-9999-999999999999",
        amountMinor: "25000",
        replacesId: null,
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await expect(page.getByText("Written off losses · 1")).toBeVisible();
  await page.getByRole("button", { name: "Record recovery" }).click();
  await page.getByRole("button", { name: "Enter amount" }).click();
  for (const digit of "25000") {
    await page.getByRole("button", { name: digit, exact: true }).click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Record recovery" }).last().click();

  await expect
    .poll(() => recoveryRequest)
    .toMatchObject({
      amountMinor: "25000",
      occurredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147/GAP-148: a driver write-off can be voided from driver detail", async ({ page }) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "0",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [],
        offsets: [],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "wo1",
          obligationId: null,
          partyType: "driver",
          partyCustomerId: null,
          partyDriverId: "d1",
          vehicleId: "v1",
          amountMinor: "50000",
          reason: "Unrecoverable shortage",
          writtenOffOn: "2026-08-10",
          voidedAt: null,
          voidedReason: null,
          replacesId: null,
        },
      ]),
    });
  });
  await page.route("**/api/write-off/wo1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "wo1",
        voidedAt: "2026-08-20T00:00:00.000Z",
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await expect(page.getByText("Written off losses · 1")).toBeVisible();
  await page.getByRole("button", { name: "Void write-off" }).click();
  await page.getByLabel("Reason").fill("Entered against the wrong driver");
  await page.getByRole("button", { name: "Void write-off" }).last().click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Entered against the wrong driver" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147: an open driver advance can be voided from driver detail", async ({ page }) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "100000",
        owedByUsMinor: "0",
        days: [],
        trips: [],
        advances: [{ id: "a1", amountMinor: "100000", issuedOn: "2026-08-03", status: "open" }],
        offsets: [],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/advance/a1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "a1",
        voidedAt: "2026-08-20T00:00:00.000Z",
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await page.getByRole("button", { name: "Void advance from 3 Aug 2026" }).click();
  await page.getByLabel("Reason").fill("Entered against the wrong driver");
  await page.getByRole("button", { name: "Void advance" }).click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Entered against the wrong driver" });
  await expectNoHorizontalScrollAt360And320(page);
});

test("GAP-147: a driver offset can be voided from driver detail", async ({ page }) => {
  let voidRequest: unknown;
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/driver/d1", 200, {
    id: "d1",
    name: "Sunil Perera",
    mobile: null,
    driverDayFeeMinor: null,
    driverTripFeeMinor: null,
    licenceExpiry: null,
  });
  await mockJson(page, "**/api/driver/d1/balances", 200, {
    driverId: "d1",
    owedToUsMinor: "0",
    owedByUsMinor: "0",
  });
  await page.route(/\/api\/driver\/d1\/view\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        owedToUsMinor: "50000",
        owedByUsMinor: "50000",
        days: [],
        trips: [],
        advances: [],
        offsets: [
          {
            id: "o1",
            amountMinor: "50000",
            occurredOn: "2026-08-05",
            voidedAt: null,
            voidedReason: null,
          },
        ],
        deposit: null,
        owedToUsObligations: [],
      }),
    });
  });
  await page.route(/\/api\/write-off\?/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/offset/o1/void", async (route) => {
    voidRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "o1",
        voidedAt: "2026-08-20T00:00:00.000Z",
      }),
    });
  });

  await page.goto("/people/drivers/d1");
  await page.getByRole("button", { name: "Void offset from 5 Aug 2026" }).click();
  await page.getByLabel("Reason").fill("Offset entered twice");
  await page.getByRole("button", { name: "Void offset" }).click();

  await expect.poll(() => voidRequest).toEqual({ reason: "Offset entered twice" });
  await expectNoHorizontalScrollAt360And320(page);
});
