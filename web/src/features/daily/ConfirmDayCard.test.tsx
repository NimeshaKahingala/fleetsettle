import type { DailyLeaseResponse, DayRecordResponse } from "@fleetsettle/shared/schemas";
import { asBusinessDate } from "@fleetsettle/shared";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { ConfirmDayCard } from "./ConfirmDayCard.js";

const dailyLeaseId = "11111111-1111-4111-8111-111111111111";
const today = asBusinessDate("2026-07-15");

const lease: DailyLeaseResponse = {
  id: dailyLeaseId,
  vehicleId: "v1",
  driverId: "d1",
  patternType: "every_day",
  patternWeekdays: null,
  effectiveFrom: "2026-07-01",
  effectiveTo: null,
  dailyLeaseAmountMinor: "500000",
};

function props() {
  return {
    dailyLeaseId,
    vehicleLabel: "Bus",
    driverLabel: "Sunil",
    dateLabel: "Tue 30 Jul",
    today,
  };
}

test("not yet confirmed: shows DayCard with the rate in force as the expected amount", async () => {
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) return Promise.resolve(lease);
    throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
  });
  renderWithProviders(<ConfirmDayCard {...props()} />, { get });

  expect(await screen.findByText("Expected from Sunil")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Paid in full" })).toBeInTheDocument();
});

test("GAP-101: a failed lease read shows a failure notice, never a silent 'return null' that drops this day off Home entirely", async () => {
  const get = vi.fn().mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) {
      return Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
    }
    throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
  });
  renderWithProviders(<ConfirmDayCard {...props()} />, { get });

  expect(await screen.findByText("Something went wrong loading Bus's day.")).toBeInTheDocument();
});

test("GAP-3 — a pre-generated `open` row is not treated as confirmed: shows DayCard with its own expected amount, not the settled summary", async () => {
  const record: DayRecordResponse = {
    id: "dr1",
    dailyLeaseId,
    vehicleId: "v1",
    driverId: "d1",
    businessDate: "2026-07-15",
    state: "open",
    earnedMinor: "0",
    expectedMinor: "500000",
    receivedMinor: "0",
    lostReason: null,
    note: null,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) return Promise.resolve(lease);
    return Promise.resolve(record);
  });
  renderWithProviders(<ConfirmDayCard {...props()} />, { get });

  expect(await screen.findByText("Expected from Sunil")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Paid in full" })).toBeInTheDocument();
  expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
});

test("already confirmed on load: shows the settled summary, not the three buttons", async () => {
  const record: DayRecordResponse = {
    id: "dr1",
    dailyLeaseId,
    vehicleId: "v1",
    driverId: "d1",
    businessDate: "2026-07-15",
    state: "ran_paid_full",
    earnedMinor: "500000",
    expectedMinor: "500000",
    receivedMinor: "500000",
    lostReason: null,
    note: null,
  };
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) return Promise.resolve(lease);
    return Promise.resolve(record);
  });
  renderWithProviders(<ConfirmDayCard {...props()} />, { get });

  expect(await screen.findByText("Confirmed")).toBeInTheDocument();
  expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Paid in full" })).not.toBeInTheDocument();
});

test("one tap: paid in full posts the confirm request and renders the settled summary immediately, with SyncChip until it resolves", async () => {
  const user = userEvent.setup();
  let resolvePost: ((value: DayRecordResponse) => void) | undefined;
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) return Promise.resolve(lease);
    throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
  });
  const post = vi.fn();
  post.mockImplementation(
    () =>
      new Promise<DayRecordResponse>((resolve) => {
        resolvePost = resolve;
      }),
  );
  renderWithProviders(<ConfirmDayCard {...props()} />, { get, post });

  await screen.findByRole("button", { name: "Paid in full" });
  await user.click(screen.getByRole("button", { name: "Paid in full" }));

  expect(post).toHaveBeenCalledWith("/api/day-record/confirm", {
    dailyLeaseId,
    businessDate: today,
    action: "paid_in_full",
  });

  // Optimistic: the settled summary renders before the response lands.
  expect(await screen.findByText("Confirmed")).toBeInTheDocument();
  expect(screen.getByText("Not yet saved")).toBeInTheDocument();

  expect(resolvePost).toBeDefined();
  resolvePost?.({
    id: "dr1",
    dailyLeaseId,
    vehicleId: "v1",
    driverId: "d1",
    businessDate: "2026-07-15",
    state: "ran_paid_full",
    earnedMinor: "500000",
    expectedMinor: "500000",
    receivedMinor: "500000",
    lostReason: null,
    note: null,
  });

  expect(await screen.findByText("Confirmed")).toBeInTheDocument();
  await vi.waitFor(() => expect(screen.queryByText("Not yet saved")).not.toBeInTheDocument());
});

test("didn't run: opens the reason list, excluding On charter, and confirms with the chosen reason", async () => {
  const user = userEvent.setup();
  const get = vi.fn();
  get.mockImplementation((path: string) => {
    if (path === `/api/daily-lease/${dailyLeaseId}`) return Promise.resolve(lease);
    throw new ApiError(404, "NOT_FOUND", "not found", "req-1");
  });
  const post = vi.fn().mockResolvedValue({
    id: "dr1",
    dailyLeaseId,
    vehicleId: "v1",
    driverId: "d1",
    businessDate: "2026-07-15",
    state: "did_not_run",
    earnedMinor: "0",
    expectedMinor: "500000",
    receivedMinor: "0",
    lostReason: "breakdown",
    note: null,
  });
  renderWithProviders(<ConfirmDayCard {...props()} />, { get, post });

  await user.click(await screen.findByRole("button", { name: "Didn't run" }));
  expect(screen.queryByText("On charter")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Breakdown" }));

  await vi.waitFor(() =>
    expect(post).toHaveBeenCalledWith("/api/day-record/confirm", {
      dailyLeaseId,
      businessDate: today,
      action: "did_not_run",
      lostReason: "breakdown",
    }),
  );
});
