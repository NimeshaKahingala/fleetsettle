import type { CashPositionResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { CashPositionReportScreen } from "./CashPositionReportScreen.js";

test("ships under the narrower Wave 1 title, and never merges deposits into a partner's own held figure", async () => {
  const response: CashPositionResponse = {
    partners: [
      { userId: "u1", displayName: "Nimesha", heldMinor: "1500000" },
      { userId: "u2", displayName: null, heldMinor: "0" },
    ],
    depositsHeldMinor: "5000000",
  };
  const get = vi.fn().mockResolvedValue(response);
  renderWithProviders(<CashPositionReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Nimesha")).toBeInTheDocument();
  expect(screen.getByText("Cash partners are holding")).toBeInTheDocument();
  expect(screen.getByText("Unnamed partner")).toBeInTheDocument();
  // The stat tile for u1 (15,000) must never read as 65,000 (15,000 + the 50,000 deposit).
  expect(screen.getByText("Rs 15,000")).toBeInTheDocument();
  expect(screen.getByText(/50,000 held for customers/)).toBeInTheDocument();
});
