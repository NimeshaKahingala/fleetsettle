import { expect, test, type Page } from "@playwright/test";

/**
 * GAP-50 — found 6 August 2026 driving a real browser against QA, twice in
 * twenty minutes, and reproduced here so it stays found.
 *
 * Chrome refuses to apply `aria-hidden` to an element that contains the
 * focused one and says so in the console: *"Blocked aria-hidden on an element
 * because its descendant retained focus."* It is a real WCAG problem, not a
 * lint opinion — the fix Chrome applies on our behalf is to ignore the
 * `aria-hidden`, which leaves the whole background exposed to a screen reader
 * while a modal sheet is open.
 *
 * This has to be an e2e test rather than a unit one: the message comes from
 * the browser's own accessibility layer, and jsdom has neither. It arrives via
 * CDP's `Log` domain rather than `Runtime.consoleAPICalled`, so
 * `page.on("console")` does **not** see it — hence the explicit CDP session
 * below. That difference is the whole reason this class of bug survived every
 * previous automated pass.
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

/**
 * Collects console output **with the accessibility tree switched on**.
 *
 * `Accessibility.enable` is the load-bearing line and it is not optional:
 * headless Chromium computes the a11y tree lazily, and with no client asking
 * for it the `aria-hidden` check never runs and the warning is never emitted.
 * Verified both ways before this test was written — the same deliberate
 * violation produces nothing without it and two entries with it. A version of
 * this test that omits it passes against known-broken code, which is worse
 * than having no test at all.
 */
async function collectConsoleWithA11y(page: Page): Promise<string[]> {
  const entries: string[] = [];
  const session = await page.context().newCDPSession(page);
  await session.send("Log.enable");
  await session.send("Accessibility.enable");
  session.on("Log.entryAdded", ({ entry }) => entries.push(entry.text));
  page.on("console", (message) => entries.push(message.text()));
  return entries;
}

function ariaHiddenWarnings(entries: string[]): string[] {
  return entries.filter((text) => /aria-hidden/i.test(text));
}

test("opening and closing a sheet leaves no aria-hidden-on-focused-element warning", async ({
  page,
}) => {
  const log = await collectConsoleWithA11y(page);

  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, []);

  await page.goto("/vehicles");

  // The violation fires on **open**, not close, which is the opposite of what
  // GAP-50 was first written up as. vaul defaults `autoFocus` to `false` and
  // calls `preventDefault()` on Radix's open-auto-focus, so focus never moves
  // into the drawer — it stays on the trigger, which Radix then marks
  // `aria-hidden` along with the rest of the background.
  await page.getByRole("button", { name: "Add a vehicle" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  expect(ariaHiddenWarnings(log)).toEqual([]);
});

test("a sheet opened from inside another sheet is clean too", async ({ page }) => {
  const log = await collectConsoleWithA11y(page);

  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/driver", 200, []);
  await mockJson(page, "**/api/customer", 200, []);

  await page.goto("/people");

  // The stacked case, and the one that reproduced live with a Radix-generated
  // dialog div named as the offending ancestor rather than a plain button —
  // `ActionSheet` is built on `Sheet`, so the depth doubles the layers Radix
  // has to hide and unhide. `ActionSheet`'s row closes the chooser and opens
  // the form sheet, so both transitions are exercised in one pass.
  // Scoped to the app bar: the tab bar carries its own `＋` quick-add, also
  // named "Add", and an unscoped locator matches both.
  await page.locator("header").getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Add a driver" }).click();
  await expect(page.getByRole("heading", { name: "Add a driver" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  expect(ariaHiddenWarnings(log)).toEqual([]);
});

test("focus returns to the control that opened the sheet", async ({ page }) => {
  await mockJson(page, "**/api/me", 200, ME_OPERATE);
  await mockJson(page, "**/api/vehicle", 200, []);

  await page.goto("/vehicles");

  await page.getByRole("button", { name: "Add a vehicle" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // The half of GAP-50's fix most at risk from the fix itself: silencing the
  // warning by dropping focus to <body> trades a console message for a real
  // keyboard-navigation regression. `Sheet`'s own doc comment promises focus
  // restore (M-23), so it is asserted rather than assumed.
  await expect(page.getByRole("button", { name: "Add a vehicle" })).toBeFocused();
});
