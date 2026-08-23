import { expect, test } from "@playwright/test";
import { ME_OPERATE, SESSION_OPERATE, mockJson } from "./support/mocks.js";

/**
 * F-10.4/F-10.1/F-4.1/F-2.2/F-2.7/F-10.1 — the Home screen aggregates seven
 * flows into a stated priority order (`user-flows.md` §7): failed messages,
 * expired paperwork, today's card, earlier unconfirmed days, rent due,
 * expired deposit holds, trips in progress — things silently getting worse
 * before things merely waiting (`user-flows.md:1105`). `HomeScreen.test.tsx`
 * already covers every section in isolation; none of those tests renders
 * more than one section at once, so nothing asserts their *relative* order.
 * This is that assertion, at the golden 360×640 viewport.
 *
 * Item 1, failed messages (F-10.4), is deliberately absent below —
 * `HomeScreen.tsx`'s own comment: "P14 is blocked and has no read endpoint."
 * There is nothing to mock or assert until that flow exists.
 */
test("F-4.1/F-2.2/F-2.7/F-10.1: Home's sections render in the spec's stated priority order", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);

  await mockJson(page, "**/api/home/paperwork-warnings", 200, [
    {
      subjectType: "vehicle",
      subjectId: "v1",
      subjectLabel: "CAB-1234",
      docType: "insurance",
      expiryDate: "2026-07-20",
      isExpired: true,
    },
  ]);
  await mockJson(page, "**/api/daily-lease", 200, [
    {
      id: "dl1",
      vehicleId: "v1",
      vehicleRegistration: "CAB-1111",
      vehicleType: "Bus",
      driverId: "d1",
      driverName: "TodayDriver",
      dailyLeaseAmountMinor: "500000",
    },
  ]);
  await mockJson(page, "**/api/day-record", 200, [
    {
      id: "dr1",
      dailyLeaseId: "dl2",
      vehicleId: "v2",
      vehicleRegistration: "CAB-2222",
      driverId: "d2",
      driverName: "EarlierDriver",
      businessDate: "2026-08-15",
      expectedMinor: "500000",
    },
  ]);
  await mockJson(page, "**/api/reports/receivables", 200, [
    {
      partyType: "customer",
      partyId: "c1",
      partyName: "Perera Tours",
      outstandingMinor: "1500000",
      oldestDueOn: "2026-07-01",
    },
  ]);
  await mockJson(page, "**/api/home/deposit-releases", 200, [
    {
      depositId: "dep1",
      partyType: "customer",
      partyId: "c1",
      partyName: "Perera Tours",
      holdReleaseDate: "2026-07-01",
      heldMinor: "5000000",
    },
  ]);
  await mockJson(page, "**/api/trip", 200, [
    {
      id: "t1",
      vehicleId: "v3",
      vehicleRegistration: "CAB-9999",
      customerId: "c1",
      customerName: "Perera Tours",
      driverId: null,
      driverName: null,
      startDate: "2026-08-01",
      endDate: "2026-08-03",
      destination: "Kandy",
    },
  ]);
  // Every `ConfirmDayCard`/`ConfirmWeekGroupCard` rendered below also fires
  // its own two reads: the day itself (never confirmed yet, in this fixture)
  // and its lease's current rate.
  await mockJson(page, "**/api/day-record/**", 404, {
    code: "NOT_FOUND",
    error: "not yet confirmed",
    requestId: "req-1",
  });
  await mockJson(page, "**/api/daily-lease/**", 200, {
    id: "dl",
    vehicleId: "v1",
    driverId: "d1",
    patternType: "every_day",
    patternWeekdays: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    dailyLeaseAmountMinor: "500000",
  });

  await page.goto("/");

  const paperwork = page.getByText("Paperwork expired", { exact: true });
  const todayCard = page.getByText("Expected from TodayDriver", { exact: true });
  const earlierDays = page.getByText("Earlier days · 1", { exact: true });
  const rentDue = page.getByText("Rent due · 1", { exact: true });
  const deposits = page.getByText("Deposits to release · 1", { exact: true });
  const trips = page.getByText("Trips in progress · 1", { exact: true });

  await expect(paperwork).toBeVisible();
  await expect(todayCard).toBeVisible();
  await expect(earlierDays).toBeVisible();
  await expect(rentDue).toBeVisible();
  await expect(deposits).toBeVisible();
  await expect(trips).toBeVisible();

  // Single-column at 360×640 (the `lg:` two-column split never engages), so
  // top-to-bottom `y` is the real reading order a person scans in.
  const tops = await Promise.all(
    [paperwork, todayCard, earlierDays, rentDue, deposits, trips].map(async (locator) => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("expected section marker to have a bounding box");
      return box.y;
    }),
  );
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
});
