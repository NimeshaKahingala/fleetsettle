import { expect, test } from "@playwright/test";
import { ME_OPERATE, SESSION_OPERATE, mockJson } from "./support/mocks.js";

/**
 * F-9.2/9.3, W-56 — a money-display check, deliberately **not** a
 * golden-fixture regression test. Mocking the API to return `134000` and
 * asserting the screen renders `134,000` would be a tautology: it proves
 * the formatter works, not that the underlying calculation is right.
 * `docs/engineering/fixtures/golden.py:124` is what actually derives and
 * checks that figure against live Postgres, and stays the real regression
 * suite (FL §9.1) — nothing here replaces it.
 *
 * What this spec genuinely earns is the wire-to-render money path in a
 * real browser at the golden viewport: `string` on the wire → `bigint` in
 * the client → a thousands-separated `Rs n,nnn` render, no `Number`
 * coercion anywhere along the way — harder to fake in a real DOM than in
 * jsdom. `UtilisationReportScreen` is the representative case (one of
 * eleven report screens, all of which already have this covered at
 * component level per-screen — this doesn't repeat that eleven times, it
 * proves the same path holds at 360×640 in an actual browser once).
 *
 * The `NotAvailable` "no data" case rides along in the same file for the
 * same reason: it's already asserted in `UtilisationReportScreen.test.tsx`,
 * but never yet at the real viewport a person actually reads it at.
 */
const VEHICLE = {
  id: "v1",
  registration: "NB-1234",
  vehicleType: "Bus",
  lifecycle: "active",
  serviceIntervalKm: null,
  arrangement: "B",
};

test("W-56: a real utilisation figure renders thousands-separated, never as a bare number", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, [VEHICLE]);
  await mockJson(page, "**/api/reports/utilisation**", 200, {
    vehicleId: "v1",
    from: "2026-07-01",
    to: "2026-07-14",
    earningDays: 10,
    idleDays: 3,
    offRoadDays: 1,
    totalDays: 14,
    revenuePerAvailableDayMinor: "250000",
  });

  await page.goto("/reports/utilisation?vehicleId=v1&from=2026-07-01&to=2026-07-14");

  await expect(
    page.getByRole("heading", { name: "How hard is each vehicle working" }),
  ).toBeVisible();
  await expect(page.getByText("Rs 2,500", { exact: true })).toBeVisible();
  await expect(page.getByText("2500", { exact: true })).not.toBeVisible();
});

test("W-56: no available day in the window renders NotAvailable, never a guessed Rs 0", async ({
  page,
}) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/session", 200, SESSION_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, [VEHICLE]);
  await mockJson(page, "**/api/reports/utilisation**", 200, {
    vehicleId: "v1",
    from: "2026-07-01",
    to: "2026-07-14",
    earningDays: 0,
    idleDays: 0,
    offRoadDays: 14,
    totalDays: 14,
    revenuePerAvailableDayMinor: null,
  });

  await page.goto("/reports/utilisation?vehicleId=v1&from=2026-07-01&to=2026-07-14");

  await expect(page.getByLabel("Not available: no available day in this window")).toBeVisible();
  await expect(page.getByText("Rs 0", { exact: true })).not.toBeVisible();
});
