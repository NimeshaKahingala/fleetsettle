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

async function mockJson(page: Page, urlPattern: string, status: number, body: unknown) {
  await page.route(urlPattern, async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function expectNoHorizontalScrollAt360And320(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
}

test("no business yet (404 from /api/me): the create-business form loads, fits 360×640, and still fits at 320px", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 404, {
    code: "NOT_FOUND",
    error: "not found",
    requestId: "req-1",
  });

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Create business" })).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("a deep link straight to a vehicle's detail route renders it directly, with no list visit first", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
    arrangement: "B",
  });

  await page.goto("/vehicles/v1");

  await expect(page.getByRole("heading", { name: "CAB-1234" })).toBeVisible();
  await expect(page.getByText("Bus")).toBeVisible();
  await expectNoHorizontalScrollAt360And320(page);
});

test("the browser back button returns from a vehicle detail to the list — the Android case §3.3 calls the most-missed behaviour", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, [
    { id: "v1", registration: "CAB-1234", vehicleType: "Bus", lifecycle: "active" },
  ]);
  await mockJson(page, "**/api/vehicle/v1", 200, {
    id: "v1",
    registration: "CAB-1234",
    vehicleType: "Bus",
    lifecycle: "active",
  });

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
