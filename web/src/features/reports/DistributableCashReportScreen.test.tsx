import type { DistributableCashResponse } from "@fleetsettle/shared/schemas";
import { screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ApiError } from "../../lib/api.js";
import { renderWithProviders } from "../../test/renderWithProviders.js";
import { DistributableCashReportScreen } from "./DistributableCashReportScreen.js";

test("renders cash on hand, deposits held, loan instalments due and the safe-to-take-out figure", async () => {
  const body: DistributableCashResponse = {
    cashOnHandMinor: "50000",
    depositsHeldMinor: "8000",
    loanInstalmentsDueMinor: "4000",
    distributableMinor: "38000",
  };
  const get = vi.fn().mockResolvedValue(body);
  renderWithProviders(<DistributableCashReportScreen onBack={() => {}} />, { get });

  expect(await screen.findByText("Rs 500")).toBeInTheDocument();
  expect(screen.getByText("Rs 80")).toBeInTheDocument();
  expect(screen.getByText("Rs 40")).toBeInTheDocument();
  expect(screen.getByText("Rs 380")).toBeInTheDocument();
});

test("GAP-186/W-56 — a null loanInstalmentsDueMinor/distributableMinor renders NotAvailable, never a fabricated 0", async () => {
  const body: DistributableCashResponse = {
    cashOnHandMinor: "50000",
    depositsHeldMinor: "8000",
    loanInstalmentsDueMinor: null,
    distributableMinor: null,
  };
  const get = vi.fn().mockResolvedValue(body);
  renderWithProviders(<DistributableCashReportScreen onBack={() => {}} />, { get });

  expect(await screen.findAllByText("a loan has no monthly instalment set")).toHaveLength(2);
  expect(screen.queryByText("Rs 0")).not.toBeInTheDocument();
});

test("GAP-101: a failed read shows a failure notice", async () => {
  const get = vi.fn().mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom", "req-1"));
  renderWithProviders(<DistributableCashReportScreen onBack={() => {}} />, { get });

  expect(
    await screen.findByText("Something went wrong loading what we can safely take out."),
  ).toBeInTheDocument();
});
