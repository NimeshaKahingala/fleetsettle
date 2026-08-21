import type { CashPositionResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CashPositionReportScreen } from "./CashPositionReportScreen.js";

test("GAP-70/Wave 2: real title, banked and driver-advances given their own place, never merged into a partner's held figure", async () => {
  const response: CashPositionResponse = {
    partners: [
      { userId: "u1", displayName: "Nimesha", heldMinor: "1500000" },
      { userId: "u2", displayName: null, heldMinor: "0" },
    ],
    depositsHeldMinor: "5000000",
    banked: [{ destination: "Sampath savings", heldMinor: "3000000" }],
    driverAdvances: [{ driverId: "d1", driverName: "Kamal", outstandingMinor: "800000" }],
  };
  const get = vi.fn().mockResolvedValue(response);
  renderWithProviders(<CashPositionReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Nimesha")).toBeInTheDocument();
  expect(screen.getByText("Where is our cash")).toBeInTheDocument();
  expect(screen.getByText("Unnamed partner")).toBeInTheDocument();
  // The stat tile for u1 (15,000) must never read as 65,000 (15,000 + the 50,000 deposit).
  expect(screen.getByText("Rs 15,000")).toBeInTheDocument();
  // GAP-106: `depositsHeldMinor` is party-agnostic by design (a driver's
  // deposit and a customer's are summed together) — the copy must never
  // claim a specific party, since that's a fact this figure doesn't carry.
  expect(screen.getByText(/50,000 held as deposits/)).toBeInTheDocument();
  expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();

  // GAP-70: banked and driverAdvances are visible, not just subtracted into heldMinor.
  expect(screen.getByText("Sampath savings")).toBeInTheDocument();
  expect(screen.getByText("Rs 30,000")).toBeInTheDocument();
  expect(screen.getByText("Kamal")).toBeInTheDocument();
  expect(screen.getByText("Rs 8,000")).toBeInTheDocument();
});

test("empty banked/driverAdvances render an honest message rather than an empty table", async () => {
  const response: CashPositionResponse = {
    partners: [{ userId: "u1", displayName: "Nimesha", heldMinor: "1500000" }],
    depositsHeldMinor: "0",
    banked: [],
    driverAdvances: [],
  };
  const get = vi.fn().mockResolvedValue(response);
  renderWithProviders(<CashPositionReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Nothing banked yet.")).toBeInTheDocument();
  expect(screen.getByText("No advances outstanding.")).toBeInTheDocument();
});

test("GAP-111: the table view gives an empty banked/driverAdvances section the same honest message as the chart view, not a bare header", async () => {
  const user = userEvent.setup();
  const response: CashPositionResponse = {
    partners: [{ userId: "u1", displayName: "Nimesha", heldMinor: "1500000" }],
    depositsHeldMinor: "0",
    banked: [],
    driverAdvances: [],
  };
  const get = vi.fn().mockResolvedValue(response);
  renderWithProviders(<CashPositionReportScreen onBack={() => {}} />, { get });

  await user.click(await screen.findByRole("tab", { name: "Table" }));

  expect(screen.getByText("Nothing banked yet.")).toBeInTheDocument();
  expect(screen.getByText("No advances outstanding.")).toBeInTheDocument();
  // "Held per partner" always renders (it has a real row) — only the two
  // empty sections drop their table for the honest-message fallback.
  expect(screen.getAllByRole("table")).toHaveLength(1);
});

test("GAP-101/F2: a failed read shows a failure notice, with the back button still reachable, never an eternal spinner", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  const onBack = vi.fn();
  renderWithProviders(<CashPositionReportScreen onBack={onBack} />, { get });

  expect(
    await screen.findByText("Something went wrong loading the cash position."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  await screen.findByRole("button", { name: "Back" });
});
