import { expect, test } from "@playwright/test";
import { ME_OPERATE, SESSION_OPERATE, mockJson } from "./support/mocks.js";

/**
 * F-5.1–F-5.5/ST-5 — continuity across the trip state machine, not
 * first-time coverage of any one transition. Every individual step already
 * has its own test: `BookTripScreen.test.tsx`, `CloseTripSheet.test.tsx`,
 * `TripDetailScreen.test.tsx` (19 cases) each mount fresh with a fixed
 * fixture, and `smoke.spec.ts`'s own GAP-148 case deep-links straight into
 * an already-`closed` trip to test the post-closure-charge form. None of
 * them walks start → in-progress → close → post-closure-charge in one
 * continuous browser session, so none of them can catch state leaking
 * *between* transitions: a query the previous step's mutation should have
 * invalidated but didn't, or a navigation racing a sheet's own close (the
 * `GAP-134` family — first found by a live MCP pass, not a fixed-fixture
 * unit test).
 *
 * `/api/trip/t1` is intentionally a *stateful* mock below (a closure over
 * `tripStatus`, not a fixed `mockJson` body) — the whole point is to make
 * this behave like a real backend that remembers the close actually
 * happened, so the assertions after it only pass if `TripDetailScreen`
 * genuinely re-fetched rather than continuing to render what it had.
 */
test("F-5.1–F-5.4: booking, closing and recording a late charge on one trip stay consistent across the same session", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);

  const vehicle = {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "C",
  };
  await mockJson(page, "**/api/vehicle/v1", 200, vehicle);
  await mockJson(page, "**/api/customer", 200, [
    {
      id: "c1",
      customerType: "person",
      name: "Perera Tours",
      nic: null,
      registrationNo: null,
      contactPerson: null,
      mobile: null,
      address: null,
    },
  ]);
  await mockJson(page, "**/api/customer/c1", 200, {
    id: "c1",
    customerType: "person",
    name: "Perera Tours",
    nic: null,
    registrationNo: null,
    contactPerson: null,
    mobile: null,
    address: null,
  });
  await mockJson(page, "**/api/driver", 200, []);
  await mockJson(page, "**/api/home/paperwork-warnings", 200, []);
  await mockJson(page, "**/api/vehicle/v1/calendar**", 200, []);
  await mockJson(page, "**/api/vehicle/v1/daily-lease", 200, []);
  await mockJson(page, "**/api/trip/t1/expense", 200, []);

  let tripStatus: "booked" | "closed" = "booked";
  await page.route("**/api/trip/t1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "t1",
        vehicleId: "v1",
        customerId: "c1",
        driverId: null,
        status: tripStatus,
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        destination: "Kandy",
        agreedAmountMinor: "4500000",
        driverFeeMinor: "0",
        closingDate: tripStatus === "closed" ? "2026-08-12" : null,
        cancelReason: null,
        advanceDisposition: null,
        holdExpiresOn: null,
        receivable: null,
      }),
    });
  });
  await page.route("**/api/trip", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "t1", status: "booked" }),
    });
  });

  // Step 0 — trip: level-1 dates are already prefilled; pick the customer.
  await page.goto("/vehicles/v1/trip/new");
  await expect(page.getByRole("heading", { name: "CAB-1234" })).toBeVisible();
  await page.getByRole("button", { name: "Choose customer (optional)" }).click();
  await page.getByRole("button", { name: "Perera Tours" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 1 — driver: optional, skipped.
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2 — confirm and book.
  await page.getByRole("button", { name: "Book trip" }).click();

  await expect(page).toHaveURL(/\/trips\/t1$/);
  await expect(page.getByRole("button", { name: "Close trip" })).toBeVisible();
  // Not yet reachable — the trip hasn't closed, so no late-charge path exists.
  await expect(page.getByRole("button", { name: "Record late charge" })).not.toBeVisible();

  // Close the trip — a fresh sheet, level-1 only (today's date, no odometer).
  await page.route("**/api/trip/t1/close", async (route) => {
    tripStatus = "closed";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "t1", status: "closed" }),
    });
  });
  await page.getByRole("button", { name: "Close trip" }).click();
  const closeSheet = page.getByRole("dialog", { name: "Close trip" });
  await expect(closeSheet).toBeVisible();
  await closeSheet.getByRole("button", { name: "Close trip" }).click();
  await expect(closeSheet).not.toBeVisible();

  // The continuity check: TripDetailScreen must have re-fetched `/api/trip/t1`
  // off its own invalidated query, not continued to render the pre-close
  // snapshot — the exact class of bug a fixed-fixture unit test can't see.
  await expect(page.getByText(/Closed 12 Aug 2026/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Close trip" })).not.toBeVisible();
  const lateChargeButton = page.getByRole("button", { name: "Record late charge" });
  await expect(lateChargeButton).toBeVisible();

  let lateChargeRequest: unknown;
  await page.route("**/api/post-closure-charge", async (route) => {
    lateChargeRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        obligationId: "55555555-5555-5555-5555-555555555555",
        partyType: "customer",
        amountMinor: "50000",
        dueOn: "2026-08-27",
        status: "pending",
        replacesId: null,
        deductedFromFeeOffsetId: null,
      }),
    });
  });

  await lateChargeButton.click();
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
    });
});
