import { expect, test, type Page } from "@playwright/test";

/**
 * GAP-104/GAP-134 — the mobile `ActionSheet`/`Sheet` history race(s). Found
 * live (`LIVE-BROWSER-FINDINGS-2026-08-10.md` F-1/F-2, `QA-FINDINGS-
 * 2026-08-16.md`): under real touch input, `ActionSheet` closing itself and
 * either opening a target sheet (GAP-104) or calling a route `navigate()`
 * (GAP-134) in the same handler raced independent, uncoordinated writes to
 * `window.history` — Quick Add's Fuel and Expense sheets closed themselves
 * moments after opening (GAP-104), and New trip's vehicle selection reached
 * `navigate()` but the router's own `pushState` lost the race to the
 * pending history unwind and silently reverted (GAP-134). Both classes are
 * now structurally impossible: `useCloseWatcherDismiss` answers a close
 * request via the platform's `CloseWatcher` and never touches
 * `window.history` at all, so there is nothing left for a navigation — or
 * another sheet's own dismiss — to race.
 *
 * This only reproduces under `pointer: coarse`, which `playwright.config.ts`
 * gates behind the `mobile-360x640-touch` project (`hasTouch`/`isMobile`) —
 * this file is restricted to that project via `testMatch`. Every other e2e
 * spec runs at the same 360×640 viewport without touch and never exercises
 * this path at all.
 */
const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" };
const SESSION_OPERATE = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" as const }],
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

test("Quick Add → Fuel opens the fuel-fill sheet and it stays open on a touch device", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, []);

  await page.goto("/vehicles");
  await expect(page.getByText("No vehicles yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Fuel" }).click();

  await expect(page.getByText("Log a fuel fill")).toBeVisible();
  // The regression: give the race a moment to fire before asserting the
  // sheet is still there, not gone.
  // history.back()'s popstate is genuinely asynchronous and its delay is
  // not fixed — under the pre-fix code this measured anywhere from ~150ms
  // to ~300ms before the target sheet closed itself, so this waits well
  // past that observed range rather than racing it.
  await page.waitForTimeout(1000);
  await expect(page.getByText("Log a fuel fill")).toBeVisible();
});

test("Quick Add → Expense opens the record-expense sheet and it stays open on a touch device", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, []);

  await page.goto("/vehicles");
  await expect(page.getByText("No vehicles yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Expense" }).click();

  await expect(page.getByRole("heading", { name: "Record expense" })).toBeVisible();
  // history.back()'s popstate is genuinely asynchronous and its delay is
  // not fixed — under the pre-fix code this measured anywhere from ~150ms
  // to ~300ms before the target sheet closed itself, so this waits well
  // past that observed range rather than racing it.
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: "Record expense" })).toBeVisible();
});

/**
 * GAP-134's own live reproduction, verbatim (`QA-FINDINGS-2026-08-16.md`):
 * Add → New trip → pick a vehicle landed back on Home instead of the trip
 * form, silently, three times running under CDP touch emulation. Unlike
 * GAP-104 above — where the closing sheet only ever raced another `Sheet`'s
 * own history bookkeeping — this closes `QuickAddSheet`'s vehicle-picker
 * `ReasonPicker` (`onOpenChange(false); onSelect(reason);`, `ReasonPicker.
 * tsx`) and calls `onBookTrip`, which is a real TanStack Router
 * `navigate()` (`router.tsx`'s `RootLayout`) — the shape neither of the two
 * tests above exercises, and the exact one GAP-134's own tracker row names
 * as the coverage gap that let it ship unnoticed.
 */
test("Quick Add → New trip → pick a vehicle reaches the trip form and stays there on a touch device", async ({
  page,
}) => {
  const vehicle = {
    id: "v1",
    registration: "NC-1234",
    vehicleType: "bus",
    lifecycle: "active",
    serviceIntervalKm: null,
    arrangement: "B",
  };
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, [vehicle]);
  await mockJson(page, "**/api/vehicle/v1", 200, vehicle);
  await mockJson(page, "**/api/customer", 200, []);
  await mockJson(page, "**/api/driver", 200, []);
  await mockJson(page, "**/api/home/paperwork-warnings", 200, []);

  await page.goto("/vehicles");
  await expect(page.getByText("NC-1234")).toBeVisible();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "New trip" }).click();
  // `exact: true`: the vehicle-list row underneath (still mounted, just
  // covered by the sheet) has the same registration in its own accessible
  // name ("NC-1234 bus"), which a substring match would also catch.
  await page.getByRole("button", { name: "NC-1234", exact: true }).click();

  await expect(page).toHaveURL(/\/vehicles\/v1\/trip\/new/);
  await expect(page.getByRole("heading", { name: "NC-1234" })).toBeVisible();
  // The regression: the router's own `pushState` for this route used to
  // lose a race to `SheetHistoryStack`'s deferred `history.back()`, which
  // silently reverted the navigation ~15-20ms after it landed (`TRACKER.md`
  // GAP-134). Give that window well more than enough room, then confirm
  // we're still here and not bounced back to Home.
  await page.waitForTimeout(1000);
  await expect(page).toHaveURL(/\/vehicles\/v1\/trip\/new/);
  await expect(page.getByRole("heading", { name: "NC-1234" })).toBeVisible();
});
