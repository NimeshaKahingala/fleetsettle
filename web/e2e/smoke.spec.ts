import { expect, test } from "@playwright/test";

test("loads at 360×640 with no horizontal scroll, and still fits at 320px", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("FleetSettle")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
