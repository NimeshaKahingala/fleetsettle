import { expect, test, type Page } from "@playwright/test";

/**
 * GAP-104 — the mobile `ActionSheet`/`Sheet` history race. Found live
 * (`LIVE-BROWSER-FINDINGS-2026-08-10.md` F-1/F-2): under real touch input,
 * `ActionSheet` closing itself and opening a target sheet in one handler
 * raced their independent `useMobileHistoryDismiss` push/pop, and the
 * target sheet closed itself moments after opening — Quick Add's Fuel,
 * Expense and New trip all silently did nothing on a phone.
 *
 * This only reproduces under `pointer: coarse`, which `playwright.config.ts`
 * gates behind the `mobile-360x640-touch` project (`hasTouch`/`isMobile`) —
 * this file is restricted to that project via `testMatch`. Every other e2e
 * spec runs at the same 360×640 viewport without touch and never exercises
 * this path at all.
 */
const ME_OPERATE = { userId: "u1", businessId: "b1", role: "owner_manager" };

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
