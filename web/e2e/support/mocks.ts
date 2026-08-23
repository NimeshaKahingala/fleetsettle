import { expect, type Page } from "@playwright/test";

/**
 * Shared across every e2e spec that mocks the Worker via `page.route()`
 * (see smoke.spec.ts's own header comment for why that's the only thing
 * intercepting requests here). Extracted once a third spec file needed
 * these — `smoke.spec.ts` and `mobile-sheet-history.touch.spec.ts` each
 * carried their own identical copies before this existed.
 */
export const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" };
export const SESSION_OPERATE = {
  userId: "u1",
  isPlatformAdmin: false,
  businesses: [{ businessId: "b1", name: "Test Fleet", role: "owner_manager" as const }],
  pendingRequest: null,
  hadMembership: true,
};

export async function mockJson(page: Page, urlPattern: string, status: number, body: unknown) {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/**
 * `HomeScreen`'s own six reads, exactly — see `HomeScreen.tsx`'s six
 * `useQuery` calls. Mocks every one to an empty list; a spec that cares
 * about a specific section's content overrides that endpoint's `mockJson`
 * call afterward (Playwright's last-registered route for a pattern wins).
 */
export async function mockOperateDashboardEndpoints(page: Page) {
  await Promise.all([
    mockJson(page, "**/api/home/paperwork-warnings", 200, []),
    mockJson(page, "**/api/daily-lease", 200, []),
    mockJson(page, "**/api/day-record", 200, []),
    mockJson(page, "**/api/reports/receivables", 200, []),
    mockJson(page, "**/api/home/deposit-releases", 200, []),
    mockJson(page, "**/api/trip", 200, []),
  ]);
}

export async function mockVehicleOverviewSections(page: Page, vehicleId: string) {
  await Promise.all([
    mockJson(page, `**/api/vehicle/${vehicleId}/document`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/expense`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/lease`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/daily-lease`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/incident`, 200, []),
    mockJson(page, `**/api/vehicle/${vehicleId}/**`, 200, []),
  ]);
}

export async function expectNoHorizontalScrollAt360And320(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
}
